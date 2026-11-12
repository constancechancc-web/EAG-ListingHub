// Daily clean-up of data older than the app's 90-day window, with a backup first.
//   1. count what is older than `before` (the server refuses a cut-off that is too recent)
//   2. download all of it into a backup file in the same format as Backend → Backup (so Restore can read it)
//   3. read the file back and check the numbers; if anything does not match, STOP (nothing is deleted)
//   4. delete on the server
// `call(method, body, query)` talks to /api/listinghub/ingest.
import fs from 'node:fs';
import path from 'node:path';

const TABLES = [['listings', 'id'], ['requests', 'id'], ['seen', 'hash']];

export async function runOldDataCleanup({ call, backupDir, before, log = () => {}, dryRun = false, now = new Date() }) {
  const q = (extra) => `?before=${encodeURIComponent(before)}&${extra}`;
  const { counts } = await call('GET', null, q('action=old-count'));
  const total = counts.listings + counts.requests + counts.seen;
  if (!total) { log(`Clean-up: nothing older than ${before}.`); return { deleted: 0, backup: null, before }; }
  log(`Clean-up: ${counts.listings} listings, ${counts.requests} requests, ${counts.seen} message records are older than ${before}.`);
  if (dryRun) return { deleted: 0, backup: null, before, counts, dryRun: true };

  // 2. backup
  const rows = { listings: [], requests: [], seen: [] };
  for (const [table, key] of TABLES) {
    let after = '';
    for (;;) {
      const r = await call('GET', null, q(`action=old-rows&table=${table}${after ? `&after=${encodeURIComponent(after)}` : ''}`));
      rows[table].push(...r.rows);
      if (!r.next) break;
      after = r.next;
    }
  }
  const seenByDay = new Map();
  for (const s of rows.seen) { if (!seenByDay.has(s.day)) seenByDay.set(s.day, []); seenByDay.get(s.day).push(s.hash); }
  const backup = {
    app: 'eag-listing-hub', version: 1, exportedAt: now.toISOString(),
    note: `Old data (before ${before}) saved automatically before it was deleted from the website.`,
    counts: { listings: rows.listings.length, requests: rows.requests.length, seen: rows.seen.length },
    listings: rows.listings.map((r) => r.data),
    requests: rows.requests.map((r) => ({ ...r.data, status: r.status || r.data.status || 'open' })),
    users: [],
    seen: [...seenByDay].map(([day, hashes]) => ({ day, hashes })),
  };
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now.toISOString().slice(0, 10);
  const file = path.join(backupDir, `old-data-before-${before}__saved-${stamp}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(backup));
  fs.renameSync(tmp, file);

  // 3. verify what is on disk, not what is in memory
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seenBack = back.seen.reduce((n, d) => n + d.hashes.length, 0);
  const ok = back.listings.length === counts.listings && back.requests.length === counts.requests && seenBack === counts.seen;
  if (!ok) throw new Error(`Backup does not match (listings ${back.listings.length}/${counts.listings}, requests ${back.requests.length}/${counts.requests}, records ${seenBack}/${counts.seen}) — nothing was deleted`);
  log(`Clean-up: backup saved and checked: ${file}`);

  // 4. delete
  const deleted = { listings: 0, requests: 0, seen: 0 };
  for (let guard = 0; guard < 200; guard++) {
    const r = await call('POST', { cleanup: { before } });
    for (const k of Object.keys(deleted)) deleted[k] += (r.deleted && r.deleted[k]) || 0;
    if (r.done) break;
  }
  const n = deleted.listings + deleted.requests + deleted.seen;
  log(`Clean-up: deleted ${deleted.listings} listings, ${deleted.requests} requests, ${deleted.seen} message records from the website.`);
  return { deleted: n, backup: file, before, counts, detail: deleted };
}
