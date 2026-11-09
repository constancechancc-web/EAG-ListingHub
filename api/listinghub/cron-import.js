// Scheduled import: 12:00 and 21:00 Asia/Kuala_Lumpur (vercel.json crons, UTC 04:00 and 13:00).
// Reads new/changed WhatsApp exports from the shared Google Drive folder with the service account,
// parses them with the same code the browser uses, and inserts new rows into Supabase Postgres.
import { GoogleAuth } from 'google-auth-library';
import { unzipSync } from 'fflate';
import { db, check, googleServiceAccount } from './_lib/supabase.js';
import { classifyWithAI, aiEnabled } from './_lib/ai.js';
import { fileBytesToText, parseChatText } from '../../listinghub/js/core/whatsapp.js';
import { processMessages, toStored } from '../../listinghub/js/core/importer.js';
import { RETENTION_DAYS } from '../../listinghub/js/core/constants.js';

export const config = { maxDuration: 300 };

const MAX_BYTES = (+process.env.DRIVE_MAX_MB || 25) * 1048576;
const mytDay = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);

async function driveToken() {
  const auth = new GoogleAuth({ credentials: googleServiceAccount(), scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function listFolder(token, folderId) {
  const files = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,size,modifiedTime,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? '&pageToken=' + pageToken : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Drive list failed: ${r.status}`);
    const j = await r.json();
    files.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function seenFor(days) {
  const set = new Set();
  for (let i = 0; i < days.length; i += 50) {
    const chunk = days.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const rows = check(await db().from('seen').select('hash').in('day', chunk).order('hash').range(from, from + 999));
      rows.forEach((r) => set.add(r.hash));
      if (rows.length < 1000) break;
    }
  }
  return set;
}

async function insertNew(table, rows, key = 'id', returning = true) {
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    let q = db().from(table).upsert(rows.slice(i, i + 500), { onConflict: key, ignoreDuplicates: true });
    if (returning) q = q.select(key);
    const data = check(await q);
    added += returning ? (data || []).length : 0;
  }
  return added;
}

const toRow = (prefix, it) => {
  const data = toStored(it);
  const row = { id: data.id, day: data.day, posted_at: data.postedAt || null, data };
  if (prefix === 'R') row.status = 'open';
  return row;
};

async function save(res) {
  const added = {
    listings: await insertNew('listings', res.listings.map((x) => toRow('L', x))),
    requests: await insertNew('requests', res.requests.map((x) => toRow('R', x))),
  };
  if (res.newHashes.length) await insertNew('seen', res.newHashes.map(({ hash, day }) => ({ hash, day })), 'hash', false);
  return added;
}

const getMeta = async (id) => { const r = check(await db().from('meta').select('data').eq('id', id).limit(1)); return r && r[0] ? r[0].data : null; };
const setMeta = async (id, data) => check(await db().from('meta').upsert({ id, data, updated_at: new Date().toISOString() }, { onConflict: 'id' }));

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID is not set' });

  const state = (await getMeta('driveState')) || { files: {} };
  state.files = state.files || {};
  const fromDay = mytDay(Date.now() - (RETENTION_DAYS + 1) * 86400000);
  const run = { at: new Date().toISOString(), files: [], newListings: 0, newRequests: 0, duplicates: 0 };

  try {
    const token = await driveToken();
    const files = await listFolder(token, folderId);
    for (const f of files) {
      if (state.files[f.id] === f.modifiedTime) continue; // unchanged since last run
      const entry = { name: f.name, size: +f.size || 0, status: 'ok' };
      run.files.push(entry);
      if (f.mimeType === 'application/vnd.google-apps.folder' || f.mimeType?.startsWith('application/vnd.google-apps')) { entry.status = 'skipped'; entry.reason = 'Not a file'; continue; }
      if (entry.size > MAX_BYTES) { entry.status = 'failed'; entry.reason = `Too big (limit ${MAX_BYTES / 1048576} MB)`; continue; }
      try {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`Download failed (${r.status})`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        let text;
        try { text = fileBytesToText(bytes, unzipSync); } catch { throw new Error('Not a WhatsApp export'); }
        const msgs = parseChatText(text).filter((m) => m.day >= fromDay);
        const seen = await seenFor([...new Set(msgs.map((m) => m.day))]);
        let result = processMessages(msgs, { fileName: f.name, seen });
        if (aiEnabled() && process.env.AI_IN_CRON === '1' && result.review.length) {
          const items = result.review.slice(0, 120).map((x) => ({ id: x.hash, text: x.raw.replace(/(?:\+?6?0)1\d[\s-]?\d{3,4}[\s-]?\d{3,4}/g, '[phone]') }));
          const hints = [];
          for (let i = 0; i < items.length; i += 40) hints.push(...(await classifyWithAI(items.slice(i, i + 40))).map((h) => [h.id, h]));
          if (hints.length) result = processMessages(msgs, { fileName: f.name, seen, hints: new Map(hints) });
        }
        const added = await save(result);
        Object.assign(entry, { newListings: added.listings, newRequests: added.requests, duplicates: result.duplicates, review: result.review.length });
        run.newListings += added.listings;
        run.newRequests += added.requests;
        run.duplicates += result.duplicates;
        state.files[f.id] = f.modifiedTime;
      } catch (e) {
        entry.status = 'failed';
        entry.reason = e.message === 'NOT_WHATSAPP' ? 'Not a WhatsApp export' : e.message;
      }
    }
    await setMeta('driveState', state);
  } catch (e) {
    run.error = e.message;
    run.files.push({ name: '(Drive)', status: 'failed', reason: e.message });
  }

  const prev = ((await getMeta('importLog')) || {}).runs || [];
  await setMeta('importLog', { runs: [run, ...prev].slice(0, 20) });
  return res.status(run.error ? 500 : 200).json(run);
}
