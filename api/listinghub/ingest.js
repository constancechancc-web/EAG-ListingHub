// POST /api/listinghub/ingest — receives parsed listings / requests from the scheduled import that runs on the
// owner's computer (scripts/auto-import.js). Protected by a long secret token (INGEST_TOKEN, Vercel env var);
// the token can import, and (for the daily clean-up) read and delete rows that are OLDER than the app's 90-day window.
// GET (with the token) is a health check; GET ?action=old-count|old-rows reads old rows; POST {cleanup:{before}} deletes them.
//
// Body: { listings: [...], requests: [...], seen: [{hash, day}], log?: { at, files:[...], ... } }
import crypto from 'node:crypto';
import { db, check } from './_lib/supabase.js';
import { toStored } from '../../listinghub/js/core/importer.js';
import { OLD_TABLES, canDeleteBefore, cutoffDay } from './_lib/cleanup.js';

export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: '4mb' } } };

const MAX_ITEMS = 400;
const MAX_SEEN = 3000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function tokenOk(req) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected || expected.length < 24) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Only well-formed items are accepted; everything is re-built from known fields. */
function clean(prefix, it) {
  if (!it || typeof it !== 'object' || typeof it.id !== 'string' || it.id.length > 40 || !DAY.test(it.day || '')) return null;
  if (typeof it.raw !== 'string' || it.raw.length > 20000 || !Date.parse(it.postedAt)) return null;
  const data = toStored(it);
  if (prefix === 'R') { data.status = 'open'; if (data.kind !== 'sale' && data.kind !== 'rent') return null; }
  else if (data.kind !== 'sale' && data.kind !== 'rent') return null;
  return { id: data.id, day: data.day, posted_at: data.postedAt, data };
}

/** Same content, whatever the order of the keys (the database stores keys in its own order). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

/**
 * RE-SORT mode (body.force): the same listings, read again with newer rules (e.g. a new property type).
 * Only rows whose content really changed are written (so devices only sync those), a row is never moved back in time,
 * and a request's open/closed status is left alone.
 */
async function reclassify(table, rows) {
  const out = { added: 0, changed: 0, same: 0, skippedOlder: 0 };
  for (let i = 0; i < rows.length; i += 300) {
    const batch = rows.slice(i, i + 300);
    const existing = check(await db().from(table).select('id,posted_at,data').in('id', batch.map((r) => r.id)));
    const byId = new Map(existing.map((e) => [e.id, e]));
    const todo = [];
    for (const r of batch) {
      const e = byId.get(r.id);
      if (!e) { todo.push(r); out.added++; continue; }
      if (Date.parse(r.posted_at) < Date.parse(e.posted_at)) { out.skippedOlder++; continue; }
      if (Date.parse(r.posted_at) === Date.parse(e.posted_at) && deepEqual(e.data, r.data)) { out.same++; continue; }
      todo.push(r); out.changed++;
    }
    if (todo.length) {
      const now = new Date().toISOString();
      check(await db().from(table).upsert(todo.map((r) => ({ id: r.id, day: r.day, posted_at: r.posted_at, data: r.data, updated_at: now })), { onConflict: 'id' }));
    }
  }
  return out;
}

