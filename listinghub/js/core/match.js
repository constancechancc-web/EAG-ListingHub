// Strict listing ↔ WTB/WTR matching. Plain code, runs in the browser at zero AI cost.
import { reparseRequest } from './parse.js';
import { stripAreaPrefix } from './areas.js';
import { compilePhrase, fieldHas, fmtRM } from './text.js';
import { prepareListing, cutoffTime } from './search.js';
import { RENT_MARGIN, SALE_MARGIN, MIN_MATCH_SCORE, TYPE_CAT, TYPE_ZH } from './constants.js';
import { isTypeKnown } from './classify.js';

export const marginFor = (kind) => (kind === 'rent' ? RENT_MARGIN : SALE_MARGIN);

/** Re-read the request text and precompute everything matching needs. */
export function prepareRequest(req, vocab) {
  const r = reparseRequest(req, vocab);
  const m = marginFor(r.kind);
  const hasBudget = r.budgetMin != null || r.budgetMax != null;
  const lo = hasBudget ? (r.budgetMin != null ? r.budgetMin - m : 0) : -Infinity;
  const hi = hasBudget ? (r.budgetMax != null ? r.budgetMax + m : Infinity) : Infinity;
  // Full-points band: inside the budget itself. Single budget "4000" → anything up to 4000 (down to the margin).
  const single = r.budgetMin != null && r.budgetMin === r.budgetMax;
  const inLo = hasBudget ? (single ? lo : r.budgetMin != null ? r.budgetMin : 0) : -Infinity;
  const inHi = hasBudget ? (r.budgetMax != null ? r.budgetMax : Infinity) : Infinity;
  const areaPhrases = [];
  for (const a of r.areas) {
    const p = compilePhrase(a);
    if (p) areaPhrases.push({ label: a, p });
    const stripped = stripAreaPrefix(a);
    if (stripped && stripped !== a.toLowerCase() && stripped.replace(/[^a-z]/g, '').length >= 4) {
      const p2 = compilePhrase(stripped);
      if (p2) areaPhrases.push({ label: a, p: p2 });
    }
  }
  Object.defineProperty(r, '_m', { value: { hasBudget, lo, hi, inLo, inHi, areaPhrases }, enumerable: false });
  return r;
}

/** All rules from the spec. Returns null when the pair must not be shown. */
export function evaluatePair(l, r) {
  const m = r._m;
  if (!m || !r.kind || l.kind !== r.kind) return null;
  if (!l._f) prepareListing(l);
  // 2. exact property type
  if (!l.category || l.category === 'Other' || l.category !== r.category) return null;
  if (!isTypeKnown(l.type) || TYPE_CAT[l.type] !== l.category) return null;
  if (!r.types || !r.types.length || !r.types.every(isTypeKnown)) return null;
  if (!r.types.includes(l.type)) return null;
  // 3. area (whole-word phrase in title, area or region)
  if (!m.areaPhrases.length) return null;
  const f = l._f;
  const hit = m.areaPhrases.find(({ p }) => fieldHas(p, f.title) || fieldHas(p, f.area) || fieldHas(p, f.region));
  if (!hit) return null;
  // 4. price
  let pricePts = 15, within = null, priceNote = '';
  if (m.hasBudget) {
    if (l.price == null) return null;
    if (l.price < m.lo || l.price > m.hi) return null;
    if (l.price >= m.inLo && l.price <= m.inHi) { pricePts = 30; within = true; priceNote = '✓ Within budget 符合预算'; }
    else {
      pricePts = 15; within = false;
      if (l.price > m.inHi) priceNote = `${fmtRM(l.price - m.inHi)} over budget 超出预算`;
      else priceNote = `${fmtRM(m.inLo - l.price)} below budget 低于预算`;
    }
  }
  // 5. minimums
  if (r.bedMin != null && !(l.bed >= r.bedMin)) return null;
  if (r.bathMin != null && !(l.bath >= r.bathMin)) return null;
  if (r.bankValueMin != null && !(l.bankValue >= r.bankValueMin)) return null;

  let score = 30 + 15 + pricePts + 8 + 5;
  const reasons = [`Area 区域: ${hit.label}`, `Type 类型: ${l.type} ${TYPE_ZH[l.type] || ''}`];
  if (priceNote) reasons.push(priceNote);
  else reasons.push('Budget open 预算不限');
  if (r.bedMin != null) reasons.push(`${l.bed} bed ≥ ${r.bedMin} 房`);
  if (r.bathMin != null) reasons.push(`${l.bath} bath ≥ ${r.bathMin} 厕`);
  if (r.furnishing) {
    if (l.furnishing === r.furnishing) { score += 6; reasons.push(`${l.furnishing} 家私符合`); }
    else if (!l.furnishing) score += 3;
  } else score += 6;
  if (r.mustHave && r.mustHave.length) {
    const have = r.mustHave.filter((x) => (l.features || []).includes(x));
    score += Math.round((6 * have.length) / r.mustHave.length);
    if (have.length) reasons.push('Has 具备: ' + have.join(', '));
  } else score += 6;
  score = Math.min(100, score);
  if (score < MIN_MATCH_SCORE) return null;
  return { score, within, priceNote, reasons };
}

