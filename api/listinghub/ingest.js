// POST /api/listinghub/ingest — receives parsed listings / requests from the scheduled import that runs on the
// owner's computer (scripts/auto-import.js). Protected by a long secret token (INGEST_TOKEN, Vercel env var);
// the token can ONLY do this one thing. GET (with the token) is a health check.
//
// Body: { listings: [...], requests: [...], seen: [{hash, day}], log?: { at, files:[...], ... } }
import crypto from 'node:crypto';
import { db, check } from './_lib/supabase.js';
import { toStored } from '../../listinghub/js/core/importer.js';

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
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const listings = (Array.isArray(body.listings) ? body.listings : []).slice(0, MAX_ITEMS).map((x) => clean('L', x)).filter(Boolean);
  const requests = (Array.isArray(body.requests) ? body.requests : []).slice(0, MAX_ITEMS).map((x) => clean('R', x)).filter(Boolean);
  const seen = (Array.isArray(body.seen) ? body.seen : []).slice(0, MAX_SEEN)
    .filter((x) => x && typeof x.hash === 'string' && x.hash.length <= 40 && DAY.test(x.day || ''))
    .map((x) => ({ hash: x.hash, day: x.day }));
  try {
    const L = await importItems('listings', listings);
    const R = await importItems('requests', requests);
    for (let i = 0; i < seen.length; i += 500) {
      check(await db().from('seen').upsert(seen.slice(i, i + 500), { onConflict: 'hash', ignoreDuplicates: true }));
    }
    if (body.log && typeof body.log === 'object') {
      const run = { at: new Date().toISOString(), source: 'computer', files: [], newListings: 0, newRequests: 0, duplicates: 0 };
      run.files = (Array.isArray(body.log.files) ? body.log.files : []).slice(0, 60).map((f) => ({
        name: String(f.name || '').slice(0, 120), status: String(f.status || 'ok').slice(0, 20), reason: String(f.reason || '').slice(0, 160), size: +f.size || 0,
      }));
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
