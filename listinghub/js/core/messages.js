// wa.me links and message texts (plain text, emoji stripped).
import { stripEmoji, normPhone, fmtRM } from './text.js';
import { TYPE_ZH } from './constants.js';

const clean = (s) => stripEmoji(s).replace(/\n{3,}/g, '\n\n').trim();
export const DIVIDER = '━━━━━━━━━━━━━━━';

export function listingEnquiry(name, listing, lang) {
  const n = (name || '').trim() || 'agent';
  const head = lang === 'zh'
    ? `你好，我是 TRREAG 的 ${n}，请问下面这个单位还有吗？`
    : `Hi, I'm ${n} from TRREAG, may I know the listing below is it still available?`;
  return clean(`${head}\n\n${listing.raw || ''}`);
}

export function clientAgentMessage(name, request, listing, lang) {
  const n = (name || '').trim() || 'agent';
  const head = lang === 'zh'
    ? `你好，我是 TRREAG 的 ${n}，我有一个单位可能适合你的客户，有兴趣的话请告诉我，谢谢。`
    : `Hi I'm ${n} from TRREAG, i have a property might suite to ur client, if u interested pls let me know, tq`;
  return clean(`${head}\n\n${request.raw || ''}\n\n${DIVIDER}\n\n${listing.raw || ''}`);
}

export function waLink(phone, text) {
  const p = normPhone(phone);
  const q = 'text=' + encodeURIComponent(text);
  return p ? `https://wa.me/${p}?${q}` : `https://wa.me/?${q}`;
}

/**
 * How far the sale price is below (+) or above (−) the bank value, in whole percent.
 * RM 486k vs bank value RM 600k → 19. Null when it can't be worked out (rentals, missing values).
 */
export function bankValueDiff(l) {
  if (!l || l.kind !== 'sale' || !(l.bankValue > 0) || !(l.price > 0)) return null;
  return Math.round(((l.bankValue - l.price) / l.bankValue) * 100);
}

/** "Copy 复制资料": clean summary to forward to a client (no agent contact). */
export function listingSummary(l) {
  const lines = [];
  lines.push(`${l.kind === 'rent' ? 'For Rent 出租' : 'For Sale 出售'} | ${l.title}`);
  if (l.area && l.area !== l.title) lines.push(`Location 地点: ${l.area}`);
  if (l.region && l.region !== 'Other') lines.push(`Region 区域: ${l.region}`);
  if (l.type && l.type !== 'Other') lines.push(`Type 类型: ${l.type} ${TYPE_ZH[l.type] || ''}`);
  if (l.price != null) lines.push(l.kind === 'rent' ? `Rental 租金: ${fmtRM(l.price)}/mo` : `Price 价钱: ${fmtRM(l.price)}`);
  if (l.bankValue != null) {
    const d = bankValueDiff(l);
    const note = d == null ? '' : d > 0 ? ` (${d}% below BV 低于估价)` : d < 0 ? ` (${-d}% above BV 高于估价)` : '';
    lines.push(`Bank value 银行估价: ${fmtRM(l.bankValue)}${note}`);
  }
  const spec = [l.bed != null && `${l.bed} bed`, l.bath != null && `${l.bath} bath`, l.sqft && `Built-up ${l.sqft.toLocaleString()} sqft`, l.land && `Land ${l.land.toLocaleString()} sqft`, l.dims, l.storeys && `${l.storeys} storey`].filter(Boolean);
  if (spec.length) lines.push(spec.join(' | '));
  const extra = [l.tenure, l.furnishing, ...(l.features || [])].filter(Boolean);
  if (extra.length) lines.push(extra.join(', '));
  return lines.join('\n');
}
