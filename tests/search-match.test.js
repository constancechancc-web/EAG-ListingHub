import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../listinghub/js/core/parse.js';
import { searchListings } from '../listinghub/js/core/search.js';
import { buildMatchIndex, prepareRequest, matchRequest, matchListing, matchAll, evaluatePair } from '../listinghub/js/core/match.js';
import { buildAreaVocab } from '../listinghub/js/core/areas.js';
import { listingEnquiry, clientAgentMessage, waLink, DIVIDER, bankValueDiff, listingSummary } from '../listinghub/js/core/messages.js';

test('percent below / above bank value', () => {
  assert.equal(bankValueDiff({ kind: 'sale', price: 486000, bankValue: 600000 }), 19);
  assert.equal(bankValueDiff({ kind: 'sale', price: 660000, bankValue: 600000 }), -10);
  assert.equal(bankValueDiff({ kind: 'sale', price: null, bankValue: 600000 }), null);
  assert.equal(bankValueDiff({ kind: 'rent', price: 2000, bankValue: 600000 }), null);
  assert.match(listingSummary({ kind: 'sale', title: 'X', price: 486000, bankValue: 600000 }), /19% below BV 低于估价/);
});
import { phraseIn } from '../listinghub/js/core/text.js';
import { L, R } from './fixtures.js';

const now = Date.parse('2026-11-09T12:00:00+08:00');
let n = 0;
const mk = (text, sender = 'Agent') => {
  const out = parseMessage({ sender, text, postedAt: '2026-11-09T09:00:00+08:00', day: '2026-11-09', hash: 'x' + n++ });
  assert.ok(out.item, 'parsed: ' + text.slice(0, 40) + ' → ' + out.cls);
  return out.item;
};
const listings = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, mk(v)]));
const all = Object.values(listings);
const vocab = buildAreaVocab(all);
const index = buildMatchIndex(all, now);
const req = (text) => prepareRequest(mk(text, 'Kelly'), vocab);
const titles = (pairs) => pairs.map((p) => Object.keys(listings).find((k) => listings[k] === p.listing)).sort();

test('phrase search: Johor Jaya never matches only "Jaya"; molek yes, mole no', () => {
  const jj = searchListings(all, { q: 'Johor Jaya', now });
  assert.ok(jj.includes(listings.johorJayaRent));
  assert.ok(!jj.includes(listings.jayaOnly));
  assert.ok(searchListings(all, { q: 'molek', now }).includes(listings.molekTerrace));
  assert.equal(searchListings(all, { q: 'mole', now }).length, 0);
  assert.ok(searchListings(all, { q: 'MOLEK', now }).includes(listings.molekTerrace));
});

test('phrase search checks fields separately', () => {
  // title "Taman Molek..." + type "Terrace" must not join into "molek terrace" across fields
  assert.ok(!phraseIn('jaya double', 'Johor Jaya') );
  const res = searchListings(all, { q: 'Sutera Ground', now });
  assert.equal(res.length, 0);
});

test('phone digits search with 4+ digits', () => {
  const res = searchListings(all, { q: '345 6789', now });
  assert.ok(res.includes(listings.molekTerrace));
});

test('Chinese substring search', () => {
  const res = searchListings(all, { q: '双层排屋', now });
  assert.ok(res.includes(listings.molekTerrace));
});

test('filters: kind, category, price, bed, industrial sizes, 90-day retention', () => {
  assert.ok(searchListings(all, { kind: 'rent', now }).every((l) => l.kind === 'rent'));
  assert.ok(searchListings(all, { category: 'Industrial', sqftMin: 20000, now }).every((l) => l.sqft >= 20000));
  assert.ok(searchListings(all, { priceMin: 500000, priceMax: 600000, now }).every((l) => l.price >= 500000 && l.price <= 600000));
  assert.ok(searchListings(all, { bedMin: 4, now }).every((l) => l.bed >= 4));
  const later = Date.parse('2027-03-01T00:00:00+08:00');
  assert.equal(searchListings(all, { now: later }).length, 0);
});

test('ACCEPT: WTR Sutera Utama ground floor shoplot → only Sutera Utama shops', () => {
  const pairs = matchRequest(req(R.suteraShop), index);
  assert.deepEqual(titles(pairs), ['suteraShop']);
});

test('ACCEPT: WTR Factory Gelang Patah / SILC / Nusa Cemerlang / Other → factories only', () => {
  const r = req(R.factory);
  assert.ok(!r.areas.map((a) => a.toLowerCase()).includes('other'));
  const t = titles(matchRequest(r, index));
  assert.deepEqual(t, ['gelangFactory', 'silcFactory']);
});

test('ACCEPT: WTB Johor area 20–50 acres → land, no area, no matches', () => {
  const r = req(R.johorLand);
  assert.equal(r.category, 'Land');
  assert.deepEqual(r.areas, []);
  assert.equal(matchRequest(r, index).length, 0);
});

