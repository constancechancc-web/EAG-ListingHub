// Message → listing | request | ignore | review. Rule-based; AI hints are optional and applied on top.
import {
  classifyProperty, detectRegion, requestKind, isRequestText, genericRequestKind, listingKind,
  detectBedBath, detectSizes, detectTenure, detectFurnishing, detectFeatures, detectStoreys, isNearbyLine, isTypeKnown,
} from './classify.js';
import { extractPrice, parseBudget, scanAmounts } from './price.js';
import { parseRequestAreas, recoverAreas, isSignatureLine } from './areas.js';
import { norm, stripInvisible, stripEmoji, normPhone, displayName, cut } from './text.js';
import { TYPE_CAT } from './constants.js';

const PHONE_RE = /(?:\+?6?0)1\d[\s-]?\d{3,4}[\s-]?\d{3,4}/g;

export function findPhone(text, sender) {
  const lines = String(text).split(/\n/);
  const sig = lines.filter(isSignatureLine).join('\n');
  for (const src of [sig, text]) {
    const m = src.match(PHONE_RE);
    if (m) for (const p of m) { const n = normPhone(p); if (n) return n; }
    const wa = src.match(/(?:wa\.me|wasap\.my)\/\+?(\d{9,13})/);
    if (wa) { const n = normPhone(wa[1]); if (n) return n; }
  }
  const s = normPhone(sender);
  return /^[+\d\s()-]+$/.test(String(sender || '').trim()) ? s : '';
}

const KIND_WORDS = /\b(?:for sale|for rent|for let|to let|sale|rent|rental|wts|wtl|fs|fr|sewa|jual|dijual|disewa|subsale|sub-sale|new|hot|urgent|cheap|below market|bmv|nego|price|good deal|must see|ready)\b|出售|出租|急售|急租|特价|便宜|售|租/gi;
const PLACE_HINT = /\b(?:taman|tmn|bandar|bdr|jalan|jln|kampung|kg|desa|residen\w*|residence|heights?|gardens?|park|city|villa|court|towers?|square|avenue|hills?|bay|point|vista|suites?|regency|seri|sri|bukit|mount|eco|setia|horizon|pulai|indah|jaya|utama|perdana|baru|permai|damai|harmoni|impian|mutiara|puteri|nusa|iskandar|austin|molek|tebrau|kulai|skudai|senai|masai|permas)\b/i;
const LOC_MARK = /^\s*(?:📍|\*?\s*(?:location|lokasi|address|alamat|area|地点|地址|位置|地区)\s*\*?\s*[:：\-=])\s*(.+)$/i;

