import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../listinghub/js/core/parse.js';
import { searchListings } from '../listinghub/js/core/search.js';
import { buildMatchIndex, prepareRequest, matchAll } from '../listinghub/js/core/match.js';
import { buildAreaVocab } from '../listinghub/js/core/areas.js';

const areas = ['Mount Austin', 'Taman Molek', 'Setia Indah', 'Johor Jaya', 'Permas Jaya', 'Bukit Indah', 'Skudai', 'Kulai', 'Pelangi', 'Tampoi'];
const types = ['double storey terrace', 'condo', 'semi-d', 'shop lot', 'factory'];

test('5,000 listings × 1,000 requests: search < 50ms, matching completes in slices', async () => {
  const listings = [];
  for (let i = 0; i < 5000; i++) {
    const rent = i % 2 === 0;
    const price = rent ? 800 + (i % 50) * 100 : 300000 + (i % 80) * 10000;
    const text = `${rent ? 'For rent' : 'For sale'}\n${areas[i % areas.length]} ${types[i % types.length]}\n${rent ? 'Rental' : 'Price'} RM ${price.toLocaleString()}\nref ${i}`;
    listings.push(parseMessage({ sender: 'A' + (i % 80), text, postedAt: '2026-11-09T09:00:00+08:00', day: '2026-11-09', hash: 'l' + i }).item);
  }
  const vocab = buildAreaVocab(listings);
  const reqs = [];
  for (let i = 0; i < 1000; i++) {
    const rent = i % 2 === 0;
    const text = `${rent ? 'WTR' : 'WTB'} ${areas[i % areas.length]} ${types[(i * 3) % types.length]}\nBudget RM ${rent ? 2000 + (i % 10) * 200 : 400000 + (i % 10) * 20000}`;
    reqs.push(prepareRequest(parseMessage({ sender: 'B', text, postedAt: '2026-11-09T09:00:00+08:00', day: '2026-11-09', hash: 'r' + i }).item, vocab));
  }
  const now = Date.parse('2026-11-09T12:00:00+08:00');
  searchListings(listings, { q: 'x', now }); // warm-up (precompute)
  let t0 = performance.now();
  const res = searchListings(listings, { q: 'Johor Jaya', now });
  const searchMs = performance.now() - t0;
  assert.ok(res.length > 0 && res.every((l) => /Johor Jaya/.test(l.title)));
  assert.ok(searchMs < 50, 'search took ' + searchMs.toFixed(1) + 'ms');

  t0 = performance.now();
  const index = buildMatchIndex(listings, now);
  let slices = 0;
  const pairs = await matchAll(reqs, index, { sliceMs: 12, onProgress: () => slices++ });
  const matchMs = performance.now() - t0;
  assert.ok(pairs.length > 0);
  assert.ok(matchMs < 5000, 'matching took ' + matchMs.toFixed(0) + 'ms');
  console.log(`search ${searchMs.toFixed(1)}ms · match ${matchMs.toFixed(0)}ms in ${slices} slices · ${pairs.length} pairs`);
});
