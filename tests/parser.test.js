import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatText, groupFromFileName, sourceForGroup, isZip, fileBytesToText } from '../listinghub/js/core/whatsapp.js';
import { parseMessage, analyseRequest } from '../listinghub/js/core/parse.js';
import { classifyProperty, detectRegion } from '../listinghub/js/core/classify.js';
import { parseBudget, extractPrice } from '../listinghub/js/core/price.js';
import { parseRequestAreas, recoverAreas, buildAreaVocab } from '../listinghub/js/core/areas.js';
import { displayName, stripEmoji } from '../listinghub/js/core/text.js';
import { T } from '../listinghub/js/core/constants.js';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { L, R, androidExport, iphoneExport } from './fixtures.js';

const msg = (text, sender = 'Agent A') => ({ sender, text, postedAt: '2026-11-09T09:00:00+08:00', day: '2026-11-09', hash: 'h' + text.length });
const listing = (text) => parseMessage(msg(text)).item;

test('group name and source from file name', () => {
  assert.equal(groupFromFileName('WhatsApp Chat with JB TRR Rent 1 Listing Group.zip'), 'JB TRR Rent 1 Listing Group');
  assert.equal(groupFromFileName('WhatsApp Chat - EAG 卓越 Listing (2).zip'), 'EAG 卓越 Listing');
  assert.equal(sourceForGroup('EAG 卓越 Listing'), 'EAG Listing');
  assert.equal(sourceForGroup('JB TRR Rent 1 Listing Group'), 'TRR Group');
});

test('group → source: EAG Listing / TRR Groups / Co Agency (owner\'s list)', () => {
  const expect = {
    'EAG Listing': ['EAG 卓越 Sale Listing 🏡🚀💰'],
    'TRR Group': [
      'Topsales listing group(Only For Sales)', 'JB TRR Rent 1 Listing Group 💯', 'JB TRR 吹水站(Only For Sale)',
      'JB TRR 吹水站 3(Only For Sale)', 'TRR JB Sharing Group', 'TMS + EAG Listing', 'EAT Cobroke Group',
      'TPG + EAG listing group', 'TAG + EAG Listing Group', 'Victor Land Group 地皮买卖群🌳🌴', 'TRR GV Land Group',
    ],
    'Co Agency': [
      'Factory 工厂 For Sale & Rent Cobroke Group', 'JOHOR Factory Shop Land', 'JB Property｜BuySaleRent Listing CoBroke Stock📈',
      'Com Gao Gao AAA Group', '全马房地产(出租)', '全马房地产(买卖)', 'For Sale 卖货 Tank Group', 'Prosper CoSharing Space🏘️🏭',
      'Rent 佞家 Group', 'Sky Ang co-broke stocks', 'Some brand new group',
    ],
  };
  for (const [source, groups] of Object.entries(expect)) for (const g of groups) assert.equal(sourceForGroup(g), source, g);
  // admin override wins
  assert.equal(sourceForGroup('Sky Ang co-broke stocks', { 'sky ang co-broke stocks': 'TRR Group' }), 'TRR Group');
});

test('Android and iPhone formats, multi-line messages, system lines skipped', () => {
  const a = parseChatText(androidExport([['Ali', 'line one\nline two'], ['Bob', 'hello there']]));
  assert.equal(a.length, 2);
  assert.equal(a[0].text, 'line one\nline two');
  assert.equal(a[0].sender, 'Ali');
  assert.equal(a[0].day, '2026-11-09');
  const i = parseChatText(iphoneExport([['Ali', 'line one\nline two']]));
  assert.equal(i.length, 1);
  assert.equal(i[0].text, 'line one\nline two');
  // same message exported from Android and iPhone → same hash (seconds and sender spelling don't matter)
  const a2 = parseChatText(androidExport([['+60 12-345 6789', 'line one\nline two']]));
  assert.equal(a2[0].hash, i[0].hash);
});

test('12-hour times and 2-digit years', () => {
  const m = parseChatText('9/11/26, 9:15 pm - Ali: test message\n[09/11/2026, 9:16:01 PM] Bob: another one');
  assert.equal(m.length, 2);
  assert.ok(m[0].postedAt.startsWith('2026-11-09T21:15'));
  assert.ok(m[1].postedAt.startsWith('2026-11-09T21:16'));
});

