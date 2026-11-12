// Rule-based classification: kind, category/type, region and property details.
import { REGIONS, T, LANDED_TYPES, TYPE_CAT } from './constants.js';
import { norm, wordForm, compilePhrase, fieldHas, stripInvisible } from './text.js';

export const RX = {
  indLand: /factory land|industrial land|industry land|tanah (?:industri|perindustrian)|工业地|工业用地|厂地/,
  comLand: /commercial land|tanah (?:komersial|perdagangan)|商业地|商业用地/,
  agriLand: /agri(?:cultur(?:e|al))?\s*land|tanah (?:pertanian|kebun)|农业地|农地|农业用地|plantation land|\bkebun\b|orchard|果园|榴莲园|sawit|oil palm/,
  resLand: /residential land|housing land|tanah (?:kediaman|lot banglo)|bungalow land|bungalow lot|住宅地|住宅用地|建屋地|屋地/,
  strongLand: /\btanah\b|土地(?!面积)|地皮|\bacres?\b|\bekar\b|英亩|vacant land|empty land|\bland for (?:sale|rent)|land sale|piece of land|lot tanah/,
  landWord: /\bland\b|\bvacant lot\b/,
  factory: /factory|warehouse|kilang|厂房|工厂|找厂|仓库|(?<!pasir )\bgudang\b|light industr|heavy industr|medium industr|industrial (?:building|unit|lot|park)|\bworkshop\b/,
  shopStrict: /shop\s*-?\s*lot|shoplot|shop\s*office|shop\s*house|shophouse|店面|门店|店屋|商铺|店铺|kedai pejabat|retail lot|retail unit|retail shop/,
  shopLoose: /\bshops?\b|\bretail\b|\bkedai\b|\bkiosk\b|mall unit|\bf&b\b|\bcafe\b|restaurant|餐厅|商场/,
  shopOffice: /shop\s*office|shop\s*house|shophouse|店屋|kedai pejabat|\d(?:\.5)?\s*-?\s*(?:storey|story|sty|stry|层)\s*shop|(?:double|single|triple|two|three|1|2|3)\s*-?\s*(?:storey|story|sty)\s*(?:shop|commercial)|whole unit shop|整间店/,
  office: /\boffice\b|办公室|写字楼|pejabat|office suite|office space/,
  cluster: /cluster|田字/,
  semid: /\bsemi[\s-]*d\b|semi[\s-]*detach|\bsemid\b|\bsemi[\s-]*dee\b|半独立|双拼/,
  bung: /bungalow|banglo|独立洋房|独立屋|独立式|\bdetach(?:ed)?\s+(?:house|home|unit)|\bdetached\b/,
  town: /town\s*house|townhouse|联排|town\s*villa/,
  condo: /condo|condominium|serviced?\s*(?:residence|residences|apartment|suite)s?|公寓|\bsoho\b|\bsovo\b|\bsofo\b|residensi|\bstudio\b/,
  apt: /apartment|\bapt\b|\bflat\b|\bflats\b|pangsapuri|组屋|平价屋|low[\s-]*cost|medium[\s-]*cost|rumah pangsa|\bppr\b/,
  terrace: /terrace|teres|link\s*house|排屋|\b(?:single|double|triple|two|three)\s*-?\s*(?:storey|story|sty|stry|stories|storeys)\b|\d(?:\.5)?\s*-?\s*(?:storey|story|sty|stry|stories|storeys)\b|单层|双层|两层|三层|一层半|两层半|\d(?:\.5)?\s*tingkat|setingkat|dua tingkat/,
  landed: /\blanded\b|有地|\bhouses?\b|\brumah\b/,
  // Low Cost House (廉价屋): ONLY when the post actually says it. Other low-cost wording stays as before (flats → Apartment / Flat).
  lowCostHouse: /low[\s-]*cost\s*(?:house|home)s?|廉[价價]屋/, // only when it is actually written "Low Cost House" (or 廉价屋)
  lowCostFlat: /low[\s-]*cost\s*(?:flat|apartment|apt|pangsa)|(?:medium|low)[\s-]*cost\s*flat|flat\s*kos\s*rendah|廉[价價]组屋|廉[价價]組屋|低[价價]组屋/,
  flatWord: /\bflats?\b|apartment|\bapt\b|pangsa|组屋|組屋|公寓|平价屋|平價屋/,
  landedWord: /\b(?:single|double|triple|two|three)\s*-?\s*(?:storey|story|sty)\b|\d(?:\.5)?\s*-?\s*(?:storey|story|sty|stry)\b|terrace|teres|\blanded\b|单层|双层|三层|排屋/,
};

