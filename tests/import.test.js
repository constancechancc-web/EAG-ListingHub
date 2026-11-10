import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatText } from '../listinghub/js/core/whatsapp.js';
import { processMessages, appendToPacks, byDay } from '../listinghub/js/core/importer.js';
import { L, R, androidExport, iphoneExport } from './fixtures.js';

const items = [['Alan', L.molekTerrace], ['Kelly', R.suteraShop], ['Bob', 'good morning all'], ['Cindy', L.suteraShop]];

test('importing the same chat twice adds 0 new items', () => {
  const fileName = 'WhatsApp Chat with JB TRR Rent 1 Listing Group.zip';
  const msgs = parseChatText(androidExport(items));
  const seen = new Set();
  const first = processMessages(msgs, { fileName, seen });
  assert.equal(first.listings.length, 2);
  assert.equal(first.requests.length, 1);
  assert.equal(first.source, 'TRR Group');
  first.newHashes.forEach((h) => seen.add(h.hash));
  const second = processMessages(msgs, { fileName, seen });
  assert.equal(second.listings.length + second.requests.length, 0);
  assert.equal(second.duplicates, msgs.length);
  // the same group exported by someone else on an iPhone
  const third = processMessages(parseChatText(iphoneExport(items)), { fileName: 'WhatsApp Chat - JB TRR Rent 1 Listing Group.zip', seen });
  assert.equal(third.listings.length + third.requests.length, 0);
});

test('EAG 卓越 group → EAG Listing source', () => {
  const r = processMessages(parseChatText(androidExport(items)), { fileName: 'WhatsApp Chat with EAG 卓越 房源群.txt' });
  assert.equal(r.source, 'EAG Listing');
  assert.equal(r.listings[0].source, 'EAG Listing');
});

test('day-packs: split by size and skip hashes already stored', () => {
  const its = Array.from({ length: 50 }, (_, i) => ({ hash: 'h' + i, day: '2026-11-09', raw: 'x'.repeat(200) }));
  const packs = appendToPacks('L', '2026-11-09', [], its, 3000);
  assert.ok(packs.length > 1);
  assert.equal(packs.reduce((s, p) => s + p.items.length, 0), 50);
  assert.equal(packs[0].id, 'L_2026-11-09_0');
  const again = appendToPacks('L', '2026-11-09', packs, its, 3000);
  assert.equal(again.length, 0);
  assert.equal(byDay(its).get('2026-11-09').length, 50);
});

test('large file parses quickly (20MB-class)', () => {
  const big = [];
  for (let i = 0; i < 40000; i++) big.push([`Agent ${i % 80}`, L.molekTerrace.replace('780k', `${700 + (i % 200)}k`) + '\nref ' + i]);
  const text = androidExport(big);
  const t0 = Date.now();
  const msgs = parseChatText(text);
  const res = processMessages(msgs, { fileName: 'x.txt' });
  const ms = Date.now() - t0;
  assert.ok(text.length > 10e6, 'fixture size ' + text.length);
  assert.equal(res.listings.length, 40000);
  assert.ok(ms < 30000, 'took ' + ms + 'ms');
});

test('re-posts: same agent + same text = one listing (newest kept); other agent / other text stays separate', () => {
  const post = 'FOR RENT\nSutera Utama ground floor shop\nRental RM 4,500\n0123456780';
  const day = (d, t) => `${d}, ${t} - `;
  const text = [
    `${day('01/11/2026', '09:00')}Cindy: ${post}`,
    `${day('02/11/2026', '09:30')}Cindy: ${post}`,
    `${day('05/11/2026', '10:15')}Cindy: ${post.toUpperCase()} `,   // same text, different case / spacing
    `${day('05/11/2026', '10:20')}Cindy: ${post.replace('4,500', '4,200')}`, // price changed → a different listing
    `${day('05/11/2026', '10:25')}Bob: ${post.replace('0123456780', '0129990000')}`, // another agent
  ].join('\n');
  const res = processMessages(parseChatText(text), { fileName: 'WhatsApp Chat - Test.txt' });
  assert.equal(res.listings.length, 3);
  assert.equal(res.merged, 2);
  const cindy = res.listings.find((l) => l.renName === 'Cindy' && l.price === 4500);
  assert.ok(cindy.postedAt.startsWith('2026-11-05T10:15'), 'newest copy kept: ' + cindy.postedAt);
  // the id does not depend on the message time, so the same listing re-posted in a later import has the same id
  const later = processMessages(parseChatText(`${day('09/11/2026', '08:00')}Cindy: ${post}`), { fileName: 'x.txt' });
  assert.equal(later.listings[0].id, cindy.id);
});