test('not a WhatsApp export → error', () => {
  assert.throws(() => parseChatText('hello\nthis is a normal file'), /NOT_WHATSAPP/);
});

test('zip detected by content, not extension', () => {
  const zip = zipSync({ '_chat.txt': strToU8(iphoneExport([['Ali', 'hello from zip']])), 'IMG-001.jpg': new Uint8Array([1, 2, 3]) });
  assert.ok(isZip(zip));
  const text = fileBytesToText(zip, unzipSync);
  assert.match(text, /hello from zip/);
  assert.ok(!isZip(strToU8('plain text')));
});

test('name override', () => {
  assert.equal(displayName('宝贝老公 hubby M'), 'Roy Goh');
  assert.equal(listing(L.molekTerrace) && parseMessage(msg(L.molekTerrace, '宝贝老公 hubby M')).item.renName, 'Roy Goh');
});

test('listing fields', () => {
  const l = listing(L.molekTerrace);
  assert.equal(l.kind, 'sale');
  assert.equal(l.category, 'Residential');
  assert.equal(l.type, T.TER2);
  assert.equal(l.region, 'Molek / Daya');
  assert.equal(l.price, 780000);
  assert.equal(l.bankValue, 820000);
  assert.equal(l.bed, 4);
  assert.equal(l.bath, 3);
  assert.equal(l.sqft, 2200);
  assert.equal(l.dims, '24x80');
  assert.equal(l.land, 1920);
  assert.equal(l.tenure, 'Freehold');
  assert.ok(l.features.includes('Corner lot'));
  assert.ok(l.features.includes('Facing main road'));
  assert.equal(l.renPhone, '60123456789');
  assert.match(l.title, /Taman Molek/);

  const r = listing(L.johorJayaRent);
  assert.equal(r.kind, 'rent');
  assert.equal(r.price, 1600);
  assert.equal(r.bed, 3);
  assert.equal(r.bath, 2);
  assert.equal(r.region, 'Johor Jaya');
  assert.equal(r.furnishing, 'Partially furnished');

  assert.equal(listing(L.suteraShop).type, T.RETAIL);
  assert.equal(listing(L.gelangFactory).category, 'Industrial');
  assert.equal(listing(L.gelangFactory).region, 'Iskandar Puteri');
  assert.equal(listing(L.johorLand).type, T.ALAND);
  assert.equal(listing(L.johorLand).price, 3500000);
});

test('Bumi / Non-bumi lot are not confused, and are not a lot position', () => {
  const f = (t) => listing('For sale\nTaman Test double storey terrace\n' + t + '\nPrice RM 500k').features;
  assert.ok(f('Bumi lot').includes('Bumi lot') && !f('Bumi lot').includes('Non-bumi'));
  assert.ok(f('Non-bumi lot').includes('Non-bumi') && !f('Non-bumi lot').includes('Bumi lot'));
  assert.ok(f('non bumi lot').includes('Non-bumi') && !f('non bumi lot').includes('Bumi lot'));
  assert.ok(f('非土著').includes('Non-bumi') && !f('非土著').includes('Bumi lot'));
  assert.ok(f('Corner lot').includes('Corner lot'));
});

test('chit-chat and sold messages are ignored', () => {
  assert.equal(parseMessage(msg('Good morning all 🙏')).cls, 'ignore');
  assert.equal(parseMessage(msg('SOLD')).cls, 'ignore');
  assert.equal(parseMessage(msg('This message was deleted')).cls, 'ignore');
});

test('request head words: WTB / WTR / 求购 / 求租 / buyer / tenant', () => {
  assert.equal(parseMessage(msg('WTB condo Mount Austin budget 400k')).item.kind, 'sale');
  assert.equal(parseMessage(msg('WTR condo Mount Austin budget 2k')).item.kind, 'rent');
  assert.equal(parseMessage(msg('求购 Mount Austin 双层排屋 预算 70万')).item.kind, 'sale');
  assert.equal(parseMessage(msg('求租 Molek 公寓 预算 RM2000')).item.kind, 'rent');
  assert.equal(parseMessage(msg('Tenant looking Molek condo 2k')).item.kind, 'rent');
  assert.equal(parseMessage(msg('Buyer looking Molek condo 500k')).cls, 'request');
});

