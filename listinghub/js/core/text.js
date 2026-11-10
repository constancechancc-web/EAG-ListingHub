import { NAME_OVERRIDES } from './constants.js';

// Invisible / formatting characters WhatsApp and phones insert (LRM, RLM, word joiner, zero-width, BOM...).
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;
export const stripInvisible = (s) => String(s ?? '').replace(INVISIBLE, '');

const CJK = /[㐀-鿿豈-﫿]/;
export const hasCJK = (s) => CJK.test(s);

/** Lowercase, invisible chars removed, whitespace collapsed. */
export function norm(s) {
  return stripInvisible(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** " word word word " — latin/digit tokens only, for exact-phrase matching. */
export function wordForm(s) {
  const toks = norm(s).match(/[a-z0-9]+/g);
  return toks ? ' ' + toks.join(' ') + ' ' : ' ';
}

/**
 * Compile a query once. Latin text → whole-word consecutive phrase.
 * Chinese text → plain substring. Returns null for an empty query.
 */
export function compilePhrase(query) {
  const q = norm(query);
  if (!q) return null;
  if (hasCJK(q)) return { cjk: true, q };
  const toks = q.match(/[a-z0-9]+/g);
  if (!toks) return null;
  const digits = q.replace(/\D/g, '');
  return { cjk: false, q, w: ' ' + toks.join(' ') + ' ', digits: digits.length >= 4 ? digits : '' };
}

/** Test a compiled phrase against one precomputed field {s: norm text, w: wordForm}. */
export function fieldHas(phrase, field) {
  if (!phrase || !field) return false;
  return phrase.cjk ? field.s.includes(phrase.q) : field.w.includes(phrase.w);
}

/** Convenience: phrase test against raw text (computes the forms on the fly). */
export function phraseIn(query, text) {
  const p = typeof query === 'string' ? compilePhrase(query) : query;
  if (!p) return false;
  return fieldHas(p, { s: norm(text), w: wordForm(text) });
}

export const prepField = (text) => ({ s: norm(text), w: wordForm(text) });

// A UTF-16 half of a character (lone surrogate) is invalid in JSON/Postgres and makes a whole batch fail.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const scrubText = (s) => String(s ?? '').replace(LONE_SURROGATE, '�');

/** Cut to at most n characters WITHOUT splitting an emoji or a "𝐛𝐨𝐥𝐝" letter in half. */
export function cut(s, n) {
  const str = String(s ?? '');
  if (str.length <= n) return str;
  let end = n;
  const c = str.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--; // would end on the first half of a pair
  return str.slice(0, end);
}

/** Remove emoji and pictographs (WhatsApp wa.me text must be plain). */
export function stripEmoji(s) {
  return String(s ?? '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[︎️‍⃣]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');
}

export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');

/** Malaysian phone → digits with country code, e.g. 60123456789. Empty if not plausible. */
export function normPhone(s) {
  let d = digitsOnly(s);
  if (!d) return '';
  if (d.startsWith('0')) d = '6' + d;
  if (d.startsWith('1') && d.length >= 9 && d.length <= 10) d = '60' + d;
  if (d.length < 10 || d.length > 13) return '';
  return d;
}

export function displayName(name) {
  const n = stripInvisible(name).trim();
  return NAME_OVERRIDES[n.toLowerCase().replace(/\s+/g, ' ')] || n;
}

/** cyrb53 — fast 53-bit hash, identical in Node and browsers. */
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function fmtRM(n) {
  if (n == null || !isFinite(n)) return '';
  return 'RM ' + Math.round(n).toLocaleString('en-MY');
}

export function fmtShortRM(n) {
  if (n == null) return '';
  if (n >= 1e6) return 'RM' + +(n / 1e6).toFixed(2) + 'm';
  if (n >= 1e4) return 'RM' + +(n / 1e3).toFixed(1) + 'k';
  return 'RM' + Math.round(n).toLocaleString('en-MY');
}
