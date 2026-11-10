// Scheduled import (runs on the owner's computer, see scripts/install-auto-import.ps1).
// Reads WhatsApp exports (.zip / .txt) from a folder, parses them with the same code as the app, and sends only
// NEW items to the website (/api/listinghub/ingest). Files that did not change since the last run are skipped.
//
//   node scripts/auto-import.js              normal run
//   node scripts/auto-import.js --dry-run    parse and count only, send nothing, save nothing
//   node scripts/auto-import.js --force      treat every file as changed (messages already sent are still skipped)
//   node scripts/auto-import.js --init       create scripts/auto-import.config.json (with a new secret token)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { fileBytesToText, parseChatText } from '../listinghub/js/core/whatsapp.js';
import { processMessages } from '../listinghub/js/core/importer.js';
import { RETENTION_DAYS } from '../listinghub/js/core/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const F = {
  config: path.join(here, 'auto-import.config.json'),
  state: path.join(here, 'auto-import.state.json'),
  log: path.join(here, 'auto-import.log'),
  lock: path.join(here, 'auto-import.lock'),
};
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');

function log(msg) {
  const line = `${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}  ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(F.log) && fs.statSync(F.log).size > 1_000_000) fs.renameSync(F.log, F.log + '.old');
    fs.appendFileSync(F.log, line + '\n');
  } catch {}
}

if (args.has('--init')) {
  if (fs.existsSync(F.config)) { console.log('auto-import.config.json already exists — not changed.'); process.exit(0); }
  const cfg = {
    folder: 'C:\\Users\\fenfe\\iCloudDrive\\WA Chat Export',
    endpoint: 'https://eag-listinghub.vercel.app/api/listinghub/ingest',
    token: crypto.randomBytes(32).toString('hex'),
    maxFileMB: 60,
  };
  fs.writeFileSync(F.config, JSON.stringify(cfg, null, 2));
  console.log('Created scripts/auto-import.config.json (the token inside is secret: it is also needed as INGEST_TOKEN on Vercel).');
  process.exit(0);
}

if (!fs.existsSync(F.config)) { console.error('Missing scripts/auto-import.config.json — run: node scripts/auto-import.js --init'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(F.config, 'utf8'));
const mytDay = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
const fromDay = mytDay(Date.now() - (RETENTION_DAYS + 1) * 86400000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── one run at a time ──
if (!DRY) {
  try {
    if (fs.existsSync(F.lock) && Date.now() - fs.statSync(F.lock).mtimeMs < 2 * 3600 * 1000) { log('Another run is still going — skipped.'); process.exit(0); }
    fs.writeFileSync(F.lock, String(process.pid));
  } catch {}
}
const unlock = () => { try { fs.unlinkSync(F.lock); } catch {} };
process.on('exit', () => { if (!DRY) unlock(); });

const state = fs.existsSync(F.state) ? JSON.parse(fs.readFileSync(F.state, 'utf8')) : { files: {}, sent: {} };
state.files ||= {}; state.sent ||= {};
const saveState = () => { if (!DRY) fs.writeFileSync(F.state, JSON.stringify(state)); };

/** POST/GET to the website with retries on network errors, 5xx and 429. */
async function call(method, body) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(cfg.endpoint, {
        method,
        headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
      });
      const text = await r.text();
      let json = {}; try { json = JSON.parse(text); } catch {}
      if (r.ok) return json;
      last = new Error(`HTTP ${r.status} ${json.error || text.slice(0, 80)}${json.need ? ' (missing on Vercel: ' + json.need.join(', ') + ')' : ''}`);
      last.status = r.status;
      if (r.status < 500 && r.status !== 429) throw last;
    } catch (e) { last = e; if (e.status && e.status < 500 && e.status !== 429) throw e; }
    await sleep(attempt * 3000);
  }
  throw last;
}

async function readFileRetry(file) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try { return new Uint8Array(fs.readFileSync(file)); } catch (e) { last = e; await sleep(5000 * i); } // iCloud may still be downloading it
  }
  throw last;
}

async function main() {
  if (!fs.existsSync(cfg.folder)) { log(`Folder not found: ${cfg.folder}`); process.exit(2); }
  if (!DRY) {
    try { await call('GET'); } catch (e) { log(`Website not ready: ${e.message}`); process.exit(2); }
  }
  const names = fs.readdirSync(cfg.folder).filter((f) => /\.(zip|txt)$/i.test(f)).sort();
  const seen = new Set(Object.keys(state.sent));
  const totals = { files: 0, listings: 0, requests: 0, merged: 0, failed: 0, skipped: 0 };
  const report = [];
  log(`${DRY ? 'DRY RUN — ' : ''}Looking at ${names.length} file(s) in ${cfg.folder}`);

  for (const name of names) {
    const full = path.join(cfg.folder, name);
    const st = fs.statSync(full);
    const prev = state.files[name];
    if (!args.has('--force') && prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) { totals.skipped++; continue; }
    const entry = { name, status: 'ok', size: st.size };
    report.push(entry);
    try {
      if (st.size === 0) throw new Error('File is empty (iCloud has not downloaded it yet?)');
      if (st.size > cfg.maxFileMB * 1048576) { entry.status = 'failed'; throw new Error(`Too big (limit ${cfg.maxFileMB} MB). Re-export Without Media.`); }
      const text = fileBytesToText(await readFileRetry(full), unzipSync);
      const msgs = parseChatText(text).filter((m) => m.day >= fromDay);
      const res = processMessages(msgs, { fileName: name, seen });
      if (!DRY) {
        const pages = Math.max(Math.ceil(res.listings.length / 300), Math.ceil(res.requests.length / 300), Math.ceil(res.newHashes.length / 3000), 1);
        for (let p = 0; p < pages; p++) {
          await call('POST', {
            listings: res.listings.slice(p * 300, p * 300 + 300),
            requests: res.requests.slice(p * 300, p * 300 + 300),
            seen: res.newHashes.slice(p * 3000, p * 3000 + 3000),
          });
        }
        for (const h of res.newHashes) { state.sent[h.hash] = h.day; seen.add(h.hash); }
        state.files[name] = { mtimeMs: st.mtimeMs, size: st.size, at: new Date().toISOString() };
        saveState();
      }
      totals.files++; totals.listings += res.listings.length; totals.requests += res.requests.length; totals.merged += res.merged;
      log(`${DRY ? '[dry] ' : ''}${name}: ${res.listings.length} listings, ${res.requests.length} requests, ${res.merged} re-posts merged, ${res.duplicates} already sent${res.review.length ? `, ${res.review.length} unclear` : ''}`);
    } catch (e) {
      entry.status = entry.status === 'ok' ? (e.message === 'NOT_WHATSAPP' ? 'failed' : 'failed') : entry.status;
      entry.reason = e.message === 'NOT_WHATSAPP' ? 'Not a WhatsApp export' : e.message === 'NO_TXT_IN_ZIP' ? 'No chat text inside the zip' : e.message;
      totals.failed++;
      log(`${name}: FAILED — ${entry.reason}`);
    }
  }

  // forget old message hashes (older than the retention window can never be imported again)
  for (const [h, d] of Object.entries(state.sent)) if (d < fromDay) delete state.sent[h];
  saveState();

  log(`${DRY ? 'DRY RUN ' : ''}done: ${totals.files} file(s) read, ${totals.skipped} unchanged, ${totals.failed} failed; ${totals.listings} new listings, ${totals.requests} new requests (${totals.merged} re-posts merged)`);
  if (!DRY && report.length) {
    try { await call('POST', { log: { files: report, newListings: totals.listings, newRequests: totals.requests, merged: totals.merged } }); }
    catch (e) { log(`Could not save the run summary: ${e.message}`); }
  }
  process.exit(totals.failed && !totals.files ? 1 : 0);
}

main().catch((e) => { log(`Stopped: ${e.stack || e.message}`); process.exit(1); });