test('land rules', () => {
  assert.equal(classifyProperty('WTB Johor area 20–50 acres', 'request').category, 'Land');
  assert.equal(classifyProperty('WTB tanah Kulai', 'request').category, 'Land');
  assert.equal(classifyProperty('WTB landed house Kulai', 'request').category, 'Residential');
  const f = classifyProperty('WTR detach factory Senai, land 6 acres', 'request');
  assert.equal(f.category, 'Industrial');
  assert.deepEqual(f.types, [T.FACTORY]);
  assert.deepEqual(classifyProperty('WTB factory land Senai 3 acres', 'request').types, [T.ILAND]);
  assert.deepEqual(classifyProperty('WTB industrial land Pasir Gudang', 'request').types, [T.ILAND]);
  // a house listing that states its land area is still a house
  assert.equal(classifyProperty('For sale double storey terrace, land area 22x75', 'listing').category, 'Residential');
});

test('commercial and industrial rules', () => {
  const s = classifyProperty('WTB 2 storey shoplot Skudai', 'request');
  assert.equal(s.category, 'Commercial');
  assert.ok(!s.types.includes(T.TER2));
  assert.equal(classifyProperty('WTR 店面 Molek', 'request').category, 'Commercial');
  assert.equal(classifyProperty('WTR 门店 Molek', 'request').category, 'Commercial');
  assert.equal(classifyProperty('WTR warehouse Tebrau', 'request').category, 'Industrial');
  assert.equal(classifyProperty('WTR kilang Tebrau', 'request').category, 'Industrial');
  assert.equal(classifyProperty('求租 厂房 Senai', 'request').category, 'Industrial');
  assert.equal(classifyProperty('找厂 Kulai', 'request').category, 'Industrial');
  assert.equal(classifyProperty('WTR car workshop 修车厂底楼店面 Tampoi', 'request').category, 'Commercial');
  assert.equal(classifyProperty('For rent Pasir Gudang double storey terrace', 'listing').category, 'Residential');
});

test('budget parsing', () => {
  assert.deepEqual(pick(parseBudget('WTB condo budget 1m-2m', 'sale')), [1e6, 2e6]);
  assert.deepEqual(pick(parseBudget('WTB budget 1-2m', 'sale')), [1e6, 2e6]);
  assert.deepEqual(pick(parseBudget('WTB below 600k', 'sale')), [null, 600000]);
  assert.deepEqual(pick(parseBudget('WTB 60万以下', 'sale')), [null, 600000]);
  assert.deepEqual(pick(parseBudget('WTR budget 2000++', 'rent')), [2000, null]);
  assert.deepEqual(pick(parseBudget('WTR above RM2000', 'rent')), [2000, null]);
  assert.deepEqual(pick(parseBudget('WTR 2000以上', 'rent')), [2000, null]);
  assert.deepEqual(pick(parseBudget('WTR budget RM4.5k/month', 'rent')), [4500, 4500]);
  assert.deepEqual(pick(parseBudget('WTB budget follow market', 'sale')), [null, null]);
  assert.deepEqual(pick(parseBudget('WTB budget open', 'sale')), [null, null]);
  assert.deepEqual(pick(parseBudget('WTR budget 3000-5000', 'rent')), [3000, 5000]);
});
const pick = (b) => [b.budgetMin, b.budgetMax];

test('request areas', () => {
  assert.deepEqual(parseRequestAreas(R.suteraShop), ['Sutera Utama']);
  assert.deepEqual(parseRequestAreas(R.factory), ['Gelang Patah', 'Silc', 'Nusa Cemerlang']);
  assert.deepEqual(parseRequestAreas(R.johorLand), []);
  assert.deepEqual(parseRequestAreas(R.pelangi), ['Pelangi']);
  assert.deepEqual(parseRequestAreas('WTR condo Johor Jaya'), ['Johor Jaya']);
  assert.deepEqual(parseRequestAreas('WTB⁠ condo Mount⁠ Austin'), ['Mount Austin']);
  assert.deepEqual(parseRequestAreas('WTB JB any area condo'), []);
  assert.deepEqual(parseRequestAreas('WTR\nArea: Molek / Austin\nBudget 2k'), ['Molek', 'Austin']);
});

