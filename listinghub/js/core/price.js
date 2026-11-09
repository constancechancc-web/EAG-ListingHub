// Money parsing for listings (price, bank value) and requests (budget).

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const SUFFIX = String.raw`(k\b|mil(?:lion)?\b|mill?\b|mln\b|m\b|juta\b|万|千)?`;
const AMOUNT_RE = new RegExp(String.raw`(rm\s*)?${NUM}\s*${SUFFIX}`, 'gi');
// An amount followed by one of these is a size / count, not money.
const NOT_MONEY_AFTER = /^\s*(?:\+\s*\+|\+)?\s*(?:sq\.?\s*f|sqft|sf\b|s\.f|ft|feet|kaki|sqm|sq\.?\s*m|m2|m²|acre|ekar|英亩|英尺|方尺|尺|平方|x\s*\d|×|\*\s*\d|bed|br\b|b\/r|room|rooms|r\b|房|厕|bath|b\b|toilet|stor|sty|stry|层|tingkat|year|yr|tahun|年|floor|flr|level|lvl|unit|units|min|minute|mins|km|分钟|公里|%|psf|per\s*s|carpark|car park|parking|pax|person|people|tenants?|months? deposit|个月|lot\b|lots\b|blk|block|\/\d)/i;
const NOT_MONEY_BEFORE = /(?:no\.?|lot|unit|blk|block|jalan|jln|level|lvl|floor|tingkat|ren|e|pea|tel|hp|whatsapp|wa|call|phone|\+|\d[x×*]|#|ref)\s*[:.\-]?\s*$/i;

function mult(suffix) {
  const s = (suffix || '').toLowerCase();
  if (!s) return 1;
  if (s === 'k' || s === '千') return 1e3;
  if (s === '万') return 1e4;
  return 1e6; // m, mil, million, mill, mln, juta
}

/** Scan money-like amounts in one line. */
export function scanAmounts(line) {
  const out = [];
  AMOUNT_RE.lastIndex = 0;
  let m;
  while ((m = AMOUNT_RE.exec(line))) {
    const start = m.index, end = m.index + m[0].length;
    const before = line.slice(Math.max(0, start - 12), start);
    const after = line.slice(end, end + 14);
    const rm = !!m[1];
    if (!rm && NOT_MONEY_BEFORE.test(before)) continue;
    if (NOT_MONEY_AFTER.test(after) && !m[3]) continue;
    if (/^\s*(?:sq|sf|psf|acre|ekar|x\s*\d)/i.test(after)) continue;
    // phone numbers and long digit runs are never prices
    if (/\d[\s-]\d{3,4}[\s-]?\d{4}/.test(line.slice(start, end + 10)) && !rm) continue;
    const raw = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(raw)) continue;
    out.push({ value: raw * mult(m[3]), base: raw, suffix: (m[3] || '').toLowerCase(), rm, start, end, text: m[0] });
  }
  return out;
}

const BANK_LINE = /bank\s*val|\bbv\b|valuation|估价|银行估|银行价|bank price|nilai bank/i;
const SKIP_LINE = /maint|service charge|sinking|quit\s*rent|cukai|assessment|deposit|booking|admin fee|legal|管理费|订金|押金|stamp|loan|instal+ment|分期|月供|rebate|cashback|commission|komisen|utilit|ansuran|\bsc\b|\bsf\s*[:=]|cash\s*out|cashout|spa price|below market by|save\s+rm/i;
const PRICE_WORD = /price|asking|selling|\bsale\b|\bsell\b|rent|rental|sewa|harga|jual|租金|月租|售价|价钱|价格|价|卖|租|nego|only|\bfor\b|\brm\b|@|💰|💵|💲/i;

function plausible(v, kind) {
  if (kind === 'rent') return v >= 100 && v <= 300000;
  if (kind === 'sale') return v >= 10000 && v <= 1e9;
  return v >= 100 && v <= 1e9;
}

function fixUnits(a, kind) {
  // "RM 680" in a sale post almost always means 680k; "RM 1.2" means 1.2m
  if (kind === 'sale' && !a.suffix) {
    if (a.value < 20 && a.base % 1 !== 0) return a.value * 1e6;
    if (a.value >= 100 && a.value < 10000) return a.value * 1e3;
  }
  return a.value;
}