test('ACCEPT: Buyer looking Pelangi or nearby, double storey → only Pelangi double-storey terraces', () => {
  assert.deepEqual(titles(matchRequest(req(R.pelangi), index)), ['pelangiDouble']);
});

test('ACCEPT: rent budget 4,000 → 2,000–6,000 only', () => {
  const t = titles(matchRequest(req(R.austinRent4k), index));
  assert.deepEqual(t, ['austinRent4k']);
});

test('ACCEPT: sale budget 500k → 450k–550k only', () => {
  const t = titles(matchRequest(req(R.austinSale500), index));
  assert.deepEqual(t, ['austinSale500']);
});

test('price windows: ranges, below, and no budget', () => {
  const mkL = (price, kind = 'sale') => ({ ...listings.austinSale500, price, kind, hash: 'p' + price });
  const r = req('WTB Mount Austin double storey budget 1m-2m');
  const lo = buildMatchIndex([mkL(940000), mkL(950000), mkL(2050000), mkL(2060000)], now);
  assert.deepEqual(matchRequest(r, lo).map((p) => p.listing.price).sort(), [2050000, 950000].sort());
  const below = req('WTR Mount Austin double storey below 4000');
  const rents = buildMatchIndex([1500, 5900, 6100].map((p) => ({ ...listings.austinRent4k, price: p, hash: 'r' + p })), now);
  assert.deepEqual(matchRequest(below, rents).map((p) => p.listing.price).sort((a, b) => a - b), [1500, 5900]);
  const open = req('WTB Mount Austin double storey budget open');
  const noPrice = buildMatchIndex([{ ...listings.austinSale500, price: null, hash: 'np' }], now);
  assert.equal(matchRequest(open, noPrice).length, 1);
  // budget given + listing without price → no match
  assert.equal(matchRequest(req('WTB Mount Austin double storey 500k'), noPrice).length, 0);
});

test('score: inside budget = full points, margin = half, labels', () => {
  const r = req(R.austinSale500);
  const p = evaluatePair(listings.austinSale500, r);
  assert.ok(p.score >= 50);
  assert.match(p.priceNote, /over budget/);
  const exact = evaluatePair({ ...listings.austinSale500, price: 480000 }, r);
  assert.match(exact.priceNote, /Within budget/);
  assert.ok(exact.score > p.score);
});

test('type exact: unknown types never match; shoplot never factory; land never condo', () => {
  const r = req('WTR Gelang Patah shoplot');
  assert.deepEqual(titles(matchRequest(r, index)), ['gelangShop']);
  const unknown = req('WTR Mount Austin something 4000');
  assert.equal(matchRequest(unknown, index).length, 0);
});

test('bed/bath minimums', () => {
  const r = req('WTR Mount Austin double storey 5 rooms budget 4000');
  assert.equal(matchRequest(r, index).length, 0);
  const r2 = req('WTR Mount Austin double storey 4 rooms budget 4000');
  assert.equal(matchRequest(r2, index).length, 1);
});

test('matchListing and sliced matchAll handle many requests', async () => {
  const reqs = [];
  for (let i = 0; i < 1200; i++) reqs.push(req(i % 2 ? R.austinRent4k : R.suteraShop));
  const pairs = await matchAll(reqs, index, { sliceMs: 12 });
  assert.equal(pairs.length, 1200);
  assert.equal(matchListing(listings.suteraShop, reqs).length, 600);
  // a newer run cancels the old one
  let gen = 1;
  const p = matchAll(reqs, index, { isCurrent: () => gen === 1, sliceMs: 0.01 });
  gen = 2;
  assert.equal(await p, null);
});

test('WhatsApp texts', () => {
  const l = listings.molekTerrace;
  const en = listingEnquiry('Amy', l, 'en');
  assert.ok(en.startsWith("Hi, I'm Amy from TRREAG, may I know the listing below is it still available?\n\n"));
  assert.ok(!/🏡/.test(en));
  assert.ok(listingEnquiry('Amy', l, 'zh').startsWith('你好，我是 TRREAG 的 Amy，请问下面这个单位还有吗？'));
  const r = mk(R.suteraShop);
  const c = clientAgentMessage('Amy', r, l, 'en');
  assert.ok(c.startsWith("Hi I'm Amy from TRREAG, i have a property might suite to ur client, if u interested pls let me know, tq"));
  assert.ok(c.indexOf('WTR Sutera') < c.indexOf(DIVIDER) && c.indexOf(DIVIDER) < c.indexOf('Taman Molek'));
  assert.match(waLink('012-345 6789', 'hi'), /^https:\/\/wa\.me\/60123456789\?text=hi$/);
});