test('area recovery from listing vocabulary ignores signature lines', () => {
  const vocab = buildAreaVocab([{ title: 'Taman Setia Indah', area: 'Jalan Setia 5/1, Taman Setia Indah' }, { title: 'Eco Palladium', area: 'Eco Palladium' }]);
  const text = 'WTR 3 rooms setia indah 2k please\nJane, Eco Palladium Realty REN 1234 0123334444';
  // setia indah is found via the parser; eco palladium only appears in the signature
  assert.deepEqual(recoverAreas(text, vocab), ['Setia Indah']);
  assert.deepEqual(recoverAreas('wtr unit near eco palladium 1.5k', vocab), ['Eco Palladium']);
});

test('region detection ignores nearby lines and respects order', () => {
  assert.equal(detectRegion('Taman Daya\nNearby Mount Austin, Tebrau'), 'Molek / Daya');
  assert.equal(detectRegion('Setia Indah\n5 mins to Austin'), 'Tebrau');
  assert.equal(detectRegion('Taman Sutera'), 'Other');
});

test('emoji stripped for WhatsApp text', () => {
  assert.equal(stripEmoji('🏡 FOR SALE 🏡 ✅ ok'), ' FOR SALE ok');
});

test('analyseRequest full fields', () => {
  const r = analyseRequest('WTR Mount Austin condo 3 rooms 2 bath fully furnished\nBudget RM 2,000 - 2,500\nClient: Mr Lim');
  assert.equal(r.kind, 'rent');
  assert.deepEqual(r.types, [T.CONDO]);
  assert.equal(r.budgetMin, 2000);
  assert.equal(r.budgetMax, 2500);
  assert.equal(r.bedMin, 3);
  assert.equal(r.bathMin, 2);
  assert.equal(r.furnishing, 'Fully furnished');
  assert.deepEqual(r.areas, ['Mount Austin']);
});

test('price extraction ignores maintenance and deposit', () => {
  const p = extractPrice('For rent condo\nMaintenance RM 300\nDeposit 2+1\nRental RM 1,800', 'rent');
  assert.equal(p.price, 1800);
});

test('text is cut and stored without half characters (the database rejects them)', async () => {
  const { cut, scrubText } = await import('../listinghub/js/core/text.js');
  const { toStored } = await import('../listinghub/js/core/importer.js');
  const bold = '𝐅𝐨𝐫 𝐒𝐚𝐥𝐞'.repeat(12); // each letter is 2 UTF-16 units
  for (let n = 1; n < 40; n++) assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut(bold, n)), 'cut at ' + n);
  assert.equal(cut('short', 80), 'short');
  assert.equal(scrubText('ok \uD835 broken'), 'ok � broken');
  const stored = toStored({ id: 'x', title: 'a\uD83D', features: ['b\uDC56'], n: 5 });
  assert.equal(JSON.stringify(stored).includes('\\ud8'), false);
  assert.equal(stored.n, 5);
  // a real title that used to be cut mid-letter
  const l = listing(`FOR SALE\n${'𝐭𝐨𝐫𝐞𝐲 古来双层排屋 𝐅𝐨𝐫 𝐒𝐚𝐥𝐞 '.repeat(5)}\nPrice RM 500k\n0123456789`);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(l.title));
});

test('iPhone exports set to Chinese: [2026/11/05 下午3:45:12], 晚上/凌晨/中午, media and system lines', () => {
  const text = [
    '[2026/11/05 下午9:00:00] 群组名: ‎讯息和通话已端对端加密。只有此聊天中的成员才能阅读、收听或分享。',
    '[2026/11/05 下午3:45:12] Agent A: For Rent\nSutera Utama shop lot\nRental RM 4,500\n0123456789',
    '‎[2026/11/05 晚上11:50:01] Agent B: ‎图像已忽略',
    '[2026/11/6 凌晨12:05:30] Agent C: WTR Mount Austin condo budget 2000\n0129990000',
    '[2026/11/6 中午12:30:00] Agent D: For Sale\nTaman Molek double storey terrace\nPrice RM 700k\n0133334444',
    '[2026/11/6 上午9:15:00] Agent E: 早安',
  ].join('\n');
  const msgs = parseChatText(text);
  assert.equal(msgs.length, 4, 'encryption notice and 图像已忽略 are not messages');
  assert.equal(msgs[0].postedAt, '2026-11-05T15:45:12+08:00');
  assert.equal(msgs[1].postedAt, '2026-11-06T00:05:30+08:00');   // 凌晨12:05 = just after midnight
  assert.equal(msgs[2].postedAt, '2026-11-06T12:30:00+08:00');   // 中午12:30 = noon
  assert.equal(msgs[3].postedAt, '2026-11-06T09:15:00+08:00');
  assert.equal(msgs[0].day, '2026-11-05');
  assert.equal(parseChatText('[2026/11/05 晚上11:50:01] Agent B: hello there my friend')[0].postedAt, '2026-11-05T23:50:01+08:00');
});