/** Storey count from text (1, 1.5, 2, 2.5, 3...). */
export function detectStoreys(t) {
  let m = t.match(/(\d(?:\.5)?)\s*-?\s*(?:storey|story|sty|stry|stories|storeys|tingkat|层)/);
  if (m) return +m[1];
  if (/一层半|1\.5层/.test(t)) return 1.5;
  if (/两层半|2\.5层/.test(t)) return 2.5;
  if (/single\s*-?\s*(?:storey|story|sty)|单层|setingkat|一层/.test(t)) return 1;
  if (/double\s*-?\s*(?:storey|story|sty)|双层|两层|dua tingkat|two\s*-?\s*stor/.test(t)) return 2;
  if (/triple\s*-?\s*(?:storey|story|sty)|三层|three\s*-?\s*stor/.test(t)) return 3;
  return null;
}

const terraceFor = (s) => (s == null ? null : s <= 1.5 ? T.TER1 : s <= 2.5 ? T.TER2 : T.TER3);

function landSubtype(t) {
  if (RX.indLand.test(t) || /industri|perindustrian|工业|\bi\d\b/.test(t)) return T.ILAND;
  if (RX.comLand.test(t) || /commercial|komersial|商业/.test(t)) return T.CLAND;
  if (RX.agriLand.test(t) || /agri|pertanian|农业|农地|durian|榴莲|plantation|palm/.test(t)) return T.ALAND;
  if (RX.resLand.test(t) || /residential|kediaman|住宅|housing|bungalow/.test(t)) return T.RLAND;
  return 'Other';
}

/** All residential types the text mentions (for requests), or the single best one (for listings). */
/** Low Cost House: only when written outright ("Low Cost House" / 廉价屋). */
function isLowCostHouse(t) {
  return RX.lowCostHouse.test(t) && !/low[\s-]*cost\s*flat|廉[价價]组屋|廉[价價]組屋/.test(t);
}

function residentialTypes(t, mode) {
  const found = [];
  if (isLowCostHouse(t)) return [T.LOWCOST]; // the specific type wins over terrace / apartment wording in the same post
  const storeys = detectStoreys(t);
  if (RX.cluster.test(t)) found.push(T.CLUSTER);
  if (RX.semid.test(t)) found.push(T.SEMID);
  if (RX.bung.test(t.replace(/semi[\s-]*detach\w*/g, ' '))) found.push(T.BUNG);
  if (RX.town.test(t)) found.push(T.TOWN);
  if (RX.condo.test(t)) found.push(T.CONDO);
  if (RX.apt.test(t.replace(/serviced?\s*apartments?/g, ''))) found.push(T.APT);
  const landedOther = found.some((x) => x === T.CLUSTER || x === T.SEMID || x === T.BUNG || x === T.TOWN);
  if (RX.terrace.test(t) && (!landedOther || /terrace|teres|排屋|link\s*house/.test(t))) {
    if (mode === 'request') {
      const all = [...t.matchAll(/(\d(?:\.5)?)\s*-?\s*(?:storey|story|sty|stry|stories|storeys|tingkat|层)/g)].map((m) => +m[1]);
      const s = all.length ? all : storeys != null ? [storeys] : [];
      if (s.length) s.forEach((x) => found.push(terraceFor(x)));
      else found.push(T.TER1, T.TER2, T.TER3);
    } else if (storeys != null) found.push(terraceFor(storeys));
  }
  if (!found.length && mode === 'request' && RX.landed.test(t)) found.push(...LANDED_TYPES);
  return [...new Set(found)];
}

/**
 * Category + type(s).
 * mode 'listing' → { category, type, types:[type] }   mode 'request' → { category, types:[...] , type }
 */
