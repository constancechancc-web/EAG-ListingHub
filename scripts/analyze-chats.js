// Dry run: parse every WhatsApp export (.zip / .txt) in a folder with the same code the app uses and
// print what an import would add. Nothing is uploaded or written.
//   node scripts/analyze-chats.js "C:\path\to\folder" [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { fileBytesToText, parseChatText, groupFromFileName, sourceForGroup } from '../listinghub/js/core/whatsapp.js';
import { processMessages } from '../listinghub/js/core/importer.js';
import { RETENTION_DAYS } from '../listinghub/js/core/constants.js';

const dir = process.argv[2];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (!dir) { console.error('usage: node scripts/analyze-chats.js <folder> [--json out.json]'); process.exit(1); }

const mytDay = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
const fromDay = mytDay(Date.now() - (RETENTION_DAYS + 1) * 86400000);
const files = fs.readdirSync(dir).filter((f) => /\.(zip|txt)$/i.test(f)).sort();

const seen = new Set();
const totals = { files: 0, messages: 0, kept: 0, listings: 0, requests: 0, review: 0, duplicates: 0, ignored: 0 };
const rows = [];
const all = { listings: [], requests: [], review: [], newHashes: [] };
const bySource = {};

for (const f of files) {
  const t0 = Date.now();
  try {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const text = fileBytesToText(bytes, unzipSync);
    const msgs = parseChatText(text);
    const kept = msgs.filter((m) => m.day >= fromDay);
    const res = processMessages(kept, { fileName: f, seen });
    res.newHashes.forEach((h) => seen.add(h.hash));
    totals.files++; totals.messages += msgs.length; totals.kept += kept.length;
    totals.listings += res.listings.length; totals.requests += res.requests.length;
    totals.review += res.review.length; totals.duplicates += res.duplicates; totals.ignored += res.ignored;
    all.listings.push(...res.listings); all.requests.push(...res.requests); all.review.push(...res.review); all.newHashes.push(...res.newHashes);
    bySource[res.source] = (bySource[res.source] || 0) + res.listings.length + res.requests.length;
    const days = kept.map((m) => m.day).sort();
    rows.push({ file: f.replace(/^WhatsApp Chat - /, ''), source: res.source, msgs: msgs.length, kept: kept.length, L: res.listings.length, R: res.requests.length, review: res.review.length, dup: res.duplicates, range: days.length ? `${days[0]}…${days[days.length - 1]}` : '-', ms: Date.now() - t0 });
  } catch (e) {
    rows.push({ file: f, error: e.message });
  }
}

console.table(rows);
console.log('TOTAL', totals, 'by source (items):', bySource, 'keeping messages since', fromDay);

// quality overview
const count = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const L = all.listings, R = all.requests;
console.log('\nLISTINGS', L.length, 'kind', count(L, (x) => x.kind), 'category', count(L, (x) => x.category));
console.log('  no price:', L.filter((x) => x.price == null).length, '| region Other:', L.filter((x) => x.region === 'Other').length, '| type Other:', L.filter((x) => x.type === 'Other').length, '| untitled:', L.filter((x) => x.title === 'Untitled').length, '| no phone:', L.filter((x) => !x.renPhone).length);
console.log('REQUESTS', R.length, 'kind', count(R, (x) => x.kind), 'category', count(R, (x) => x.category));
console.log('  no area:', R.filter((x) => !x.areas.length).length, '| no type:', R.filter((x) => !x.types.length).length, '| no budget:', R.filter((x) => x.budgetMin == null && x.budgetMax == null).length);
console.log('REVIEW (not imported, unclear):', all.review.length, count(all.review, (x) => x.reason));
const senders = count([...L, ...R], (x) => x.renName);
console.log('top senders:', Object.entries(senders).sort((a, b) => b[1] - a[1]).slice(0, 8));
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(all)); console.log('wrote', jsonOut, (fs.statSync(jsonOut).size / 1048576).toFixed(1), 'MB'); }