/** Listings grouped by kind and sorted by price, for binary search on the price window. */
export function buildMatchIndex(listings, now = Date.now()) {
  const cut = cutoffTime(now);
  const idx = { sale: { priced: [], noPrice: [] }, rent: { priced: [], noPrice: [] } };
  for (const l of listings) {
    prepareListing(l);
    if (l._t < cut || !idx[l.kind]) continue;
    (l.price == null ? idx[l.kind].noPrice : idx[l.kind].priced).push(l);
  }
  for (const k of ['sale', 'rent']) idx[k].priced.sort((a, b) => a.price - b.price);
  return idx;
}

function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].price < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/** All pairs for one prepared request. */
export function matchRequest(r, index) {
  const out = [];
  const m = r._m;
  if (!m || !r.kind || !m.areaPhrases.length || !index[r.kind]) return out;
  const { priced, noPrice } = index[r.kind];
  const start = m.hasBudget ? lowerBound(priced, m.lo) : 0;
  for (let i = start; i < priced.length; i++) {
    const l = priced[i];
    if (l.price > m.hi) break;
    const e = evaluatePair(l, r);
    if (e) out.push({ listing: l, request: r, ...e });
  }
  if (!m.hasBudget) for (const l of noPrice) { const e = evaluatePair(l, r); if (e) out.push({ listing: l, request: r, ...e }); }
  return out;
}

/** All pairs for one listing (used for the "N matching clients" button). */
export function matchListing(l, preparedRequests) {
  prepareListing(l);
  const out = [];
  for (const r of preparedRequests) {
    if (r.status === 'closed' || r.kind !== l.kind) continue;
    const e = evaluatePair(l, r);
    if (e) out.push({ listing: l, request: r, ...e });
  }
  return out.sort((a, b) => b.score - a.score);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const yieldToUI = () => new Promise((res) => setTimeout(res, 0));

/**
 * Run fn over items in ~12ms slices so the UI never freezes.
 * isCurrent() returns false when a newer run started (generation token) → stop quietly.
 */
export async function runSliced(items, fn, { sliceMs = 12, isCurrent = () => true, onProgress } = {}) {
  let i = 0;
  while (i < items.length) {
    const t0 = now();
    while (i < items.length && now() - t0 < sliceMs) fn(items[i++], i - 1);
    if (!isCurrent()) return false;
    if (onProgress) onProgress(i / items.length);
    if (i < items.length) await yieldToUI();
    if (!isCurrent()) return false;
  }
  return true;
}

/** Match many requests, sliced. Returns pairs sorted by score (or null if cancelled). */
export async function matchAll(preparedRequests, index, opts = {}) {
  const pairs = [];
  const ok = await runSliced(preparedRequests, (r) => {
    if (r.status === 'closed') return;
    const ps = matchRequest(r, index);
    for (const p of ps) pairs.push(p);
  }, opts);
  if (!ok) return null;
  pairs.sort((a, b) => b.score - a.score || b.listing._t - a.listing._t);
  return pairs;
}