export function classifyProperty(text, mode = 'listing') {
  // keep line breaks as a separator so "factory\nland 2 acres" never reads as "factory land"
  const t = norm(String(text).replace(/\n+/g, ' ; '));
  // "land area 22x70", "land size" describe a house, they are not a land request
  const tl = t.replace(/land\s*(?:area|size|sqft|sf|:)|\bl\/a\b|\bla\s*[:=]|土地面积|地契面积|landed/g, ' ');
  const out = (category, types, typeText = '') => ({
    category,
    types,
    type: types.length === 1 ? types[0] : types.length ? types[0] : 'Other',
    typeText,
  });
  const res = () => residentialTypes(t, mode);

  if (RX.indLand.test(t)) return out('Land', [T.ILAND], 'industrial land');
  if (RX.comLand.test(t)) return out('Land', [T.CLAND], 'commercial land');
  if (/agri(?:cultur(?:e|al))?\s*land|tanah pertanian|农业地|农地|农业用地/.test(t)) return out('Land', [T.ALAND], 'agricultural land');
  if (RX.resLand.test(t) && !RX.factory.test(t)) return out('Land', [T.RLAND], 'residential land');

  const factory = RX.factory.test(t) && !RX.shopStrict.test(t);
  if (RX.strongLand.test(tl) || RX.landWord.test(tl)) {
    if (factory) return out('Industrial', [T.FACTORY], 'factory');
    const r = res();
    const strong = RX.strongLand.test(tl);
    if (!r.length || (mode === 'request' && strong && !RX.shopStrict.test(t))) {
      if (!RX.shopStrict.test(t) && !RX.office.test(t)) {
        const sub = landSubtype(t);
        return out('Land', sub === 'Other' ? [] : [sub], 'land');
      }
    }
  }

  if (RX.shopStrict.test(t)) {
    if (mode === 'request') {
      const types = [T.SHOPOFF, T.RETAIL];
      if (RX.office.test(t.replace(/shop\s*office/g, ''))) types.push(T.OFFICE);
      return out('Commercial', types, 'shop');
    }
    const isShopOffice = RX.shopOffice.test(t) || (detectStoreys(t) || 0) >= 2;
    return out('Commercial', [isShopOffice ? T.SHOPOFF : T.RETAIL], 'shop');
  }
  if (factory) return out('Industrial', [T.FACTORY], 'factory');
  if (RX.shopLoose.test(t) && !res().length) {
    return out('Commercial', mode === 'request' ? [T.SHOPOFF, T.RETAIL] : [RX.shopOffice.test(t) ? T.SHOPOFF : T.RETAIL], 'shop');
  }
  if (RX.office.test(t) && !res().some((x) => x !== T.CONDO)) return out('Commercial', [T.OFFICE], 'office');

  const r = res();
  if (r.length) {
    return out('Residential', mode === 'request' ? r : [r[0]], r.join(', '));
  }
  if (/\broom\b|\brooms\b|房间|单间/.test(t) && mode === 'request') return out('Residential', [], 'room');
  return out('Other', [], '');
}

// ---------- region ----------
const NEARBY_LINE = /nearby|周边|附近|easy access|near to|walking distance|minutes? to|mins? to|分钟|close to|berdekatan|\bdekat\b|\bnear\b|access to|accessible/i;

export function isNearbyLine(line) {
  return NEARBY_LINE.test(line);
}

const REGION_PHRASES = REGIONS.map(([name, kws]) => [name, kws.map(compilePhrase)]);

/** First region (table order) that any non-"nearby" line mentions. */
export function detectRegion(...texts) {
  for (const text of texts) {
    if (!text) continue;
    const lines = String(text).split(/\n/).filter((l) => !isNearbyLine(l));
    if (!lines.length) continue;
    const field = { s: norm(lines.join('\n')), w: wordForm(lines.join(' \n ')) };
    for (const [name, phrases] of REGION_PHRASES) {
      if (phrases.some((p) => fieldHas(p, field))) return name;
    }
  }
  return 'Other';
}

// ---------- kind ----------
const REQ_BUY = /\bwtb\b|want(?:ed|ing)? to buy|求购|求買|buyer(?:s)? (?:looking|search|seeking|wanted|need|want)|looking to buy|looking for .{0,25}(?:to buy|for sale)|买家|要买|想买|找买|nak beli|ingin beli|\bbuyer\b/;
const REQ_RENT = /\bwtr\b|want(?:ed|ing)? to rent|求租|tenant(?:s)? (?:looking|search|seeking|wanted|need|want)|looking to rent|looking for .{0,25}(?:to rent|for rent)|租客|要租|想租|找租|nak sewa|ingin sewa|\btenant\b/;
const REQ_GENERIC = /^\s*(?:looking for|client looking|my client|i have (?:a )?client|need|urgent(?:ly)?\s+(?:need|looking|want)|找|需要)/;
const LIST_SALE = /for sale|\bsale\b|selling|\bsell\b|\bjual\b|dijual|出售|售价|卖|\bsubsale\b|sub-sale|asking price|\bwts\b|\bfs\b|\bfsale\b/;
const LIST_RENT = /for rent|\brent\b|rental|\bsewa\b|disewa|出租|租金|月租|\bto let\b|\bfor let\b|\bwtl\b|\bfr\b|\/\s*month|\/\s*mth|per month|\d[0-9,.k]*\s*pm\b|sebulan|\/\s*mo\b/;