/** Listing price + bank value from message text. kind: 'sale' | 'rent' | null */
export function extractPrice(text, kind) {
  const lines = String(text).split(/\n/);
  let price = null, bankValue = null;
  const pass = (wantKeyword) => {
    for (const line of lines) {
      const l = line.toLowerCase();
      if (BANK_LINE.test(l)) continue;
      if (SKIP_LINE.test(l)) continue;
      if (wantKeyword && !PRICE_WORD.test(l)) continue;
      for (const a of scanAmounts(l)) {
        if (!wantKeyword && !a.rm && !a.suffix) continue;
        if (!a.rm && !a.suffix && a.base < 100) continue;
        const v = fixUnits(a, kind);
        if (plausible(v, kind)) return v;
      }
    }
    return null;
  };
  for (const line of lines) {
    const l = line.toLowerCase();
    if (!BANK_LINE.test(l)) continue;
    const a = scanAmounts(l).find((x) => plausible(fixUnits(x, 'sale'), 'sale'));
    if (a) { bankValue = fixUnits(a, 'sale'); break; }
  }
  price = pass(true);
  if (price == null) price = pass(false);
  return { price, bankValue };
}

const NO_BUDGET = /follow(?:ing)? market|ikut (?:harga )?pasaran|ikut market|budget\s*(?:is\s*)?(?:open|flexible|flexi|not fixed|any|nego)|open budget|any budget|no budget|budget\s*tbc|随市场|预算不限|价钱好谈|看单位|市场价/i;
const BUDGET_LINE = /budget|bajet|预算|价钱|价位|价格|租金|price|rental|rent\s*[:：]|\brm\s*\d|\d\s*(?:k|mil|m|万)\b|\d万|below|under|max|maximum|within|not more than|less than|以下|以内|以上|左右|above|at least|minimum|\bmin\b|\+\+|around|range|sekitar|bawah|ke bawah/i;

/**
 * Request budget. Returns { budgetMin, budgetMax, budgetText } (numbers or null).
 * single value → min = max; "below X" → max only; "X++" → min only; "open" → none.
 */
export function parseBudget(text, kind) {
  const none = { budgetMin: null, budgetMax: null, budgetText: '' };
  const lines = String(text).split(/\n/);
  if (NO_BUDGET.test(text)) {
    const l = lines.find((x) => NO_BUDGET.test(x));
    return { ...none, budgetText: (l || '').trim().slice(0, 80) };
  }
  for (const line of lines) {
    const l = line.toLowerCase();
    if (!BUDGET_LINE.test(l)) continue;
    if (BANK_LINE.test(l) || /maint|deposit|booking/.test(l)) continue;
    // size lines ("built up 10k-40k sqft", "20-50 acres") are not budgets
    if (/sq\.?\s*f|sqft|\bsf\b|acre|ekar|英亩|built\s*-?\s*up|land\s*size|方尺/.test(l) && !/budget|bajet|预算|rm\s*\d|\brm\b|price|租金|rental/.test(l)) continue;
    const amts = scanAmounts(l).filter((a) => a.rm || a.suffix || a.base >= 100 || /budget|bajet|预算|price|租金/.test(l));
    if (!amts.length) continue;
    const fix = (a, other) => {
      let v = a.value;
      if (!a.suffix && other && other.suffix && a.base < other.base * 10) v = a.base * mult(other.suffix);
      if (kind === 'sale' && !a.suffix && !(other && other.suffix)) {
        if (v < 20 && a.base % 1 !== 0) v *= 1e6;
        else if (v >= 100 && v < 10000) v *= 1e3;
      }
      return v;
    };
    let min = null, max = null;
    // range "A - B", "A to B", "A~B", "A至B"
    for (let i = 0; i + 1 < amts.length; i++) {
      const between = l.slice(amts[i].end, amts[i + 1].start);
      if (/^\s*(?:-|–|—|~|to|至|到|until|hingga|sampai)\s*(?:rm)?\s*$/i.test(between)) {
        min = fix(amts[i], amts[i + 1]);
        max = fix(amts[i + 1]);
        break;
      }
    }
    if (min == null) {
      const a = amts[0];
      const v = fix(a);
      const after = l.slice(a.end, a.end + 8);
      const before = l.slice(Math.max(0, a.start - 22), a.start);
      if (/below|under|max|maximum|within|not more than|less than|bawah|up to|upto|<|不超过|最多/.test(before) || /^\s*(?:以下|以内|及以下|below|and below|ke bawah|max)/.test(after)) {
        max = v;
      } else if (/above|at least|minimum|\bmin\b|from|start|>|最少|起/.test(before) || /^\s*(?:\+|以上|above|and above|ke atas)/.test(after)) {
        min = v;
      } else {
        min = max = v;
      }
    }
    if (min != null && max != null && min > max) [min, max] = [max, min];
    const plaus = (v) => v == null || (kind === 'rent' ? v >= 100 && v <= 300000 : v >= 1000);
    if (!plaus(min) || !plaus(max)) continue;
    return { budgetMin: min, budgetMax: max, budgetText: line.trim().slice(0, 80) };
  }
  return none;
}
