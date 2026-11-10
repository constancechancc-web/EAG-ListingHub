// Shared import pipeline: messages → de-duplicated listings/requests grouped in day-packs.
import { parseMessage } from './parse.js';
import { groupFromFileName, sourceForGroup } from './whatsapp.js';
import { hash53, norm, scrubText } from './text.js';

/**
 * Re-post key: the same agent posting the same text again (every day, in many groups) is ONE listing.
 * The item id is this key, so a later re-post updates the same row instead of adding a new one.
 */
export function repostId(item) {
  const who = item.renPhone || norm(item.renName);
  const text = norm(item.raw).replace(/[^a-z0-9㐀-鿿]+/g, ' ').trim();
  return hash53('rp|' + who + '|' + text);
}

/** Keep only the newest copy of each re-post. Returns { items, merged }. */
function mergeReposts(items) {
  const m = new Map();
  for (const it of items) {
    it.id = repostId(it);
    const cur = m.get(it.id);
    if (!cur || it.postedAt > cur.postedAt) m.set(it.id, it);
  }
  return { items: [...m.values()], merged: items.length - m.size };
}

/**
 * @param messages  parsed chat messages
 * @param opts { fileName, seen:Set<hash>, vocab, hints: Map<hash, aiHint>, onProgress }
 * @returns { listings, requests, review, ignored, duplicates, group, source, newHashes }
 */
export function processMessages(messages, opts = {}) {
  const group = opts.group || groupFromFileName(opts.fileName);
  const source = sourceForGroup(group);
  const seen = opts.seen || new Set();
  const hints = opts.hints || new Map();
  const res = { listings: [], requests: [], review: [], ignored: 0, duplicates: 0, merged: 0, group, source, newHashes: [] };
  const local = new Set();
  messages.forEach((msg, i) => {
    if (seen.has(msg.hash) || local.has(msg.hash)) { res.duplicates++; return; }
    local.add(msg.hash);
    const out = parseMessage(msg, { group, source, vocab: opts.vocab, hint: hints.get(msg.hash) });
    if (out.cls === 'listing') res.listings.push(out.item);
    else if (out.cls === 'request') res.requests.push(out.item);
    else if (out.cls === 'review') { res.review.push({ ...out.item, reason: out.reason, hash: msg.hash }); return; }
    else res.ignored++;
    res.newHashes.push({ hash: msg.hash, day: msg.day });
    if (opts.onProgress && i % 500 === 0) opts.onProgress(i / messages.length);
  });
  const L = mergeReposts(res.listings), R = mergeReposts(res.requests);
  res.listings = L.items;
  res.requests = R.items;
  res.merged = L.merged + R.merged; // same agent + same text re-posted → counted once
  return res;
}

export const PACK_LIMIT_CHARS = 600000; // Firestore docs max out at 1 MiB; stay well below.

/** Group items by day. */
export function byDay(items) {
  const m = new Map();
  for (const it of items) {
    const d = it.day || String(it.postedAt).slice(0, 10);
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(it);
  }
  return m;
}

/**
 * Append new items to a day's packs. existing: [{id, n, items}] for that day.
 * Returns the packs that changed: [{ id, n, day, items, isNew }].
 * Items whose hash is already in a pack are skipped (safe for concurrent imports).
 */
export function appendToPacks(prefix, day, existing, newItems, limit = PACK_LIMIT_CHARS) {
  const have = new Set();
  for (const p of existing) for (const it of p.items) have.add(it.hash);
  const fresh = newItems.filter((it) => !have.has(it.hash) && (have.add(it.hash), true));
  if (!fresh.length) return [];
  const packs = existing.map((p) => ({ ...p, items: [...p.items], size: JSON.stringify(p.items).length }));
  packs.sort((a, b) => a.n - b.n);
  const changed = new Map();
  let cur = packs[packs.length - 1];
  for (const it of fresh) {
    const s = JSON.stringify(it).length + 1;
    if (!cur || cur.size + s > limit) {
      const n = cur ? cur.n + 1 : 0;
      cur = { id: `${prefix}_${day}_${n}`, n, day, items: [], size: 2, isNew: true };
      packs.push(cur);
    }
    cur.items.push(it);
    cur.size += s;
    changed.set(cur.id, cur);
  }
  return [...changed.values()].map(({ size, ...p }) => ({ ...p, day }));
}

/** Strip non-persistent props before saving; text is made safe for JSON / Postgres (no half characters). */
const scrubValue = (v) => (typeof v === 'string' ? scrubText(v) : Array.isArray(v) ? v.map(scrubValue) : v);
export function toStored(item) {
  const o = {};
  for (const [k, v] of Object.entries(item)) if (v !== undefined && !k.startsWith('_')) o[k] = scrubValue(v);
  return o;
}