export function headOf(text) {
  const lines = stripInvisible(text).split(/\n/).map((l) => l.trim()).filter(Boolean);
  return norm(lines.slice(0, 2).join(' ')).slice(0, 160);
}

/** 'sale' (WTB) | 'rent' (WTR) | null — words in the head of the text win over everything else. */
export function requestKind(text) {
  const head = headOf(text);
  const b = head.search(REQ_BUY), r = head.search(REQ_RENT);
  if (b >= 0 && (r < 0 || b <= r)) return 'sale';
  if (r >= 0) return 'rent';
  return null;
}

export function isRequestText(text) {
  const head = headOf(text);
  if (REQ_BUY.test(head) || REQ_RENT.test(head)) return true;
  if (REQ_GENERIC.test(head) && !/for sale|for rent|出售|出租/.test(head)) return true;
  return false;
}

export function genericRequestKind(text) {
  const t = norm(text);
  const s = t.search(/\bbuy\b|purchase|beli|买|sale/), r = t.search(/\brent\b|sewa|租/);
  if (s >= 0 && (r < 0 || s < r)) return 'sale';
  if (r >= 0) return 'rent';
  return null;
}

// lines about monthly running costs (guard fee, maintenance ...) say nothing about sale vs rent
const COST_LINE = /g&g|guard|maint|service charge|sinking|quit rent|管理费|保安|\bsc\b/i;

export function listingKind(rawText) {
  const text = String(rawText).split('\n').filter((l) => !COST_LINE.test(l)).join('\n');
  const t = norm(text);
  // an explicit "For Sale" / "For Rent" line decides first
  const fs_ = t.search(/for sale|出售|selling price|asking price|售价/), fr_ = t.search(/for rent|for let|to let|出租|rental price/);
  if (fs_ >= 0 && fr_ < 0) return 'sale';
  if (fr_ >= 0 && fs_ < 0) return 'rent';
  const head = headOf(text);
  const hs = head.search(LIST_SALE), hr = head.search(LIST_RENT);
  if (hs >= 0 && (hr < 0 || hs <= hr)) return 'sale';
  if (hr >= 0) return 'rent';
  const s = t.search(LIST_SALE), r = t.search(LIST_RENT);
  if (s >= 0 && (r < 0 || s <= r)) return 'sale';
  if (r >= 0) return 'rent';
  return null;
}

// ---------- details ----------
const num = (s) => parseFloat(String(s).replace(/,/g, ''));

export function detectBedBath(text) {
  const t = norm(text);
  let bed = null, bath = null;
  let m = t.match(/(\d{1,2})\s*r\s*(\d{1,2})\s*b\b/) || t.match(/(\d{1,2})\s*房\s*(\d{1,2})\s*(?:厕|卫|浴)/);
  if (m) { bed = +m[1]; bath = +m[2]; }
  if (bed == null) {
    m = t.match(/(\d{1,2})\s*(?:\+\s*(\d))?\s*(?:bed(?:room)?s?\b|br\b|b\/r|rooms?\b|r\b(?!m)|bilik|间房|房)/);
    if (m) bed = +m[1] + (m[2] ? +m[2] : 0);
  }
  if (bath == null) {
    m = t.match(/(\d{1,2})\s*(?:bath(?:room)?s?\b|ba\b|toilets?\b|b\b|厕|卫|浴|bilik air)/);
    if (m) bath = +m[1];
  }
  if (bed != null && (bed < 1 || bed > 20)) bed = null;
  if (bath != null && (bath < 1 || bath > 20)) bath = null;
  return { bed, bath };
}

