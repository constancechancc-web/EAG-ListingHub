// Request areas: parse them from the text, or recover them from a vocabulary built from listings.
import { GENERIC_AREA_WORDS, AREA_PREFIXES, REGIONS } from './constants.js';
import { RX } from './classify.js';
import { norm, wordForm, stripInvisible, hasCJK } from './text.js';

const SIGNATURE = /\bren\s*[:.\-]?\s*\d|\bren\d|\bpea\s*[:.\-]?\s*\d|\breg\.?\s*no|\be\s*\(\d|\(\s*e\s*\)\s*\d|wasap\.my|wa\.me|wa\.link|https?:\/\/|www\.|\brealty\b|\bproperties\b|\bproperty\s*(?:sdn|agency|consultant|consultants)|sdn\.?\s*bhd|real\s*estate|\bagency\b|negotiator|estate\s*agent|\bregistered\b|(?:\+?6?0)1\d[\s-]?\d{3,4}[\s-]?\d{3,4}|^\s*(?:call|whatsapp|wa|contact|tel|hp|pm me|dm me|联系|电话)\b/i;
export const isSignatureLine = (l) => SIGNATURE.test(l);

const GENERIC = new Set(GENERIC_AREA_WORDS.map((w) => norm(w)));

// Words that separate area names inside a request head. Treated as separators, never as areas.
const FILLER = [
  'wtb', 'wtr', 'wts', 'wtl', 'want', 'wanted', 'wanting', 'to', 'buy', 'rent', 'rental', 'sale', 'sell', 'for', 'looking', 'look', 'search', 'searching',
  'seeking', 'buyer', 'buyers', 'tenant', 'tenants', 'client', 'clients', 'my', 'our', 'i', 'we', 'have', 'has', 'is', 'are', 'a', 'an', 'the', 'urgent',
  'urgently', 'need', 'needed', 'needs', 'require', 'requirement', 'requirements', 'pls', 'please', 'plz', 'kindly', 'any', 'unit', 'units', 'house',
  'houses', 'home', 'homes', 'property', 'properties', 'room', 'rooms', 'bedroom', 'bedrooms', 'bed', 'beds', 'bath', 'baths', 'bathroom', 'bathrooms',
  'toilet', 'toilets', 'with', 'without', 'in', 'at', 'near', 'nearby', 'around', 'or', 'and', 'area', 'areas', 'of', 'type', 'ground', 'floor', 'first',
  'level', 'storey', 'story', 'sty', 'double', 'single', 'triple', 'terrace', 'link', 'shoplot', 'shop', 'shops', 'lot', 'office', 'factory',
  'warehouse', 'condo', 'apartment', 'budget', 'bajet', 'price', 'below', 'under', 'above', 'max', 'min', 'within', 'month', 'monthly', 'mth', 'pm',
  'fully', 'partially', 'partial', 'furnished', 'furnish', 'unfurnished', 'basic', 'nego', 'negotiable', 'cash', 'loan', 'buyer', 'family', 'kids',
  'student', 'students', 'worker', 'workers', 'staff', 'company', 'local', 'foreigner', 'chinese', 'malay', 'indian', 'move', 'asap', 'soon',
  'immediately', 'immediate', 'now', 'available', 'thanks', 'thank', 'you', 'tq', 'tqvm', 'dm', 'me', 'call', 'whatsapp', 'contact', 'if', 'got',
  'can', 'also', 'ok', 'okay', 'good', 'nice', 'new', 'big', 'small', 'cheap', 'freehold', 'leasehold', 'corner', 'end', 'intermediate', 'renovated',
  'gated', 'guarded', 'main', 'road', 'facing', 'high', 'low', 'medium', 'cost', 'sqft', 'sf', 'acre', 'acres', 'ekar', 'land', 'size', 'built',
  'up', 'bu', 'open', 'market', 'follow', 'only', 'prefer', 'preferably', 'preferred', 'better', 'best', 'like', 'similar', 'etc', 'from', 'up',
  'commercial', 'residential', 'industrial', 'landed', 'whole', 'stay', 'own', 'investment', 'invest', 'parking', 'retail', 'restaurant',
  'cafe', 'business', 'usage', 'use', 'suitable', 'for', 'per', 'rm', 'k', 'm', 'mil', 'mins', 'min', 'minute', 'minutes', 'walking', 'distance',
  'not', 'no', 'more', 'than', 'less', 'least', 'start', 'starting', 'early', 'next', 'this', 'year', 'years', 'contract', 'detail', 'details',
  'serviced', 'service', 'semi', 'd', 'detached', 'bungalow', 'cluster', 'townhouse', 'flat', 'workshop', 'kilang',
  'rumah', 'sewa', 'beli', 'cari', 'nak', 'di', 'kawasan', 'sekitar', 'dekat', 'atau', 'dan', 'bilik', 'tingkat', 'teres', 'kedai', 'tanah',
  'tq', 'thx', 'wa', 'deal', 'direct', 'owner', 'agent', 'agents', 'co', 'broke', 'cobroke', 'co-broke', 'welcome', 'commission', 'share',
];
const FILLER_RE = new RegExp(String.raw`(^|[^a-z0-9])(?:${[...new Set(FILLER)].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|')})(?=$|[^a-z0-9])`, 'g');
const CJK_FILLER = ['求购', '求租', '求買', '客户', '客人', '需要', '预算', '以下', '以上', '以内', '左右', '附近', '周边', '一带', '或者', '或', '和', '找', '在', '的', '要', '买', '租', '房', '间', '厕', '层', '排屋', '公寓', '店面', '门店', '店屋', '商铺', '厂房', '工厂', '仓库', '土地', '地皮', '英亩', '单位', '有', '吗', '谢谢', '请', '联系', '私聊', '家私', '全', '半', '楼', '底', '双', '单', '三', '独立', '洋房', '半独立', '田字屋', '办公室', '修车厂', '万', '月', '想', '可以', '都', '也', '地区', '区域', '新山', '柔佛'];

const TYPE_RXS = Object.values(RX).map((r) => new RegExp(r.source, 'g'));
const MONEY_RE = /(?:rm\s*)?\d[\d,.]*\s*(?:k|mil(?:lion)?|mill?|m|万|千|\+\+|\+)?(?=$|[^a-z])/g;
const MARKER = /^\s*(?:📍|\*?\s*(?:area|areas|location|locations|lokasi|kawasan|地点|地区|区域|地段|位置|preferred area|prefer area)\s*\*?\s*[:：\-=])\s*(.+)$/i;

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function cleanSegment(seg) {
  let s = seg.replace(/[^\p{L}\p{N}\s&'.]/gu, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.&'\s]+|[.&'\s]+$/g, '');
  if (!s) return '';
  if (GENERIC.has(s)) return '';
  const words = s.split(' ');
  if (hasCJK(s)) return s.replace(/[a-z0-9\s]/g, '').length >= 2 ? s : '';
  if ((s.match(/[a-z]/g) || []).length < 3) return '';
  if (words.length > 5) return '';
  return s;
}

/** Areas written in the request text. */
export function parseRequestAreas(text) {
  const lines = stripInvisible(text).split(/\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !isSignatureLine(l));
  let parts = lines.map((l) => l.match(MARKER)).filter(Boolean).map((m) => m[1]);
  if (!parts.length) parts = lines.slice(0, 2);
  const out = [];
  for (const p of parts) {
    let s = norm(p).replace(/\b(?:taman|tmn)\./g, 'taman ');
    for (const re of TYPE_RXS) s = s.replace(re, ' | ');
    s = s.replace(MONEY_RE, ' | ');
    s = s.replace(FILLER_RE, '$1|');
    s = s.replace(FILLER_RE, '$1|');
    for (const w of CJK_FILLER) s = s.split(w).join('|');
    for (const seg of s.split(/[|\/,，、;；()（）\[\]{}<>+:：\n]|\s-\s|\s–\s|–|—|\s~\s|\bor\b|\bdan\b|\batau\b|&/)) {
      const c = cleanSegment(seg);
      if (c) out.push(c);
    }
  }
  return [...new Set(out)].map(titleCase);
}

export function stripAreaPrefix(area) {
  let s = norm(area);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of AREA_PREFIXES) {
      if (s.startsWith(p + ' ')) { s = s.slice(p.length + 1); changed = true; }
    }
  }
  return s;
}

/** Vocabulary of area phrases taken from all listings' titles and areas, plus region keywords. */
export function buildAreaVocab(listings) {
  const byFirst = new Map();
  const add = (phrase) => {
    const w = wordForm(phrase);
    const toks = w.trim().split(' ');
    if (!toks[0] || toks.length > 4) return;
    if ((w.match(/[a-z]/g) || []).length < 3) return;
    if (GENERIC.has(toks.join(' '))) return;
    let arr = byFirst.get(toks[0]);
    if (!arr) byFirst.set(toks[0], (arr = new Map()));
    arr.set(w, toks.join(' '));
  };
  for (const [, kws] of REGIONS) kws.forEach(add);
  for (const l of listings) {
    for (const src of [l.title, l.area]) {
      if (!src) continue;
      for (let piece of norm(src).split(/[,\/|()\[\]\-–—\n;:@&+]+/)) {
        piece = stripAreaPrefix(piece.trim());
        piece = piece.replace(/\b(?:no|lot|unit|blk|block|jln|jalan)\.?\s*\S+/g, ' ').replace(/\b\d+[a-z]?\b/g, ' ');
        for (const re of TYPE_RXS) piece = piece.replace(re, ' | ');
        piece = piece.replace(FILLER_RE, '$1|');
        for (const seg of piece.split('|')) {
          const c = seg.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
          if (c && !GENERIC.has(c)) add(c);
        }
      }
    }
  }
  return { byFirst };
}

/** Find vocabulary phrases inside a request (signature lines ignored). */
export function recoverAreas(text, vocab) {
  if (!vocab) return [];
  const body = stripInvisible(text).split(/\n/).filter((l) => !isSignatureLine(l)).join('\n');
  const w = wordForm(body);
  const toks = w.trim().split(' ');
  const found = new Map();
  for (const tok of new Set(toks)) {
    const cands = vocab.byFirst.get(tok);
    if (!cands) continue;
    for (const [pw, plain] of cands) if (w.includes(pw)) found.set(pw, plain);
  }
  const list = [...found.entries()];
  const kept = list.filter(([pw]) => !list.some(([other]) => other !== pw && other.includes(pw)));
  return kept.map(([, plain]) => titleCase(plain));
}
