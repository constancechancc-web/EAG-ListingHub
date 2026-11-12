// Re-read what is ALREADY SAVED online with the current rules (price, For Sale / For Rent, type ...).
// Unlike `auto-import.js --reclassify` this does not need the chat files: it takes each saved listing's original
// WhatsApp message and parses it again. Only rows whose content really changes are written; posting date,
// id and the open/closed status of requests stay as they are.
//
//   node scripts/resort-db.js --dry-run     only count (and show examples)
//   node scripts/resort-db.js               do it
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMessage } from '../listinghub/js/core/parse.js';
import { toStored } from '../listinghub/js/core/importer.js';

const DRY = process.argv.includes('--dry-run');
const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'auto-import.config.json'), 'utf8'));

async function call(method, body, query = '') {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(cfg.endpoint + query, {
        method,
        headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      throw new Error(`HTTP ${r.status} ${j.error || ''}`);
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * attempt));
    }
  }
}

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const summary = {};
for (const [table, want] of [['listings', 'listing'], ['requests', 'request']]) {
  const s = (summary[table] = { checked: 0, changed: 0, switched: 0, examples: [] });
  const todo = [];
  for (let after = ''; ;) {
    const page = await call('GET', null, `?action=rows&table=${table}${after ? '&after=' + encodeURIComponent(after) : ''}`);
    for (const row of page.rows) {
      const old = row.data;
      s.checked++;
      if (!old || typeof old.raw !== 'string') continue;
      const out = parseMessage(
        { sender: old.renName || '', text: old.raw, postedAt: old.postedAt, day: old.day, hash: old.hash },
        { group: old.group, source: old.source },
      );
      if (out.cls !== want || !out.item) { s.switched++; continue; } // would become another kind of message: leave it alone
      const next = toStored({ ...out.item, id: old.id, hash: old.hash, renName: old.renName, renPhone: old.renPhone, group: old.group, source: old.source, postedAt: old.postedAt, day: old.day });
      if (stable(next) === stable(toStored(old))) continue;
      s.changed++;
      if (s.examples.length < 6) s.examples.push(`${old.kind} ${old.price} → ${next.kind} ${next.price} | ${old.raw.split('\n')[0].slice(0, 50)}`);
      todo.push(next);
    }
    if (!page.next) break;
    after = page.next;
    if (s.checked % 5000 < 500) console.log(`${table}: ${s.checked} checked, ${s.changed} to change`);
  }
  if (!DRY) {
    for (let i = 0; i < todo.length; i += 300) {
      const batch = todo.slice(i, i + 300);
      await call('POST', { [table]: batch, seen: [], force: true });
    }
  }
}
console.log(JSON.stringify(summary, null, 1));