test('Low Cost House 廉价屋: landed low-cost houses are their own type; low-cost FLATS stay Apartment / Flat', async () => {
  const { TYPES, TYPE_ZH } = await import('../listinghub/js/core/constants.js');
  assert.equal(TYPE_ZH['Low Cost House'], '廉价屋');
  assert.ok(TYPES.some((t) => t.id === 'Low Cost House' && t.cat === 'Residential'));
  const type = (text) => classifyProperty(text, 'listing').type;
  for (const s of [
    'Johor Jaya超美全装修3房2厕单层廉价屋 For Sale', '#Plentong 全装修美美 双层廉价屋 3Bed 3 Bath', 'Low cost house Taman Pelangi for sale', 'LOW COST HOUSE Ulu Tiram',
  ]) assert.equal(type(s), T.LOWCOST, s);
  // not written as "Low Cost House" → NOT this type
  for (const s of [
    'Low cost flat (level 4) Perling for sale', 'Flat Kos Rendah Plentong Untik Dijual 廉价组屋', 'Medium cost flat Skudai',
    'Perling 平价屋 3房 for sale', 'Low cost Plentong 3 bed for sale', 'Low cost 2 storey Taman Maju for sale', 'rumah kos rendah Ulu Tiram dijual',
  ]) assert.notEqual(type(s), T.LOWCOST, s);
  assert.equal(type('Taman Molek double storey terrace for sale'), T.TER2); // ordinary terraces are unchanged
  // requests
  assert.deepEqual(classifyProperty('WTB 廉价屋 Johor Jaya budget 300k', 'request').types, [T.LOWCOST]);
  assert.deepEqual(classifyProperty('WTR low cost flat Perling 1000', 'request').types, [T.APT]);
  assert.ok(classifyProperty('WTB landed house Kulai', 'request').types.includes(T.LOWCOST));
});

test('price: the line that labels the price wins over other amounts (market gap, tenant rent)', async () => {
  const { extractPrice } = await import('../listinghub/js/core/price.js');
  assert.equal(extractPrice('*低于market 150K‼️Kulai 4 storey Shop Lot For Sale*\nSelling Price: RM699K nego\nBank Value RM850K', 'sale').price, 699000);
  assert.equal(extractPrice('Shoplot\n✅ Tenanted 稳定租金 RM3000\n✅ ROI 4.8%\n💰Selling Price :RM780k nego\n💰Bank Value : RM800k', 'sale').price, 780000);
  assert.equal(extractPrice('For Rent Taman X\nRental: RM2,500', 'rent').price, 2500);
});

test('For Sale / For Rent wording decides the kind; "can pm" is not "per month"', async () => {
  const { listingKind } = await import('../listinghub/js/core/classify.js');
  assert.equal(listingKind('Price Drop to 698k\n- Can pm for video\n\nFor Sale ~RM718k~ RM698k Net\nCitrine Residenz\nGated Guarded RM220'), 'sale');
  assert.equal(listingKind('For rent Taman X RM2500 pm'), 'rent');
  assert.equal(listingKind('Taman X RM2,500 pm 3 bedrooms'), 'rent');
});

test('guard-fee "/Monthly" and "Selling Price" → For Sale at RM1.13m', async () => {
  const { listingKind } = await import('../listinghub/js/core/classify.js');
  const { extractPrice } = await import('../listinghub/js/core/price.js');
  const t = '*Kempas 全装修两层半排楼，省下最少150K装修费*\n\n2.5 Storey Terrace House\n24x70\nG&G Rm99/Monthly\n\nSelling Price : RM 1.13mil Nego\nBank Value RM1.15mil';
  assert.equal(listingKind(t), 'sale');
  assert.equal(extractPrice(t, 'sale').price, 1130000);
});
