import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cutoffDay, canDeleteBefore } from '../api/listinghub/_lib/cleanup.js';
import { runOldDataCleanup } from '../scripts/old-data-cleanup.js';

const NOW = Date.parse('2026-11-12T10:00:00+08:00');

test('the server never deletes anything newer than the app\'s window (today − 91 days)', () => {
  assert.equal(cutoffDay(NOW), '2026-08-13');
  assert.ok(canDeleteBefore('2026-08-13', NOW));
  assert.ok(canDeleteBefore('2026-01-01', NOW));
  assert.ok(!canDeleteBefore('2026-08-14', NOW));      // one day too recent
  assert.ok(!canDeleteBefore('2026-11-12', NOW));      // today
  assert.ok(!canDeleteBefore('', NOW));
  assert.ok(!canDeleteBefore('yesterday', NOW));
  assert.ok(!canDeleteBefore("2026-08-01' or '1'='1", NOW));
});

/** A tiny in-memory stand-in for the website's endpoint. */
function fakeServer({ listings = 0, requests = 0, seen = 0, loseRows = false } = {}) {
  const t = {
    listings: Array.from({ length: listings }, (_, i) => ({ id: 'L' + String(i).padStart(5, '0'), day: '2026-08-01', posted_at: '2026-08-01T10:00:00+08:00', data: { id: 'L' + i, title: 'T' + i, raw: 'x' } })),
    requests: Array.from({ length: requests }, (_, i) => ({ id: 'R' + String(i).padStart(5, '0'), day: '2026-08-02', posted_at: '2026-08-02T10:00:00+08:00', status: i % 2 ? 'closed' : 'open', data: { id: 'R' + i, kind: 'rent', raw: 'y' } })),
    seen: Array.from({ length: seen }, (_, i) => ({ hash: 'h' + String(i).padStart(6, '0'), day: i % 2 ? '2026-08-01' : '2026-08-02' })),
  };
  const calls = [];
  const key = { listings: 'id', requests: 'id', seen: 'hash' };
  const call = async (method, body, query = '') => {
    calls.push(method + ' ' + (query || JSON.stringify(body)).slice(0, 60));
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    if (method === 'GET' && params.get('action') === 'old-count') return { counts: { listings: t.listings.length, requests: t.requests.length, seen: t.seen.length } };
    if (method === 'GET' && params.get('action') === 'old-rows') {
      const name = params.get('table'), k = key[name], after = params.get('after') || '';
      let rows = t[name].filter((r) => r[k] > after).sort((a, b) => (a[k] < b[k] ? -1 : 1)).slice(0, 1000);
      const last = rows[rows.length - 1];
      if (loseRows && name === 'listings' && rows.length) rows = rows.slice(0, -1); // the download comes back one row short
      return { rows, next: rows.length === 1000 ? last[k] : null };
    }
    if (method === 'POST' && body.cleanup) {
      const deleted = { listings: 0, requests: 0, seen: 0 };
      let budget = 1500; // pretend the server stops after a while: the caller must repeat
      for (const name of Object.keys(t)) { const n = Math.min(budget, t[name].length); t[name].splice(0, n); deleted[name] = n; budget -= n; }
      return { ok: true, deleted, done: Object.values(t).every((a) => !a.length) };
    }
    throw new Error('unexpected call ' + method);
  };
  return { call, t, calls };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eag-backup-'));

test('clean-up: saves a backup file first (Restore format), checks it, then deletes everything older', async () => {
  const srv = fakeServer({ listings: 2500, requests: 40, seen: 3000 });
  const dir = tmpDir();
  const logs = [];
  const r = await runOldDataCleanup({ call: srv.call, backupDir: dir, before: '2026-08-13', log: (m) => logs.push(m), now: new Date(NOW) });
  assert.equal(r.deleted, 2500 + 40 + 3000);
  assert.deepEqual([srv.t.listings.length, srv.t.requests.length, srv.t.seen.length], [0, 0, 0]);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
  assert.match(file, /^old-data-before-2026-08-13__saved-2026-11-12\.json$/);
  const b = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert.equal(b.app, 'eag-listing-hub');                      // the Backend → Restore button accepts this
  assert.equal(b.listings.length, 2500);
  assert.equal(b.requests.length, 40);
  assert.equal(b.requests.filter((x) => x.status === 'closed').length, 20); // closed requests stay closed
  assert.equal(b.seen.reduce((n, d) => n + d.hashes.length, 0), 3000);
  // the backup was written BEFORE the first delete call
  const firstPost = srv.calls.findIndex((c) => c.startsWith('POST'));
  const lastGet = srv.calls.map((c, i) => (c.startsWith('GET') ? i : -1)).filter((i) => i >= 0).pop();
  assert.ok(lastGet < firstPost);
  assert.ok(srv.calls.filter((c) => c.startsWith('POST')).length >= 4, 'repeats until the server says done');
  assert.ok(logs.some((m) => /backup saved and checked/.test(m)));
});

test('clean-up: if the backup does not match the count, NOTHING is deleted', async () => {
  const srv = fakeServer({ listings: 1200, requests: 5, seen: 10, loseRows: true });
  await assert.rejects(runOldDataCleanup({ call: srv.call, backupDir: tmpDir(), before: '2026-08-13', now: new Date(NOW) }), /nothing was deleted/);
  assert.equal(srv.t.listings.length, 1200);
  assert.ok(!srv.calls.some((c) => c.startsWith('POST')), 'no delete call was made');
});

test('clean-up: dry run only counts; nothing old = no file and no delete', async () => {
  const srv = fakeServer({ listings: 10, requests: 2, seen: 4 });
  const dir = tmpDir();
  const r = await runOldDataCleanup({ call: srv.call, backupDir: dir, before: '2026-08-13', dryRun: true, now: new Date(NOW) });
  assert.equal(r.deleted, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(srv.t.listings.length, 10);
  const empty = fakeServer();
  const dir2 = tmpDir();
  const r2 = await runOldDataCleanup({ call: empty.call, backupDir: dir2, before: '2026-08-13', now: new Date(NOW) });
  assert.equal(r2.deleted, 0);
  assert.deepEqual(fs.readdirSync(dir2), []);
  assert.ok(!empty.calls.some((c) => c.startsWith('POST')));
});