export function detectSizes(text) {
  const t = norm(text);
  let sqft = null, land = null, dims = '';
  let m = t.match(/(?:built[\s-]*up|\bbu\b|b\/u|floor area|建筑面积|实用面积|室内面积|keluasan binaan)\s*(?:area|size)?\s*[:：=\-]?\s*(?:about|approx\.?|~|±)?\s*([\d,]+(?:\.\d+)?)\s*(k\b)?/);
  if (m) sqft = num(m[1]) * (m[2] ? 1000 : 1);
  m = t.match(/(?:land\s*(?:area|size)?|\bla\b|l\/a|土地面积|地契面积|土地|地段|keluasan tanah)\s*[:：=\-]?\s*(?:about|approx\.?|~|±)?\s*([\d,]+(?:\.\d+)?)\s*(acres?|ekar|英亩|sq\.?\s*ft|sqft|sf|ft|sqm|m2)?/);
  if (m && num(m[1]) > 0) {
    const v = num(m[1]), u = m[2] || '';
    if (/acre|ekar|英亩/.test(u)) land = Math.round(v * 43560);
    else if (/sqm|m2/.test(u)) land = Math.round(v * 10.764);
    else if (v >= 100) land = v;
  }
  if (land == null) {
    m = t.match(/([\d,]+(?:\.\d+)?)\s*(?:acres?|ekar|英亩)/);
    if (m) land = Math.round(num(m[1]) * 43560);
  }
  m = t.match(/(\d{2,3}(?:\.\d)?)\s*(?:'|ft|feet)?\s*[x×*]\s*(\d{2,3}(?:\.\d)?)\s*(?:'|ft|feet)?/);
  if (m) {
    dims = `${m[1]}x${m[2]}`;
    if (land == null) land = Math.round(num(m[1]) * num(m[2]));
  }
  if (sqft == null) {
    const re = /([\d,]{3,7}(?:\.\d+)?)\s*(?:sq\.?\s*f(?:ee)?t|sqft|sf\b|s\.f|kaki persegi|方尺|平方尺)/g;
    let mm;
    while ((mm = re.exec(t))) {
      const before = t.slice(Math.max(0, mm.index - 18), mm.index);
      if (/land|土地|tanah|\bla\b/.test(before)) { if (land == null) land = num(mm[1]); continue; }
      sqft = num(mm[1]);
      break;
    }
  }
  if (sqft != null && (sqft < 100 || sqft > 2e6)) sqft = null;
  return { sqft, land, dims };
}

export function detectTenure(t) {
  t = norm(t);
  if (/malay reserve|\bmr\b lot|bumi lot|马来保留地|tanah rizab melayu/.test(t)) return 'Malay Reserve';
  if (/freehold|\bfh\b|永久地契|hak milik kekal|永久/.test(t)) return 'Freehold';
  if (/leasehold|\blh\b|\d{2,3}\s*(?:years?|yrs?)\s*lease|租赁地契|pajakan|\b99\s*y/.test(t)) return 'Leasehold';
  return '';
}

export function detectFurnishing(t) {
  t = norm(t);
  if (/unfurnish|\bbare\b|\buf\b|没家私|无家私|没有家私|empty unit|kosong|no furniture/.test(t)) return 'Unfurnished';
  if (/partial(?:ly)?\s*-?\s*furnish|partly\s*furnish|\bpf\b|半家私|basic\s*furnish|semi\s*-?\s*furnish|\bsf\s*unit/.test(t)) return 'Partially furnished';
  if (/fully\s*-?\s*furnish|full(?:y)?\s*furnish|\bff\b|全家私|full furniture|lengkap perabot|fully equipped/.test(t)) return 'Fully furnished';
  return '';
}

export const FEATURES = [
  ['Corner lot', /corner|\bc\/l\b|角头|角落|hujung/],
  ['End lot', /end\s*lot|end\s*unit|尾段/],
  ['Intermediate', /intermediate|\binter\s*lot|中间/],
  ['Facing main road', /facing\s*(?:the\s*)?main\s*road|main\s*road|大路|面向大路|面大路|jalan utama/],
  ['Gated & guarded', /gated|guarded|\bg\s*&\s*g\b|保安|有门卫/],
  ['Renovated', /renovat|装修|ubahsuai/],
  ['Extended', /extend|扩建/],
  ['Non-bumi', /non\s*-?\s*bumi|\bnb\b lot|非土著/],
  ['Bumi lot', /(?<!non[\s-]?)(?<![a-z])bumi\s*lot|(?<!非)土著/],
  ['High floor', /high\s*floor|高楼层|高层/],
  ['Ground floor', /ground\s*floor|\bg\/f\b|底楼|楼下|一楼店/],
  ['First floor', /first\s*floor|1st\s*floor|楼上|二楼/],
  ['Facing open', /facing\s*open|no\s*house\s*(?:in\s*)?front|open\s*view|前面没屋/],
  ['Pool view', /pool\s*view|泳池景/],
  ['Sea view', /sea\s*view|海景/],
  ['Near school', /near\s*(?:to\s*)?school|学校/],
  ['Car park', /car\s*park|parking|车位/],
  ['Lift', /\blift\b|elevator|电梯/],
  ['Big land', /big\s*land|extra\s*land|大地|大段/],
  ['Move in condition', /move\s*-?\s*in|即可入住|拎包入住/],
];

export function detectFeatures(text) {
  const t = norm(text);
  return FEATURES.filter(([, re]) => re.test(t)).map(([n]) => n);
}

export const isTypeKnown = (type) => !!type && type !== 'Other' && !!TYPE_CAT[type];