function cleanLine(l) {
  return stripEmoji(stripInvisible(l)).replace(/^[\s*•·\-–—>#~_|:：=]+/, '').replace(/[*_~]+/g, '').replace(/\s+/g, ' ').trim();
}

function titleAndArea(text) {
  const lines = String(text).split(/\n/).map(cleanLine).filter(Boolean);
  let area = '';
  for (const raw of String(text).split(/\n/)) {
    const m = stripInvisible(raw).match(LOC_MARK);
    if (m) { area = cleanLine(m[1]); break; }
  }
  const usable = lines.filter((l) => !isSignatureLine(l) && !isNearbyLine(l));
  const stripKind = (l) => l.replace(KIND_WORDS, ' ').replace(/^[\s:：\-–|!@,.]+|[\s:：\-–|!,.]+$/g, '').replace(/\s+/g, ' ').trim();
  let title = '';
  for (const l of usable.slice(0, 6)) {
    const s = stripKind(l);
    if (s.length >= 3 && s.length <= 80 && PLACE_HINT.test(s) && !scanAmounts(s.toLowerCase()).some((a) => a.rm)) { title = s; break; }
  }
  if (!title) {
    for (const l of usable.slice(0, 4)) {
      const s = stripKind(l);
      if (s.length >= 3 && /[a-z㐀-鿿]{3}/i.test(s) && !/^(?:rm|price|rental|budget)/i.test(s)) { title = s; break; }
    }
  }
  title = cut(title.replace(/^(?:at|in|@)\s+/i, ''), 80);
  if (!area) {
    const withPlace = usable.find((l) => l !== title && PLACE_HINT.test(l) && l.length <= 100 && !/rm\s*\d/i.test(l));
    area = withPlace ? stripKind(withPlace) : title;
  }
  return { title: title || 'Untitled', area: cut(area, 120) };
}

const IGNORE_SHORT = /^(?:sold|rented|taken|booked|done|closed|deal|已售|已租|成交|已成交|租出|卖出|ok|okay|noted|thanks|thank you|tq|tqvm|good morning|morning|gm|hi|hello|test|👍|🙏)\b/i;

const PROPERTY_HINT = /condo|apartment|terrace|teres|semi|bungalow|cluster|townhouse|shop|office|factory|warehouse|land|tanah|acre|storey|sqft|bed|room|rent|sale|sewa|jual|price|rm\s*\d|公寓|排屋|店|厂|地|房|租|售|卖/i;

/**
 * @param msg { sender, postedAt, day, text, hash }
 * @param ctx { group, source, vocab, hint? }   hint = AI classification { class, kind, category, type }
 */
export function parseMessage(msg, ctx = {}) {
  const text = stripInvisible(msg.text || '').trim();
  const t = norm(text);
  const hint = ctx.hint || null;
  if (hint && hint.class === 'ignore') return { cls: 'ignore' };
  if (!hint) {
    if (t.length < 12) return { cls: 'ignore' };
    if (t.length < 60 && IGNORE_SHORT.test(t)) return { cls: 'ignore' };
  }
  const base = {
    id: msg.hash,
    hash: msg.hash,
    renName: displayName(msg.sender),
    renPhone: findPhone(text, msg.sender),
    group: ctx.group || '',
    source: ctx.source || '',
    postedAt: msg.postedAt,
    day: msg.day,
    raw: text,
  };

  if ((hint && hint.class === 'request') || (!hint && isRequestText(text))) {
    const r = analyseRequest(text, ctx.vocab);
    if (hint && hint.kind && !requestKind(text)) r.kind = hint.kind;
    if (hint && hint.category && r.category === 'Other') { r.category = hint.category; if (hint.type) r.types = [hint.type]; }
    if (!r.kind) return { cls: 'review', reason: 'request without buy/rent', item: { ...base, ...r } };
    return { cls: 'request', item: { ...base, ...r, clientName: clientName(text), status: 'open' } };
  }

  let kind = listingKind(text);
  if (hint && hint.kind) kind = kind || hint.kind;
  const prop = classifyProperty(text, 'listing');
  if (hint && hint.category && prop.category === 'Other') {
    prop.category = hint.category;
    prop.type = hint.type && TYPE_CAT[hint.type] === hint.category ? hint.type : 'Other';
  }
  let { price, bankValue } = extractPrice(text, kind);
  if (!kind && price != null) kind = price <= 30000 ? 'rent' : 'sale';
  const looksProperty = prop.category !== 'Other' || price != null || PROPERTY_HINT.test(t);
  if (!kind || (prop.category === 'Other' && price == null)) {
    if (looksProperty && t.length >= 30) return { cls: 'review', reason: !kind ? 'no sale/rent' : 'no type or price', item: base };
    return { cls: 'ignore' };
  }
  if (price == null && kind) ({ price, bankValue } = extractPrice(text, kind));
  const { title, area } = titleAndArea(text);
  const { bed, bath } = detectBedBath(text);
  const { sqft, land, dims } = detectSizes(text);
  return {
    cls: 'listing',
    item: {
      ...base,
      kind,
      title,
      area,
      region: detectRegion(title + '\n' + area, text.split(/\n/).filter((l) => !isSignatureLine(l)).join('\n')),
      category: prop.category,
      type: prop.category === 'Other' ? 'Other' : prop.type,
      price,
      bankValue,
      bed,
      bath,
      sqft,
      land,
      dims,
      storeys: detectStoreys(t),
      tenure: detectTenure(t),
      furnishing: detectFurnishing(t),
      features: detectFeatures(text),
    },
  };
}

function clientName(text) {
  const m = String(text).match(/client\s*(?:name)?\s*[:：]\s*([^\n]{2,40})|客户\s*[:：]\s*([^\n]{2,30})/i);
  return m ? (m[1] || m[2]).trim() : '';
}

const MUST_FEATURES = ['Corner lot', 'End lot', 'Facing main road', 'Gated & guarded', 'Renovated', 'Extended', 'Non-bumi', 'High floor', 'Ground floor', 'First floor', 'Facing open', 'Lift', 'Big land'];

/** Parse the request text from scratch. "Words in the text override saved fields." */
export function analyseRequest(raw, vocab) {
  const text = stripInvisible(raw);
  const kind = requestKind(text) || genericRequestKind(text);
  const prop = classifyProperty(text, 'request');
  const budget = parseBudget(text, kind);
  const { bed, bath } = detectBedBath(text);
  let areas = parseRequestAreas(text);
  if (!areas.length && vocab) areas = recoverAreas(text, vocab);
  const bv = String(text).match(/(?:bank\s*val\w*|\bbv\b)[^\n\d]{0,12}(?:rm\s*)?([\d.,]+\s*(?:k|m|mil)?)/i);
  let bankValueMin = null;
  if (bv) { const a = scanAmounts(bv[1].toLowerCase())[0]; if (a) bankValueMin = a.suffix ? a.value : a.value < 10000 ? a.value * 1000 : a.value; }
  return {
    kind,
    category: prop.category,
    types: prop.types,
    typeText: prop.typeText,
    areas,
    ...budget,
    bedMin: bed,
    bathMin: bath,
    bankValueMin,
    furnishing: detectFurnishing(text),
    mustHave: detectFeatures(text).filter((f) => MUST_FEATURES.includes(f)),
  };
}

/** Saved request + fresh parse of its raw text. Text wins; saved status/agent fields are kept. */
export function reparseRequest(req, vocab) {
  const fresh = analyseRequest(req.raw || '', vocab);
  return {
    ...req,
    ...fresh,
    kind: fresh.kind || req.kind,
    category: fresh.category !== 'Other' ? fresh.category : req.category || 'Other',
    types: fresh.category !== 'Other' ? fresh.types : req.types || [],
    areas: fresh.areas.length ? fresh.areas : [],
  };
}

export { isTypeKnown };
