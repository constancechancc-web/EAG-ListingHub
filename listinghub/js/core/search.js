// Listing search: plain code in the browser, no AI. Exact-phrase keyword per field.
import { prepField, compilePhrase, fieldHas, digitsOnly } from './text.js';
import { TYPE_ZH, RETENTION_DAYS } from './constants.js';

/** Precompute lowercase search forms once per listing (stored on a non-enumerable-ish `_f`). */
export function prepareListing(l) {
  if (l._f) return l;
  const fields = [l.title, l.area, l.region, l.renName, l.group, l.type, TYPE_ZH[l.type], ...(l.features || [])]
    .filter(Boolean)
    .map(prepField);
  Object.defineProperty(l, '_f', { value: { fields, phone: digitsOnly(l.renPhone), title: prepField(l.title), area: prepField(l.area), region: prepField(l.region), ren: prepField(l.renName) }, enumerable: false });
  Object.defineProperty(l, '_t', { value: Date.parse(l.postedAt) || 0, enumerable: false });
  return l;
}

export function keywordMatch(l, phrase) {
  if (!phrase) return true;
  const f = l._f;
  if (phrase.digits && f.phone.includes(phrase.digits)) return true;
  for (const fld of f.fields) if (fieldHas(phrase, fld)) return true;
  return false;
}

export function cutoffTime(now = Date.now(), days = RETENTION_DAYS) {
  return now - days * 86400000;
}

/**
 * filters: { kind, category, type, region, priceMin, priceMax, bedMin, source, sqftMin, sqftMax, landMin, landMax, q, now }
 */
export function searchListings(listings, filters = {}) {
  const phrase = compilePhrase(filters.q || '');
  const cut = cutoffTime(filters.now);
  const n = (v) => (v === '' || v == null ? null : +v);
  const pMin = n(filters.priceMin), pMax = n(filters.priceMax), bMin = n(filters.bedMin);
  const sMin = n(filters.sqftMin), sMax = n(filters.sqftMax), lMin = n(filters.landMin), lMax = n(filters.landMax);
  const ind = filters.category === 'Industrial';
  const out = [];
  for (const l of listings) {
    prepareListing(l);
    if (l._t < cut) continue;
    if (filters.kind && l.kind !== filters.kind) continue;
    if (filters.category && l.category !== filters.category) continue;
    if (filters.type && l.type !== filters.type) continue;
    if (filters.region && l.region !== filters.region) continue;
    if (filters.source && l.source !== filters.source) continue;
    if (pMin != null && !(l.price >= pMin)) continue;
    if (pMax != null && !(l.price != null && l.price <= pMax)) continue;
    if (bMin != null && !(l.bed >= bMin)) continue;
    if (ind) {
      if (sMin != null && !(l.sqft >= sMin)) continue;
      if (sMax != null && !(l.sqft != null && l.sqft <= sMax)) continue;
      if (lMin != null && !(l.land >= lMin)) continue;
      if (lMax != null && !(l.land != null && l.land <= lMax)) continue;
    }
    if (!keywordMatch(l, phrase)) continue;
    out.push(l);
  }
  out.sort((a, b) => b._t - a._t);
  return out;
}
