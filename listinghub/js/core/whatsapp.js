// WhatsApp export → messages. Pure code, no DOM: used in the browser worker, the cron job and tests.
import { SOURCE_CO, GROUP_SOURCE_RULES } from './constants.js';
import { stripInvisible, stripEmoji, hash53 } from './text.js';

/** "WhatsApp Chat with JB TRR Rent 1 Listing Group.zip" → "JB TRR Rent 1 Listing Group" */
export function groupFromFileName(fileName) {
  let n = String(fileName || '').split(/[\\/]/).pop();
  n = n.replace(/\.(zip|txt)$/i, '');
  n = n.replace(/\s*\(\d+\)$/, '');
  n = n.replace(/^WhatsApp\s+Chat\s*(?:with|-|–|:)\s*/i, '');
  n = n.replace(/^_?chat$/i, '');
  return stripInvisible(n).trim() || 'Unknown group';
}

/** Group name as a stable key: emoji/invisible chars removed, lowercase, single spaces. */
export function groupKey(group) {
  return stripEmoji(stripInvisible(group || '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** EAG Listing / TRR Group / Co Agency. `overrides` = { groupKey: source } set by the Admin. */
export function sourceForGroup(group, overrides) {
  const key = groupKey(group);
  if (overrides && overrides[key]) return overrides[key];
  for (const [source, words] of GROUP_SOURCE_RULES) {
    if (words.some((w) => key.includes(w))) return source;
  }
  return SOURCE_CO;
}

/** Zip is detected from content ("PK\x03\x04"), never from the extension. */
export function isZip(bytes) {
  return bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Pick the chat text out of a zip. `unzipSync` is fflate's unzipSync (browser or Node build).
 * Only .txt entries are decompressed, so media files inside the zip are skipped.
 */
export function chatTextFromZip(bytes, unzipSync) {
  const files = unzipSync(bytes, { filter: (f) => /\.txt$/i.test(f.name) && !f.name.startsWith('__MACOSX') });
  const names = Object.keys(files);
  if (!names.length) throw new Error('NO_TXT_IN_ZIP');
  const pick = names.find((n) => /(^|\/)_chat\.txt$/i.test(n)) || names.sort()[0];
  return decodeText(files[pick]);
}

export function decodeText(bytes) {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

/** File bytes (zip or txt) → chat text. Throws NOT_WHATSAPP-style errors upstream. */
export function fileBytesToText(bytes, unzipSync) {
  return isZip(bytes) ? chatTextFromZip(bytes, unzipSync) : decodeText(bytes);
}

const DATE = String.raw`(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})`;
// groups: 1 = Chinese time-of-day word (iPhones set to Chinese), 2 hour, 3 minute, 4 second, 5 AM/PM
const TIME = String.raw`(?:(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜晚|午夜)\s*)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?`;
const RE_IOS = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s?(.*)$`);
const RE_ANDROID = new RegExp(String.raw`^${DATE},?\s+${TIME}\s*[-–]\s(.*)$`);

function matchHeader(line) {
  return RE_IOS.exec(line) || RE_ANDROID.exec(line);
}

/** Decide d/m/y vs m/d/y vs y/m/d from the first headers of the file. */
function detectDateOrder(lines) {
  let dmy = 0, mdy = 0, ymd = 0;
  for (let i = 0, seen = 0; i < lines.length && seen < 400; i++) {
    const m = matchHeader(stripInvisible(lines[i]));
    if (!m) continue;
    seen++;
    const a = +m[1], b = +m[2];
    if (m[1].length === 4) ymd++;
    else if (a > 12) dmy++;
    else if (b > 12) mdy++;
  }
  if (ymd > dmy && ymd > mdy) return 'ymd';
  return mdy > dmy ? 'mdy' : 'dmy';
}

const pad = (n) => String(n).padStart(2, '0');

function buildTime(m, order) {
  let d, mo, y;
  if (order === 'ymd') [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if (order === 'mdy') [mo, d, y] = [+m[1], +m[2], +m[3]];
  else [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (y < 100) y += 2000;
  let h = +m[5];
  const min = +m[6];
  const ap = (m[8] || '').toLowerCase().replace(/[^ap]/g, '');
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  // Chinese 12-hour clocks: 凌晨12:05 = 00:05, 下午3:45 = 15:45, 晚上11:50 = 23:50, 中午12:30 = 12:30, 中午1:10 = 13:10
  const zh = m[4];
  if (zh) {
    if (/下午|傍晚|晚上|夜晚/.test(zh)) { if (h < 12) h += 12; }
    else if (/凌晨|午夜/.test(zh)) { if (h === 12) h = 0; }
    else if (zh === '中午') { if (h < 11) h += 12; }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null;
  const day = `${y}-${pad(mo)}-${pad(d)}`;
  return { day, minute: `${day}T${pad(h)}:${pad(min)}`, iso: `${day}T${pad(h)}:${pad(min)}:${pad(+(m[7] || 0))}+08:00` };
}

const MEDIA_ONLY = /^(?:图像已忽略|图片已忽略|影片已忽略|视频已忽略|视讯已忽略|贴图已忽略|贴纸已忽略|音频已忽略|语音已忽略|语音讯息已忽略|文件已忽略|文档已忽略|GIF已忽略|联络人卡片已忽略|联系人名片已忽略|此(?:消息|讯息)已删除|你已删除此(?:消息|讯息)|已删除此(?:消息|讯息)|<media omitted>|‎?(?:image|video|audio|sticker|gif|document) omitted|<attached: [^>]+>|this message was deleted|you deleted this message|null|<view once (?:voice )?message>)$/i;

// iPhone exports system events as if the group itself sent them.
const SYSTEM_TEXT = /^(?:messages and calls are end-to-end encrypted.*|(?:讯息|消息)和通话(?:均)?已(?:端对端|端到端)加密.*|.{0,40}(?:创建了此群组|创建了群组|使用此群组的邀请链接加入|已加入此群组|更改了此群组的(?:图标|设置)|更改了群组(?:主题|描述|图标|名称))\.?.{0,40}|.{0,60}(?:created (?:this )?group|joined using this group's invite link|changed the (?:subject|group description|group name|group icon|settings)|changed this group's (?:icon|settings)|security code (?:with .+ )?changed|was removed|were added|was added|left)\.?.{0,40}|you were added.*|you joined.*)$/is;

/** Normalised text used for the de-duplication hash (format differences between phones removed). */
export function hashText(text) {
  return stripInvisible(text).replace(/<this message was edited>/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Parse chat text into messages.
 * Hash = minute + normalised text. Sender is deliberately NOT part of the hash: two agents exporting the
 * same group see different contact names for the same sender, which would otherwise create duplicates.
 */
export function parseChatText(text, { onProgress } = {}) {
  const lines = text.split(/\r?\n/);
  const order = detectDateOrder(lines);
  const out = [];
  let cur = null;
  let headers = 0;
  const flush = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').replace(/<This message was edited>/gi, '').trim();
    if (body && !MEDIA_ONLY.test(stripInvisible(body)) && !SYSTEM_TEXT.test(stripInvisible(body))) {
      out.push({
        sender: cur.sender,
        postedAt: cur.t.iso,
        day: cur.t.day,
        text: body,
        hash: hash53(cur.t.minute + '|' + hashText(body)),
      });
    }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = stripInvisible(lines[i]);
    const m = matchHeader(line);
    const t = m && buildTime(m, order);
    if (t) {
      headers++;
      flush();
      const rest = m[9];
      const c = rest.indexOf(': ');
      if (c > 0 && c < 80) {
        cur = { sender: rest.slice(0, c).trim(), t, lines: [rest.slice(c + 2)] };
      } else {
        cur = null; // system line ("X joined", "Messages are end-to-end encrypted"...)
      }
    } else if (cur) {
      cur.lines.push(lines[i]);
    }
    if (onProgress && i % 20000 === 0) onProgress(i / lines.length);
  }
  flush();
  if (!headers) throw new Error('NOT_WHATSAPP');
  return out;
}