async function importItems(table, rows) {
  let added = 0, bumped = 0;
  for (let i = 0; i < rows.length; i += 300) {
    const out = check(await db().rpc('import_items', { p_table: table, p_rows: rows.slice(i, i + 300) }));
    added += out.added; bumped += out.bumped;
  }
  return { added, bumped };
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.INGEST_TOKEN || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'not configured', need: ['INGEST_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]) });
  }
  if (!tokenOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method === 'GET') {
    const action = req.query && req.query.action;
    if (!action) return res.status(200).json({ ok: true });
    const before = String((req.query && req.query.before) || '');
    if (!canDeleteBefore(before)) return res.status(400).json({ error: 'cutoff too recent', newestAllowed: cutoffDay() });
    try {
      if (action === 'old-count') {
        const out = {};
        for (const t of Object.keys(OLD_TABLES)) {
          const r = await db().from(t).select(OLD_TABLES[t].key, { count: 'exact', head: true }).lt('day', before);
          if (r.error) throw new Error(r.error.message);
          out[t] = r.count || 0;
        }
        return res.status(200).json({ before, counts: out });
      }
      if (action === 'old-rows') {
        const t = OLD_TABLES[req.query.table];
        if (!t) return res.status(400).json({ error: 'unknown table' });
        let q = db().from(req.query.table).select(t.columns).lt('day', before).order(t.key).limit(1000);
        if (req.query.after) q = q.gt(t.key, String(req.query.after));
        const rows = check(await q);
        return res.status(200).json({ rows, next: rows.length === 1000 ? rows[rows.length - 1][t.key] : null });
      }
      return res.status(400).json({ error: 'unknown action' });
    } catch (e) {
      console.error('old rows failed', e);
      return res.status(500).json({ error: 'read failed', detail: String(e.message).slice(0, 200) });
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const listings = (Array.isArray(body.listings) ? body.listings : []).slice(0, MAX_ITEMS).map((x) => clean('L', x)).filter(Boolean);
  const requests = (Array.isArray(body.requests) ? body.requests : []).slice(0, MAX_ITEMS).map((x) => clean('R', x)).filter(Boolean);
  const seen = (Array.isArray(body.seen) ? body.seen : []).slice(0, MAX_SEEN)
    .filter((x) => x && typeof x.hash === 'string' && x.hash.length <= 40 && DAY.test(x.day || ''))
    .map((x) => ({ hash: x.hash, day: x.day }));
  if (body.cleanup && typeof body.cleanup === 'object') {
    // delete rows older than the cut-off, in small batches (the caller repeats until done:true)
    const before = String(body.cleanup.before || '');
    if (!canDeleteBefore(before)) return res.status(400).json({ error: 'cutoff too recent', newestAllowed: cutoffDay() });
    const started = Date.now();
    const deleted = { listings: 0, requests: 0, seen: 0 };
    let done = true;
    try {
      for (const [name, t] of Object.entries(OLD_TABLES)) {
        for (;;) {
          if (Date.now() - started > 40000) { done = false; break; }
          const ids = check(await db().from(name).select(t.key).lt('day', before).order(t.key).limit(1000)).map((r) => r[t.key]);
          if (!ids.length) break;
          check(await db().from(name).delete().in(t.key, ids));
          deleted[name] += ids.length;
        }
        if (!done) break;
      }
      return res.status(200).json({ ok: true, before, deleted, done });
    } catch (e) {
      console.error('cleanup failed', e);
      return res.status(500).json({ error: 'cleanup failed', detail: String(e.message).slice(0, 200), deleted });
    }
  }
  try {
    const L = body.force === true ? await reclassify('listings', listings) : await importItems('listings', listings);
    const R = body.force === true ? await reclassify('requests', requests) : await importItems('requests', requests);
    for (let i = 0; i < seen.length; i += 500) {
      check(await db().from('seen').upsert(seen.slice(i, i + 500), { onConflict: 'hash', ignoreDuplicates: true }));
    }
    if (body.log && typeof body.log === 'object') {
      const run = { at: new Date().toISOString(), source: 'computer', files: [], newListings: 0, newRequests: 0, duplicates: 0 };
      run.files = (Array.isArray(body.log.files) ? body.log.files : []).slice(0, 60).map((f) => ({
        name: String(f.name || '').slice(0, 120), status: String(f.status || 'ok').slice(0, 20), reason: String(f.reason || '').slice(0, 160), size: +f.size || 0,
      }));
      if (body.log.cleanup && typeof body.log.cleanup === 'object') run.cleanup = { deleted: +body.log.cleanup.deleted || 0, backup: String(body.log.cleanup.backup || '').slice(0, 200), before: String(body.log.cleanup.before || '').slice(0, 10) };
      run.newListings = +body.log.newListings || 0; run.newRequests = +body.log.newRequests || 0; run.duplicates = +body.log.merged || 0;
      const prev = check(await db().from('meta').select('data').eq('id', 'importLog').limit(1));
      const runs = ((prev && prev[0] && prev[0].data.runs) || []);
      check(await db().from('meta').upsert({ id: 'importLog', data: { runs: [run, ...runs].slice(0, 20) }, updated_at: new Date().toISOString() }, { onConflict: 'id' }));
    }
    return res.status(200).json({ ok: true, listings: L, requests: R });
  } catch (e) {
    console.error('ingest failed', e);
    return res.status(500).json({ error: 'save failed', detail: String(e.message).slice(0, 200) });
  }
}
