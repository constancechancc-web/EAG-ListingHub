// EAG Listing Hub — browser app. Search and matching run here with plain code (no AI, no cost).
import { SUPABASE_URL, SUPABASE_ANON_KEY, AI_ENDPOINT } from './supabase-config.js';
import { CATEGORIES, CATEGORY_ZH, TYPES, TYPE_ZH, REGION_NAMES, SOURCE_EAG, SOURCE_CO, SOURCES, RETENTION_DAYS } from './core/constants.js';
import { sourceForGroup, groupKey } from './core/whatsapp.js';
import { searchListings, prepareListing, cutoffTime } from './core/search.js';
import { buildMatchIndex, prepareRequest, matchAll, matchListing, runSliced } from './core/match.js';
import { buildAreaVocab } from './core/areas.js';
import { listingEnquiry, clientAgentMessage, waLink, listingSummary, bankValueDiff } from './core/messages.js';
import { fmtRM, compilePhrase, fieldHas, prepField, digitsOnly, norm } from './core/text.js';
import { analyseRequest } from './core/parse.js';

// ───────────────────────── state ─────────────────────────
const S = {
  store: null,
  user: null,
  tab: 'search',
  listings: [],
  requests: [],
  vocab: null,
  prepared: null, // prepared requests (for matching)
  prepGen: 0,
  matchGen: 0,
  f: { q: '', kind: '', category: '', type: '', region: '', source: '', bedMin: '', priceMin: '', priceMax: '', sqftMin: '', sqftMax: '', landMin: '', landMax: '' },
  results: [],
  shown: 30,
  m: { la: '', ra: '', q: '', kind: '', focus: null },
  pairs: [],
  pairsShown: 20,
  rq: { kind: '', status: 'open', q: '' },
  rqShown: 30,
  groupMap: {}, // admin overrides: groupKey → source
  lastUpdated: null, // ISO time of the newest import
  matchTotal: null, // number of match pairs (computed in the background)
  loaded: false, loading: false, cachePromise: null,
};
const APP_VERSION = 'v2.0';
const LOT_POSITIONS = [['Intermediate', 'Intermediate Lot'], ['End lot', 'End Lot'], ['Corner lot', 'Corner Lot']];
const PAGE = 30;
const pref = {
  get: (k, d = '') => { try { return localStorage.getItem('eag.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('eag.' + k, v); } catch {} },
};

// ───────────────────────── helpers ─────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mytDay = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
const fromDay = () => mytDay(cutoffTime() - 86400000);
const isLocalHost = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname) || location.hostname.endsWith('.localhost');

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied 已复制');
}

function postedLabel(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const day = mytDay(t);
  const time = iso.slice(11, 16);
  if (day === mytDay(Date.now())) return `<span class="today">Today 今天</span> ${time}`;
  const d = new Date(day + 'T00:00:00Z');
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()} ${time}`;
}

const priceText = (l) => (l.price == null ? 'Price on request 价钱私聊' : l.kind === 'rent' ? `Rental 租金 ${fmtRM(l.price)}/mo` : fmtRM(l.price));

function budgetText(r) {
  const { budgetMin: a, budgetMax: b } = r;
  if (a == null && b == null) return 'Budget open 预算不限';
  const unit = r.kind === 'rent' ? '/mo' : '';
  if (a != null && b != null) return a === b ? `Budget ${fmtRM(a)}${unit}` : `Budget ${fmtRM(a)} – ${fmtRM(b)}${unit}`;
  if (b != null) return `Below ${fmtRM(b)}${unit} 以下`;
  return `${fmtRM(a)}${unit} and above 以上`;
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ───────────────────────── boot / auth ─────────────────────────
async function boot() {
  // Local test mode: no Supabase settings, or localhost with ?local=1 (keeps test data off the live database)
  const local = !SUPABASE_URL || !SUPABASE_ANON_KEY || (isLocalHost && new URLSearchParams(location.search).has('local'));
  if (local && !isLocalHost) {
    app().innerHTML = `<section class="panel center"><h2>Not configured 尚未设定</h2><p class="muted">Supabase settings are missing. 请先按说明填写 supabase-config.js。</p></section>`;
    return;
  }
  if (local) {
    const { createLocalStore } = await import('./store/local-store.js');
    S.store = createLocalStore();
  } else {
    const { createSupabaseStore } = await import('./store/supabase-store.js');
    S.store = createSupabaseStore();
  }
  // read this browser's saved copy while the sign-in is being checked (it is only shown once the role is confirmed)
  S.cachePromise = S.store.loadCached ? S.store.loadCached(fromDay()).catch(() => null) : null;
  S.store.onUser(onUser);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

const metaCache = {
  get() { try { return JSON.parse(localStorage.getItem('eag.meta') || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem('eag.meta', JSON.stringify(v)); } catch {} },
};

async function onUser(u) {
  // The same person "signing in" again (browser tab regained focus) needs nothing: keep the screen as it is.
  if (u && S.user && S.user.email === u.email && S.user.role === u.role && (S.loaded || S.loading)) return;
  S.user = u;
  S.loaded = false;
  if (!u) { S.loading = false; return renderLogin(); }
  if (!u.role) { S.loading = false; return renderDenied(u); }
  S.loading = true;

  // 1) Show the saved copy at once, then bring it up to date quietly.
  let cached = null;
  try { cached = S.cachePromise ? await S.cachePromise : null; } catch {}
  S.cachePromise = null;
  if (cached && (cached.listings.length || cached.requests.length)) {
    setData(cached.listings, cached.requests);
    const m = metaCache.get();
    if (m) { S.groupMap = m.groupMap || {}; S.lastUpdated = m.lastUpdated || null; }
    applySources();
    dataChanged();
    showApp();
    applyBranding();
    refreshInBackground();
    return;
  }

  // 2) First visit on this device (or the saved copy was cleared): download everything once.
  app().innerHTML = `<section class="panel center"><div class="spinner"></div><p>Loading listings 正在载入房源… <b id="loadPct"></b></p>
    <p class="small muted">First time on this device only, later it opens instantly. 只有这台设备第一次会比较久，之后很快。</p></section>`;
  try {
    await loadData();
  } catch (e) {
    S.loading = false;
    app().innerHTML = `<section class="panel center"><p class="err">Could not load data 载入失败</p><p class="small muted">${esc(e.message)}</p><button class="btn" data-act="signout">Sign out 登出</button></section>`;
    bindGlobal();
    return;
  }
  showApp();
  applyBranding();
}

function showApp() {
  const tabs = tabsFor(S.user.role);
  if (!tabs.some((t) => t.id === S.tab)) S.tab = 'search';
  S.loaded = true;
  S.loading = false;
  renderShell();
}

function renderLogin() {
  const local = S.store.mode === 'local';
  app().innerHTML = `
    <section class="panel login-card">
      <img class="logo app-logo" src="assets/eag-logo.png" alt="EAG">
      <h2>Sign in 登录</h2>
      ${local ? `
        <div class="local-banner">Local test mode 本地测试模式 — data stays in this browser only. 资料只存在这台电脑的浏览器。</div>
        <p class="muted small">Pick a role to test 选择要测试的身份：</p>
        <div class="row" style="justify-content:center">
          <button class="btn gold" data-act="local-login" data-role="admin">Admin 管理员</button>
          <button class="btn" data-act="local-login" data-role="editor">Editor 编辑</button>
          <button class="btn" data-act="local-login" data-role="viewer">Viewer 经纪</button>
        </div>` : `
        <p class="muted">Only invited team members can enter. 只有受邀的团队成员可以进入。</p>
        <button class="btn gold" data-act="google-login" style="width:100%">Sign in with Google 使用 Google 登录</button>`}
      <p class="small" style="margin:12px 0 0"><a href="privacy.html">Privacy Policy 隐私政策</a></p>
    </section>`;
  bindGlobal();
}

function renderDenied(u) {
  app().innerHTML = `
    <section class="panel login-card">
      <h2>No access 没有权限</h2>
      <p><b>${esc(u.email)}</b></p>
      <p class="muted">This email is not on the team list. Please ask the admin to add you.<br>这个邮箱不在名单内，请联系管理员加入。</p>
      <button class="btn" data-act="signout">Sign out 登出</button>
    </section>`;
  bindGlobal();
}

function setData(listings, requests) {
  const uniq = (arr) => { const m = new Map(); for (const x of arr) m.set(x.id, x); return [...m.values()]; };
  S.listings = uniq(listings).map(prepareListing);
  S.requests = uniq(requests);
}

const onLoadProgress = (p) => { const el = document.getElementById('loadPct'); if (el) el.textContent = Math.round(p * 100) + '%'; };

async function loadData() {
  const [data, gs, last] = await Promise.all([
    S.store.loadAll(fromDay(), onLoadProgress),
    S.store.getMeta('groupSources').catch(() => null),
    S.store.lastUpdated().catch(() => null),
  ]);
  setData(data.listings, data.requests);
  S.groupMap = (gs && gs.map) || {};
  S.lastUpdated = last;
  metaCache.set({ groupMap: S.groupMap, lastUpdated: S.lastUpdated });
  applySources();
  dataChanged();
}

/** After the saved copy is on screen: fetch what changed (and the small settings) and update the screen only if something did. */
async function refreshInBackground() {
  try {
    const [data, gs, last] = await Promise.all([
      S.store.loadAll(fromDay()),
      S.store.getMeta('groupSources').catch(() => null),
      S.store.lastUpdated().catch(() => null),
    ]);
    const map = (gs && gs.map) || {};
    const metaChanged = JSON.stringify(map) !== JSON.stringify(S.groupMap) || (last || null) !== (S.lastUpdated || null);
    if (!data.changed && !metaChanged) return;
    if (!S.user || !S.loaded) return; // signed out meanwhile
    S.groupMap = map;
    S.lastUpdated = last;
    metaCache.set({ groupMap: map, lastUpdated: last });
    if (data.changed) setData(data.listings, data.requests);
    applySources();
    dataChanged();
    softRefresh();
  } catch (e) {
    toast('Could not check for new listings 无法更新，稍后再试', 3500);
  }
}

/** Redraw the current tab with the new data, keeping the filters and how far the list was scrolled. */
function softRefresh() {
  if (S.tab === 'search' && document.querySelector('.stats-head')) {
    document.querySelector('.stats-head').outerHTML = statsHTML();
    fillStats();
    S.results = searchListings(S.listings, S.f);
    renderResults();
  } else if (S.tab === 'requests') renderReqList();
  else if (S.tab === 'match') runMatch();
}

/** Source comes from the group name (rules + Admin overrides), so a change applies to old items too. */
function applySources() {
  for (const x of S.listings) x.source = sourceForGroup(x.group, S.groupMap);
  for (const x of S.requests) x.source = sourceForGroup(x.group, S.groupMap);
}

const getVocab = () => (S.vocab ||= buildAreaVocab(S.listings)); // only needed for matching: built on first use

function dataChanged() {
  S.vocab = null;
  S.prepared = null;
  S.matchTotal = null;
  S.prepGen++;
}

/** Total number of listing ↔ WTB/WTR pairs, computed once in the background. */
async function computeMatchTotal() {
  if (S.matchTotal != null) return S.matchTotal;
  const gen = S.prepGen;
  const prepared = await ensurePrepared();
  const pairs = await matchAll(prepared.filter((r) => r.status !== 'closed'), buildMatchIndex(S.listings), { isCurrent: () => gen === S.prepGen });
  if (!pairs) return null;
  S.matchTotal = pairs.length;
  return S.matchTotal;
}

/** Re-read every request's text (sliced so the page stays responsive). */
async function ensurePrepared() {
  if (S.prepared) return S.prepared;
  const gen = S.prepGen;
  const out = [];
  const reqs = S.requests.filter((r) => Date.parse(r.postedAt) >= cutoffTime());
  const ok = await runSliced(reqs, (r) => out.push(prepareRequest(r, getVocab())), { isCurrent: () => gen === S.prepGen });
  if (!ok) return ensurePrepared();
  S.prepared = out;
  return out;
}

async function applyBranding() {
  try {
    const b = await S.store.getMeta('branding');
    if (b && b.logo) document.querySelectorAll('.app-logo').forEach((i) => (i.src = b.logo));
  } catch {}
}

// ───────────────────────── shell ─────────────────────────
function tabsFor(role) {
  const all = {
    search: 'Listing 搜索',
    import: '导入房源 Import',
    requests: '买租需求 WTB/WTR',
    match: '智能配对 Match',
    backup: '后台 Backend',
  };
  const ids = role === 'admin' ? ['search', 'import', 'requests', 'match', 'backup'] : role === 'editor' ? ['search', 'import', 'match'] : ['search', 'match'];
  return ids.map((id) => ({ id, label: all[id] }));
}

function renderShell() {
  const u = S.user;
  const roleName = { admin: 'Admin 管理员', editor: 'Editor 编辑', viewer: 'Viewer 经纪' }[u.role];
  app().innerHTML = `
    <section class="panel topcard">
    ${S.store.mode === 'local' ? '<div class="local-banner">Local test mode 本地测试模式 — not connected to the live database. 未连接正式数据库。</div>' : ''}
    <div class="userbar">
      <img class="logo-sm app-logo" src="assets/eag-logo.png" alt="EAG">
      <span class="role-badge">${roleName}</span>
      <span>${esc(u.email)}</span>
      <span class="spacer"></span>
      <button class="btn small" data-act="signout">Sign out 登出</button>
    </div>
    <nav class="tabs" role="tablist">
      ${tabsFor(u.role).map((t) => `<button class="tab ${t.id === S.tab ? 'is-active' : ''}" role="tab" data-tab="${t.id}">${t.label}</button>`).join('')}
    </nav>
    </section>
    <div id="view"></div>`;
  bindGlobal();
  renderView();
}

function renderView() {
  const v = $('#view');
  if (!v) return;
  ({ search: viewSearch, import: viewImport, requests: viewRequests, match: viewMatch, backup: viewBackup }[S.tab] || viewSearch)(v);
}

function prefsBar() {
  const lang = pref.get('lang', 'en');
  return `
    <div class="prefs">
      <label class="prefs-name"><span class="prefs-label">Your name<br>你的名字</span>
        <input type="text" data-pref="name" value="${esc(pref.get('name'))}" placeholder="e.g. Amy Tan"></label>
      <div class="prefs-lang">
        <span class="prefs-lang-label">WhatsApp message language<br>信息语言</span>
        <div class="seg" aria-label="WhatsApp message language">
          <button data-lang="en" class="${lang === 'en' ? 'is-active' : ''}">EN</button>
          <button data-lang="zh" class="${lang === 'zh' ? 'is-active' : ''}">华语</button>
        </div>
      </div>
    </div>`;
}

// ───────────────────────── stats tiles ─────────────────────────
const ICON = {
  title: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/>',
  people: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c0-3.5 2.8-6 6.2-6s6.2 2.5 6.2 6"/><circle cx="17.2" cy="8.8" r="2.7"/><path d="M16.6 13.9c2.8.2 4.6 2.4 4.6 5.4"/>',
  hands: '<path d="m2 11 4.5-4 4 1.8L14 7l3.5 1.5L22 11"/><path d="m6.5 7-4.3 4.2 4.4 4.3 2.6 1.8 2.6-.8 2.6 1.2 4.3-4.4"/><path d="m10.2 12.6 2.2 2.1M12.8 11.2l2.3 2.2"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 6.3 6.2L4 8.5"/><path d="M4 3.5v5h5"/><path d="M4 12.5a8 8 0 0 0 13.7 5.3l2.3-2.3"/><path d="M20 20.5v-5h-5"/>',
};
const svg = (name, cls = 'stat-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const MYT = 'Asia/Kuala_Lumpur';
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: MYT });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: MYT }).toLowerCase();
const isTestSite = () => S.store.mode === 'local' || location.hostname !== 'eag-listinghub.vercel.app';

function statsHTML() {
  const cut = cutoffTime();
  const nL = S.listings.filter((l) => l._t >= cut).length;
  const nR = S.requests.filter((r) => Date.parse(r.postedAt) >= cut && r.status !== 'closed').length;
  const up = S.lastUpdated;
  const tile = (icon, label, value, id = '') => `
    <div class="stat-tile">${svg(icon)}<div><div class="stat-label">${label}</div><div class="stat-value"${id ? ` id="${id}"` : ''}>${value}</div></div></div>`;
  return `
    <section class="stats-head">
      <h2 class="page-title">${svg('title', 'title-ico')}房源搜索 Listing Search</h2>
      <div class="stats-grid">
        ${tile('house', '房源 Listings', nL.toLocaleString())}
        ${tile('people', '买租需求 WTB/WTR', nR.toLocaleString())}
        ${tile('hands', '配对 Matches', S.matchTotal != null ? S.matchTotal.toLocaleString() : '<span class="muted">…</span>', 'statMatches')}
        ${tile('refresh', '更新于 Updated', up ? `<span class="stat-date">${esc(fmtDate(up))}</span>` : '<span class="stat-date muted">—</span>')}
      </div>
      <p class="stats-sub">${isTestSite() ? `<span class="mono">test</span> · ` : ""}Last ${RETENTION_DAYS} days 最近${RETENTION_DAYS}天${up ? ` · last update 最后更新 ${esc(fmtDate(up))} ${esc(fmtTime(up))}` : ""}</p>
    </section>`;
}

async function fillStats() {
  const n = await computeMatchTotal();
  const el = document.getElementById('statMatches');
  if (el && n != null) el.textContent = n.toLocaleString();
}

/** "Bank value 银行估价 RM 600,000 · 19% below BV 低于估价" */
function bankValueHTML(l) {
  let html = `Bank value 银行估价 <b class="mono">${fmtRM(l.bankValue)}</b>`;
  const d = bankValueDiff(l);
  if (d != null) {
    if (d > 0) html += ` · <span class="bv-below">${d}% below BV 低于估价</span>`;
    else if (d < 0) html += ` · <span class="bv-above">${-d}% above BV 高于估价</span>`;
    else html += ` · <span class="muted">same as BV 等于估价</span>`;
  }
  return html;
}

// ───────────────────────── group sources (admin) ─────────────────────────
function renderGroups() {
  const box = document.getElementById('groupList');
  if (!box) return;
  const counts = new Map();
  for (const x of [...S.listings, ...S.requests]) {
    if (!x.group) continue;
    const k = groupKey(x.group);
    const c = counts.get(k) || { name: x.group, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  for (const k of Object.keys(S.groupMap)) if (!counts.has(k)) counts.set(k, { name: k, n: 0 });
  const rows = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  if (!rows.length) { box.innerHTML = '<p class="muted small">No groups yet — import a chat first. 还没有群组，请先导入聊天。</p>'; return; }
  box.innerHTML = `<table class="simple">${rows.map(([k, c]) => {
    const cur = sourceForGroup(c.name, S.groupMap);
    const changed = !!S.groupMap[k];
    return `<tr><td>${esc(c.name)}<div class="muted small">${c.n.toLocaleString()} items${changed ? ' · changed by Admin 已手动修改' : ''}</div></td>
      <td style="width:150px"><select data-gsrc="${esc(k)}" data-gname="${esc(c.name)}">${SOURCES.map((x) => opt(x.id, x.label, cur)).join('')}</select></td></tr>`;
  }).join('')}</table>`;
}

async function saveGroupSource(el) {
  const key = el.dataset.gsrc, name = el.dataset.gname, val = el.value;
  const map = { ...S.groupMap };
  if (sourceForGroup(name) === val) delete map[key]; // same as the built-in rule → no override needed
  else map[key] = val;
  try {
    await S.store.setMeta('groupSources', { map });
    S.groupMap = map;
    applySources();
    renderGroups();
    toast('Saved 已保存');
  } catch (e) {
    toast('Failed 失败: ' + e.message, 4000);
  }
}

// ───────────────────────── global events (delegated) ─────────────────────────
let bound = false;
function bindGlobal() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
}

async function onClick(e) {
  const t = e.target.closest('[data-act],[data-tab],[data-lang],[data-seg]');
  if (!t) return;
  if (t.dataset.tab) {
    S.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === S.tab));
    renderView();
    return;
  }
  if (t.dataset.lang) {
    pref.set('lang', t.dataset.lang);
    document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('is-active', b.dataset.lang === t.dataset.lang));
    return;
  }
  if (t.dataset.seg) {
    const [group, val] = t.dataset.seg.split(':');
    segHandlers[group]?.(val);
    return;
  }
  const act = t.dataset.act;
  const id = t.dataset.id;
  const lang = pref.get('lang', 'en');
  const name = pref.get('name');
  const L = () => S.listings.find((x) => x.id === id);
  const R = () => S.requests.find((x) => x.id === id) || (S.prepared || []).find((x) => x.id === id);
  switch (act) {
    case 'google-login':
      try { await S.store.signIn(); } catch (err) { toast('Sign-in failed 登录失败: ' + err.message, 4000); }
      break;
    case 'local-login': S.store.signIn(t.dataset.role); break;
    case 'signout': S.store.signOut(); break;
    case 'wa-ren': {
      const l = L();
      if (!name) toast('Tip: fill in "Your name" first 请先填写你的名字');
      window.open(waLink(l.renPhone, listingEnquiry(name, l, lang)), '_blank', 'noopener');
      break;
    }
    case 'copy-summary': copyText(listingSummary(L())); break;
    case 'copy-raw-l': copyText(L().raw); break;
    case 'copy-raw-r': copyText(R().raw); break;
    case 'show-matches':
      S.m = { la: '', ra: '', q: '', kind: '', focus: id };
      S.tab = 'match';
      renderShell();
      window.scrollTo({ top: $('#view').offsetTop - 10, behavior: 'smooth' });
      break;
    case 'wa-client': {
      const r = R(), l = S.listings.find((x) => x.id === t.dataset.lid);
      if (!name) toast('Tip: fill in "Your name" first 请先填写你的名字');
      window.open(waLink(r.renPhone, clientAgentMessage(name, r, l, lang)), '_blank', 'noopener');
      break;
    }
    case 'more-results': S.shown += PAGE; renderResults(); break;
    case 'more-pairs': S.pairsShown += 20; renderPairs(); break;
    case 'more-req': S.rqShown += PAGE; renderReqList(); break;
    case 'clear-focus': S.m.focus = null; viewMatch($('#view')); break;
    case 'reset-search':
      for (const k of Object.keys(S.f)) S.f[k] = '';
      viewSearch($('#view'));
      break;
    default:
      actionHandlers[act]?.(t, e);
  }
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.pref) pref.set(el.dataset.pref, el.value);
  if (el.dataset.f) { S.f[el.dataset.f] = el.value; if (el.tagName !== 'SELECT') debouncedSearch(); }
  if (el.dataset.m) { S.m[el.dataset.m] = el.value; debouncedMatch(); }
  if (el.dataset.rq) { S.rq[el.dataset.rq] = el.value; debouncedReq(); }
}

function onChange(e) {
  const el = e.target;
  if (el.dataset.f) {
    S.f[el.dataset.f] = el.value;
    if (el.dataset.f === 'category') { S.f.type = ''; viewSearch($('#view')); return; }
    runSearch();
  }
  if (el.dataset.m && el.tagName === 'SELECT') { S.m[el.dataset.m] = el.value; runMatch(); }
  if (el.dataset.rq && el.tagName === 'SELECT') { S.rq[el.dataset.rq] = el.value; renderReqList(true); }
  if (el.dataset.file) fileHandlers[el.dataset.file]?.(el);
  if (el.dataset.gsrc != null) saveGroupSource(el);
}

const segHandlers = {};
const actionHandlers = {};
const fileHandlers = {};

// ───────────────────────── SEARCH ─────────────────────────
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;

function viewSearch(v) {
  const f = S.f;
  const types = TYPES.filter((t) => !f.category || t.cat === f.category);
  v.innerHTML = `
    ${statsHTML()}
    <section class="panel">
      <div class="searchbox"><input type="search" data-f="q" value="${esc(f.q)}" placeholder="Keyword 关键词 e.g. Johor Jaya, Eco Palladium, 0123…" aria-label="Keyword"></div>
      <div class="grid3 wide">
        <label class="f"><span>Sale / Rent 买卖/出租</span><select data-f="kind">${opt('', 'All 全部', f.kind)}${opt('sale', 'For sale 出售', f.kind)}${opt('rent', 'For rent 出租', f.kind)}</select></label>
        <label class="f"><span>Category 类别</span><select data-f="category">${opt('', 'All 全部', f.category)}${CATEGORIES.map((c) => opt(c, `${c} ${CATEGORY_ZH[c]}`, f.category)).join('')}</select></label>
        <label class="f"><span>Type 类型</span><select data-f="type">${opt('', 'All 全部', f.type)}${types.map((t) => opt(t.id, `${t.id} ${t.zh}`, f.type)).join('')}</select></label>
        <label class="f"><span>Region 区域</span><select data-f="region">${opt('', 'All 全部', f.region)}${[...REGION_NAMES, 'Other'].map((r) => opt(r, r, f.region)).join('')}</select></label>
        <label class="f"><span>Source 来源</span><select data-f="source">${opt('', 'All 全部', f.source)}${SOURCES.map((x) => opt(x.id, x.label, f.source)).join('')}</select></label>
        <label class="f"><span>Bedrooms 房间</span><select data-f="bedMin">${opt('', 'Any 不限', f.bedMin)}${[1, 2, 3, 4, 5].map((n) => opt(n, `${n}+`, f.bedMin)).join('')}</select></label>
      </div>
      <div class="grid2" style="margin-top:8px">
        <label class="f"><span>Min price 最低价 (RM)</span><input type="number" inputmode="numeric" data-f="priceMin" value="${esc(f.priceMin)}" placeholder="0"></label>
        <label class="f"><span>Max price 最高价 (RM)</span><input type="number" inputmode="numeric" data-f="priceMax" value="${esc(f.priceMax)}" placeholder="Any"></label>
      </div>
      ${f.category === 'Industrial' ? `
      <div class="grid2" style="margin-top:8px">
        <label class="f"><span>Built-up min 建筑面积 (sqft)</span><input type="number" inputmode="numeric" data-f="sqftMin" value="${esc(f.sqftMin)}"></label>
        <label class="f"><span>Built-up max</span><input type="number" inputmode="numeric" data-f="sqftMax" value="${esc(f.sqftMax)}"></label>
        <label class="f"><span>Land min 土地面积 (sqft)</span><input type="number" inputmode="numeric" data-f="landMin" value="${esc(f.landMin)}"></label>
        <label class="f"><span>Land max</span><input type="number" inputmode="numeric" data-f="landMax" value="${esc(f.landMax)}"></label>
      </div>` : ''}
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn small" data-act="reset-search">Reset 重置</button></div>
    </section>
    ${prefsBar()}
    <div class="results-head"><span class="count" id="resCount"></span></div>
    <div class="cards" id="results"></div>
    <div id="resMore"></div>`;
  runSearch();
  fillStats();
}

const debouncedSearch = debounce(() => runSearch(), 220);

function runSearch() {
  S.results = searchListings(S.listings, S.f);
  S.shown = PAGE;
  renderResults();
}

function listingCard(l, { showMatchBtn = true } = {}) {
  const chips = [
    `<span class="chip k-${l.kind}">${l.kind === 'rent' ? 'For rent 出租' : 'For sale 出售'}</span>`,
    l.type && l.type !== 'Other' ? `<span class="chip">${esc(l.type)} ${esc(TYPE_ZH[l.type] || '')}</span>` : `<span class="chip">${esc(l.category || 'Other')}</span>`,
    l.region ? `<span class="chip">${esc(l.region)}</span>` : '',
    `<span class="chip ${l.source === SOURCE_EAG ? 'src-eag' : l.source === SOURCE_CO ? 'src-co' : ''}">${esc((SOURCES.find((x) => x.id === l.source) || SOURCES[2]).short)}</span>`,
  ].join('');
  const size = [
    l.dims && `Dimension 尺寸 ${esc(l.dims)}`,
    l.land && `Land 土地 ${Math.round(l.land).toLocaleString()} sqft`,
    l.sqft && `Built-up 建筑 ${Math.round(l.sqft).toLocaleString()} sqft`,
  ].filter(Boolean).join(' · ');
  const room = [l.bed != null && `${l.bed} bed 房`, l.bath != null && `${l.bath} bath 厕`, l.storeys && `${l.storeys} storey 层`, l.tenure, l.furnishing].filter(Boolean).join(' · ');
  // Lot position is only Intermediate / End / Corner. Bumi / Non-bumi are lot status, shown with the other features.
  const lot = LOT_POSITIONS.filter(([k]) => (l.features || []).includes(k)).map(([, label]) => label);
  const feats = (l.features || []).filter((x) => !LOT_POSITIONS.some(([k]) => k === x));
  return `
    <article class="card">
      <h4>${esc(l.title)}</h4>
      <div class="price">${esc(priceText(l))}</div>
      <div class="chips">${chips}</div>
      ${l.area && l.area !== l.title ? `<div class="spec">📍 ${esc(l.area)}</div>` : ''}
      ${size ? `<div class="spec">${size}</div>` : ''}
      ${room ? `<div class="spec">${esc(room)}</div>` : ''}
      ${lot.length ? `<div class="spec">Lot 位置: ${esc(lot.join(', '))}</div>` : ''}
      ${feats.length ? `<div class="spec">✦ ${esc(feats.join(' · '))}</div>` : ''}
      ${l.bankValue ? `<div class="spec">${bankValueHTML(l)}</div>` : ''}
      <div class="agent">REN <b>${esc(l.renName)}</b>${l.renPhone ? ` · ${esc(l.renPhone)}` : ''}</div>
      <div class="meta">${esc(l.group)} · ${postedLabel(l.postedAt)}</div>
      <div class="card-foot">
        <details class="raw"><summary>Original WhatsApp message 原始讯息</summary><pre>${esc(l.raw)}</pre></details>
        <div class="actions">
          <button class="btn wa small" data-act="wa-ren" data-id="${esc(l.id)}">WhatsApp REN 联系经纪</button>
          <button class="btn small" data-act="copy-summary" data-id="${esc(l.id)}">Copy 复制资料</button>
          ${showMatchBtn ? `<button class="btn dark small" data-act="show-matches" data-id="${esc(l.id)}"><span data-mc="${esc(l.id)}">…</span> matching clients →</button>` : ''}
        </div>
      </div>
    </article>`;
}

function renderResults() {
  const box = $('#results');
  if (!box) return;
  $('#resCount').textContent = `${S.results.length.toLocaleString()} listings 个房源`;
  const page = S.results.slice(0, S.shown);
  box.innerHTML = page.length ? page.map((l) => listingCard(l)).join('') : `<div class="empty">No listings found 没有找到房源</div>`;
  $('#resMore').innerHTML = S.results.length > S.shown ? `<button class="btn more" data-act="more-results">Show more 显示更多 (${(S.results.length - S.shown).toLocaleString()})</button>` : '';
  fillMatchCounts(page);
}

async function fillMatchCounts(page) {
  const prepared = await ensurePrepared();
  for (const l of page) {
    const el = document.querySelector(`[data-mc="${CSS.escape(l.id)}"]`);
    if (el) el.textContent = matchListing(l, prepared).length;
  }
}

// ───────────────────────── MATCH ─────────────────────────
function viewMatch(v) {
  const m = S.m;
  const focus = m.focus && S.listings.find((l) => l.id === m.focus);
  v.innerHTML = `
    <section class="panel">
      <div class="grid2">
        <label class="f"><span>Listing agent name 房源经纪名字</span><input type="search" data-m="la" value="${esc(m.la)}" placeholder="e.g. Alan"></label>
        <label class="f"><span>WTB/WTR agent name 需求经纪名字</span><input type="search" data-m="ra" value="${esc(m.ra)}" placeholder="e.g. Kelly"></label>
      </div>
      <div class="grid2" style="margin-top:8px">
        <label class="f"><span>Keyword 关键词 (exact phrase)</span><input type="search" data-m="q" value="${esc(m.q)}" placeholder="e.g. Mount Austin"></label>
        <label class="f"><span>WTB / WTR</span><select data-m="kind">${opt('', 'All 全部', m.kind)}${opt('sale', 'WTB 求购', m.kind)}${opt('rent', 'WTR 求租', m.kind)}</select></label>
      </div>
      ${focus ? `<div class="note" style="margin-top:10px">Showing clients for 只显示此房源: <b>${esc(focus.title)}</b> · ${esc(priceText(focus))} <button class="btn small" data-act="clear-focus">Show all 显示全部</button></div>` : ''}
    </section>
    ${prefsBar()}
    <div class="results-head"><span class="count" id="pairCount">Matching 配对中…</span></div>
    <div class="progress" id="matchProg"><i></i></div>
    <div class="cards" id="pairs"></div>
    <div id="pairMore"></div>`;
  runMatch();
}

const debouncedMatch = debounce(() => runMatch(), 300);

async function runMatch() {
  const gen = ++S.matchGen;
  const isCurrent = () => gen === S.matchGen && S.tab === 'match';
  const prog = $('#matchProg i');
  const progBox = $('#matchProg');
  if (progBox) progBox.classList.remove('hide');
  const prepared = await ensurePrepared();
  if (!isCurrent()) return;
  const m = S.m;
  const agentFilter = (q) => {
    const s = norm(q), d = digitsOnly(q);
    if (!s) return () => true;
    return (name, phone) => norm(name).includes(s) || (d.length >= 4 && digitsOnly(phone).includes(d));
  };
  const la = agentFilter(m.la), ra = agentFilter(m.ra);
  const reqs = prepared.filter((r) => r.status !== 'closed' && (!m.kind || r.kind === m.kind) && ra(r.renName, r.renPhone));
  let pairs;
  if (m.focus) {
    const l = S.listings.find((x) => x.id === m.focus);
    pairs = l ? matchListing(l, reqs) : [];
  } else {
    const ls = m.la ? S.listings.filter((l) => la(l.renName, l.renPhone)) : S.listings;
    const index = buildMatchIndex(ls);
    pairs = await matchAll(reqs, index, { isCurrent, onProgress: (p) => { if (prog) prog.style.width = Math.round(p * 100) + '%'; } });
    if (!pairs) return;
  }
  const kw = compilePhrase(m.q);
  if (kw) {
    pairs = pairs.filter((p) => p.listing._f.fields.some((f) => fieldHas(kw, f)) || fieldHas(kw, prepField(p.request.raw)) || (kw.digits && digitsOnly(p.request.renPhone).includes(kw.digits)));
  }
  if (!isCurrent()) return;
  S.pairs = pairs;
  S.pairsShown = 20;
  if (progBox) progBox.classList.add('hide');
  renderPairs();
}

function pairCard(p) {
  const { listing: l, request: r } = p;
  const who = r.kind === 'rent' ? 'TENANT 租客' : 'BUYER 买家';
  const reasons = p.reasons.map((x) => `<li class="${/✓/.test(x) ? 'ok' : /over|below/.test(x) ? 'warn' : ''}">${esc(x)}</li>`).join('');
  return `
    <article class="card pair">
      <div class="top">
        <div class="score" title="Match score">${p.score}</div>
        <div style="min-width:0">
          <div class="who">${who} · ${r.kind === 'rent' ? 'WTR' : 'WTB'}</div>
          <div><b>Client of ${esc(r.renName)}</b>${r.clientName ? ` · ${esc(r.clientName)}` : ''}</div>
          <div class="small">${esc(budgetText(r))} · ${esc(r.areas.join(', '))}</div>
          <div class="meta">${postedLabel(r.postedAt)}</div>
        </div>
      </div>
      <div class="lsum">
        <b>${esc(l.title)}</b> · ${esc(priceText(l))}<br>
        ${esc(l.type)} ${esc(TYPE_ZH[l.type] || '')} · ${esc(l.region)} · REN ${esc(l.renName)}
      </div>
      <ul class="reasons">${reasons}</ul>
      <div class="card-foot">
        <details class="raw"><summary>Listing original post 房源原文</summary><pre>${esc(l.raw)}</pre></details>
        <details class="raw"><summary>WTB/WTR original post 需求原文</summary><pre>${esc(r.raw)}</pre></details>
        <div class="actions">
          <button class="btn small" data-act="copy-raw-l" data-id="${esc(l.id)}">Copy listing post 复制房源</button>
          <button class="btn small" data-act="copy-raw-r" data-id="${esc(r.id)}">Copy WTB post 复制需求</button>
          <button class="btn wa small" data-act="wa-client" data-id="${esc(r.id)}" data-lid="${esc(l.id)}">WhatsApp Client Agent 联系客户经纪</button>
          <button class="btn wa small" data-act="wa-ren" data-id="${esc(l.id)}">WhatsApp Listing Agent 联系房源经纪</button>
        </div>
      </div>
    </article>`;
}

function renderPairs() {
  const box = $('#pairs');
  if (!box) return;
  $('#pairCount').textContent = `${S.pairs.length.toLocaleString()} matches 个配对`;
  const page = S.pairs.slice(0, S.pairsShown);
  box.innerHTML = page.length ? page.map(pairCard).join('') : `<div class="empty">No matches yet 暂时没有配对<br><span class="small">Pairs need the same sale/rent, exact property type, a real area and a price within budget.<br>配对需要：同买/租、完全相同类型、明确地区、价钱在预算范围内。</span></div>`;
  $('#pairMore').innerHTML = S.pairs.length > S.pairsShown ? `<button class="btn more" data-act="more-pairs">Show more 显示更多 (${(S.pairs.length - S.pairsShown).toLocaleString()})</button>` : '';
}

// ───────────────────────── REQUESTS (admin) ─────────────────────────
function viewRequests(v) {
  const q = S.rq;
  v.innerHTML = `
    <section class="panel">
      <div class="grid3">
        <label class="f"><span>WTB / WTR</span><select data-rq="kind">${opt('', 'All 全部', q.kind)}${opt('sale', 'WTB 求购', q.kind)}${opt('rent', 'WTR 求租', q.kind)}</select></label>
        <label class="f"><span>Status 状态</span><select data-rq="status">${opt('', 'All 全部', q.status)}${opt('open', 'Open 进行中', q.status)}${opt('closed', 'Closed 已结束', q.status)}</select></label>
        <label class="f"><span>Keyword 关键词</span><input type="search" data-rq="q" value="${esc(q.q)}"></label>
      </div>
    </section>
    <div class="results-head"><span class="count" id="rqCount"></span></div>
    <div class="cards" id="rqList"></div>
    <div id="rqMore"></div>`;
  renderReqList(true);
}

const debouncedReq = debounce(() => renderReqList(true), 250);

function filteredRequests() {
  const q = S.rq, kw = compilePhrase(q.q), cut = cutoffTime();
  return S.requests
    .filter((r) => Date.parse(r.postedAt) >= cut)
    .filter((r) => (!q.kind || r.kind === q.kind) && (!q.status || (r.status || 'open') === q.status))
    .filter((r) => !kw || fieldHas(kw, prepField(r.raw)) || fieldHas(kw, prepField(r.renName)))
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

function renderReqList(reset) {
  if (reset) S.rqShown = PAGE;
  const box = $('#rqList');
  if (!box) return;
  const list = filteredRequests();
  $('#rqCount').textContent = `${list.length.toLocaleString()} requests 个需求`;
  box.innerHTML = list.slice(0, S.rqShown).map((r) => {
    const a = analyseRequest(r.raw, getVocab()); // text overrides saved fields
    const full = { ...r, ...a };
    const types = a.types.length ? a.types.map((t) => `${t} ${TYPE_ZH[t] || ''}`).join(', ') : 'Type unknown 类型不明';
    const closed = (r.status || 'open') === 'closed';
    return `
      <article class="card">
        <div class="who">${a.kind === 'rent' ? 'WTR 求租' : a.kind === 'sale' ? 'WTB 求购' : '?'} · ${closed ? 'Closed 已结束' : 'Open 进行中'}</div>
        <h4>${esc(a.areas.join(', ') || 'No area 没有地区 (will not match)')}</h4>
        <div class="spec">${esc(a.category)} · ${esc(types)}</div>
        <div class="spec">${esc(budgetText(full))}${a.bedMin ? ` · ${a.bedMin}+ bed` : ''}${a.furnishing ? ' · ' + esc(a.furnishing) : ''}</div>
        <div class="agent">Agent <b>${esc(r.renName)}</b>${r.renPhone ? ' · ' + esc(r.renPhone) : ''}</div>
        <div class="meta">${esc(r.group)} · ${postedLabel(r.postedAt)}</div>
        <div class="card-foot">
          <details class="raw"><summary>Original post 原文</summary><pre>${esc(r.raw)}</pre></details>
          <div class="actions">
            <button class="btn small" data-act="req-toggle" data-id="${esc(r.id)}">${closed ? 'Reopen 重新开启' : 'Close 结束'}</button>
            <button class="btn danger small" data-act="req-delete" data-id="${esc(r.id)}">Delete 删除</button>
          </div>
        </div>
      </article>`;
  }).join('') || `<div class="empty">No requests 没有需求</div>`;
  $('#rqMore').innerHTML = list.length > S.rqShown ? `<button class="btn more" data-act="more-req">Show more 显示更多</button>` : '';
}

actionHandlers['req-toggle'] = async (t) => {
  const r = S.requests.find((x) => x.id === t.dataset.id);
  const status = (r.status || 'open') === 'closed' ? 'open' : 'closed';
  try {
    await S.store.updateRequest(r, { status });
    r.status = status;
    S.prepared = null;
    renderReqList();
    toast(status === 'closed' ? 'Closed 已结束' : 'Reopened 已重新开启');
  } catch (e) { toast('Failed 失败: ' + e.message, 4000); }
};
actionHandlers['req-delete'] = async (t) => {
  const r = S.requests.find((x) => x.id === t.dataset.id);
  if (!confirm('Delete this request permanently?\n确定永久删除这个需求？')) return;
  try {
    await S.store.deleteItem('R', r);
    S.requests = S.requests.filter((x) => x !== r);
    S.prepared = null;
    renderReqList();
    toast('Deleted 已删除');
  } catch (e) { toast('Failed 失败: ' + e.message, 4000); }
};

// ───────────────────────── IMPORT (admin + editor) ─────────────────────────
async function viewImport(v) {
  const aiPossible = S.store.mode === 'supabase';
  v.innerHTML = `
    <section class="panel">
      <h2>Import WhatsApp chat 导入 WhatsApp 聊天</h2>
      <p class="small muted">WhatsApp → group → Export chat → <b>Without Media</b>. Pick the .zip or .txt below — you can select <b>many files at once</b> (iCloud / Files works).<br>
      WhatsApp → 群组 → 导出聊天 → 选择<b>不含媒体</b>，然后在这里选择 .zip 或 .txt 文件（可以一次选很多个）。</p>
      <div class="drop">
        <input type="file" data-file="chat" id="chatFile" multiple>
        <p class="small muted" style="margin:8px 0 0">Only messages from the last ${RETENTION_DAYS} days are kept. 只保留最近 ${RETENTION_DAYS} 天的讯息。</p>
      </div>
      ${aiPossible ? `<label class="row small" style="margin-top:10px"><input type="checkbox" id="useAI"> Use AI only for unclear messages 只对看不懂的讯息使用 AI（会产生少量费用）</label>` : ''}
      <div id="impStatus"></div>
    </section>
    <section class="panel">
      <h2>Scheduled import 定时导入 (12:00, 4:00 pm & 9:00 pm)</h2>
      <div id="impLog"><div class="spinner"></div></div>
    </section>`;
  try {
    const log = await S.store.getMeta('importLog');
    const box = $('#impLog'); if (box) box.innerHTML = renderImportLog(log);
  } catch (e) {
    const box = $('#impLog'); if (box) box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`;
  }
}

function renderImportLog(log) {
  if (!log || !log.runs || !log.runs.length) return `<p class="muted small">No scheduled import has run yet. 还没有定时导入记录。</p>`;
  const run = log.runs[0];
  const bad = (run.files || []).filter((f) => f.status !== 'ok' && f.status !== 'skipped');
  return `
    <p class="small">Last run 上次: <b>${esc(new Date(run.at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }))}</b> —
      ${(run.newListings || 0).toLocaleString()} new listings, ${(run.newRequests || 0).toLocaleString()} new WTB/WTR, ${(run.duplicates || 0).toLocaleString()} re-posts merged.</p>
    ${bad.length ? `<div class="note"><b class="err">Some files could not be imported 部分文件导入失败:</b>
      <table class="simple">${bad.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.reason || f.status)}${f.size ? ` (${(f.size / 1048576).toFixed(1)} MB)` : ''}</td></tr>`).join('')}</table>
      <p style="margin:6px 0 0">Re-export <b>Without Media</b>, or upload it here manually.<br>请重新导出（选择<b>不含媒体</b>），或在上方手动上传。</p></div>` : `<p class="ok small">All files imported OK 全部成功</p>`}`;
}

function setImp(html) { const el = $('#impStatus'); if (el) el.innerHTML = html; }
function progressHTML(pct, label) { return `<div class="progress"><i style="width:${Math.round(pct * 100)}%"></i></div><p class="small muted">${esc(label)}</p>`; }

fileHandlers.chat = async (input) => {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const useAI = !!($('#useAI') && $('#useAI').checked);
  input.disabled = true;
  const done = []; // one line per finished file
  let label = '';
  const logHTML = () => (done.length ? `<table class="simple" style="margin-top:6px">${done.map((d) => d.error
    ? `<tr><td>${esc(d.name)}</td><td class="err" colspan="3">${esc(d.error)}</td></tr>`
    : `<tr><td>${esc(d.name)}<div class="muted small">${esc(d.source)}</div></td><td>+${d.listings.toLocaleString()} listings</td><td>+${d.requests.toLocaleString()} WTB/WTR</td><td class="muted small">${d.merged.toLocaleString()} re-posts merged</td></tr>`).join('')}</table>` : '');
  const show = (pct, text) => setImp(`${files.length > 1 ? `<p class="small"><b>File ${done.length + 1} / ${files.length}</b> · ${esc(label)}</p>` : ''}${progressHTML(pct, text)}${logHTML()}`);
  show(0.02, 'Reading file 读取文件…');
  const worker = new Worker(new URL('./import-worker.js', import.meta.url), { type: 'module' });
  const call = (msg, transfer) => new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') show(d.pct, { read: 'Reading 读取…', parse: 'Parsing messages 解析讯息…', classify: 'Sorting listings & requests 分类中…' }[d.stage]);
      else if (d.type === 'error') reject(new Error(d.error));
      else resolve(d);
    };
    worker.onerror = (e) => reject(new Error(e.message || 'Worker error'));
    worker.postMessage(msg, transfer || []);
  });
  // everything already on screen, by id, so new items are added and re-posts replace older copies
  const L = new Map(S.listings.map((x) => [x.id, x]));
  const R = new Map(S.requests.map((x) => [x.id, x]));
  const T = { listings: 0, requests: 0, merged: 0, dupes: 0, review: 0, tooOld: 0, messages: 0, failed: 0 };
  const reviewAll = [];
  for (const file of files) {
    label = file.name;
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await call({ cmd: 'parse', buffer, name: file.name, fromDay: fromDay() }, [buffer]);
      show(0.58, 'Checking duplicates 检查重复…');
      const seen = await S.store.seenFor(parsed.days);
      let { res } = await call({ cmd: 'process', seen: [...seen] });
      if (useAI && res.review.length) {
        show(0.8, `Asking AI about ${res.review.length} unclear messages 让 AI 判断…`);
        const hints = await aiHints(res.review);
        if (hints.length) ({ res } = await call({ cmd: 'process', seen: [...seen], hints }));
      }
      show(0.92, `Saving 保存中… (${(res.listings.length + res.requests.length).toLocaleString()} items)`);
      const added = await S.store.saveImport(res);
      for (const l of res.listings) { const cur = L.get(l.id); if (!cur || (l.postedAt || '') > (cur.postedAt || '')) L.set(l.id, l); }
      for (const r of res.requests) { const cur = R.get(r.id); if (!cur) R.set(r.id, r); else if ((r.postedAt || '') > (cur.postedAt || '')) R.set(r.id, { ...r, status: cur.status || r.status }); }
      const merged = res.merged + (res.listings.length - added.listings) + (res.requests.length - added.requests);
      T.listings += added.listings; T.requests += added.requests; T.merged += merged; T.dupes += res.duplicates; T.review += res.review.length;
      T.tooOld += parsed.tooOld; T.messages += parsed.total;
      reviewAll.push(...res.review);
      done.push({ name: parsed.group, source: sourceForGroup(parsed.group, S.groupMap), listings: added.listings, requests: added.requests, merged });
    } catch (e) {
      T.failed++;
      const msg = {
        NOT_WHATSAPP: 'Not a WhatsApp chat export 不是 WhatsApp 聊天导出文件',
        NO_TXT_IN_ZIP: 'No chat text (.txt) inside this zip 这个 zip 里没有聊天 .txt',
        BAD_FILE: 'Could not read this file 无法读取这个文件',
      }[e.message] || e.message;
      done.push({ name: file.name, error: msg });
    }
  }
  worker.terminate();
  // update the screen once, at the end (rebuilding the area list for 20,000+ listings takes a moment)
  S.listings = [...L.values()].map(prepareListing);
  S.requests = [...R.values()];
  applySources();
  if (T.listings || T.requests || T.merged) S.lastUpdated = new Date().toISOString();
  dataChanged();
  setImp(`
    <p class="${T.failed ? 'err' : 'ok'}">${T.failed ? `Finished with ${T.failed} problem(s) 完成，但有 ${T.failed} 个问题` : 'Done 完成'} · ${files.length} file(s) 个文件</p>
    <div class="stats">
      <div class="stat"><b>${T.listings.toLocaleString()}</b>New listings 新房源</div>
      <div class="stat"><b>${T.requests.toLocaleString()}</b>New WTB/WTR 新需求</div>
      <div class="stat"><b>${T.merged.toLocaleString()}</b>Re-posts merged 重复贴文合并</div>
      <div class="stat"><b>${T.review.toLocaleString()}</b>Need review 需要检查</div>
    </div>
    <p class="small muted">${T.messages.toLocaleString()} messages in the file(s) · ${T.tooOld.toLocaleString()} older than ${RETENTION_DAYS} days skipped · ${T.dupes.toLocaleString()} identical messages skipped.<br>
    Re-posts = the same agent posting the same text again; only the newest is kept. 同一位经纪重复贴同样内容，只保留最新的一条。</p>
    ${logHTML()}
    ${reviewAll.length ? `<details class="raw"><summary>Messages that need review 需要检查的讯息 (${reviewAll.length})</summary>
      ${reviewAll.slice(0, 100).map((r) => `<pre><b>${esc(r.renName)}</b> · ${esc(r.reason)}\n${esc(r.raw)}</pre>`).join('')}</details>` : ''}
    ${T.failed ? '<p class="small muted">Tip: WhatsApp → Export chat → Without Media 不含媒体</p>' : ''}`);
  input.disabled = false;
  input.value = '';
};

/** Send ONLY the message text (phone numbers removed) of unclear messages to the server-side AI helper. */
async function aiHints(review) {
  try {
    const token = await S.store.idToken();
    const items = review.slice(0, 200).map((r) => ({ id: r.hash, text: r.raw.replace(/(?:\+?6?0)1\d[\s-]?\d{3,4}[\s-]?\d{3,4}/g, '[phone]').slice(0, 1500) }));
    const out = [];
    for (let i = 0; i < items.length; i += 40) {
      const resp = await fetch(AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ items: items.slice(i, i + 40) }) });
      if (!resp.ok) throw new Error('AI ' + resp.status);
      const data = await resp.json();
      for (const h of data.results || []) out.push([h.id, h]);
    }
    return out;
  } catch (e) {
    toast('AI not available, used rules only 未能使用 AI，只用规则', 3500);
    return [];
  }
}

// ───────────────────────── BACKUP (admin) ─────────────────────────
let backupDone = false;
async function viewBackup(v) {
  v.innerHTML = `
    <section class="panel">
      <h2>Backup 备份</h2>
      <p class="small muted">Download everything as one JSON file. Do this before any delete. 删除任何资料之前，请先下载备份。</p>
      <button class="btn gold" data-act="backup-download">Download backup 下载备份 (JSON)</button>
      <h3>Restore 还原</h3>
      <p class="small muted">Adds items from a backup file. Existing items are kept (nothing is deleted). 从备份加入资料，不会删除现有资料。</p>
      <input type="file" data-file="restore">
      <div id="restoreStatus"></div>
    </section>
    <section class="panel">
      <h2>Old data 旧资料 (> ${RETENTION_DAYS} days)</h2>
      <p class="small muted">Items older than ${RETENTION_DAYS} days are already hidden. Delete them only after downloading a backup. 超过 ${RETENTION_DAYS} 天的资料已隐藏；下载备份后才可删除。</p>
      <div id="oldInfo"><button class="btn small" data-act="old-count">Count old items 计算旧资料</button></div>
    </section>
    <section class="panel">
      <h2>Users 用户权限</h2>
      <div class="grid3" style="margin-top:10px">
        <label class="f" style="grid-column: span 2"><span>Gmail</span><input type="email" id="newEmail" placeholder="agent@gmail.com"></label>
        <label class="f"><span>Role 身份</span><select id="newRole"><option value="viewer">Viewer 经纪</option><option value="editor">Editor 编辑</option></select></label>
      </div>
      <button class="btn gold" data-act="user-add" style="margin-top:8px">Add / update 加入/更新</button>
      <div id="userList" style="margin-top:12px"><div class="spinner"></div></div>
    </section>
    <section class="panel">
      <h2>Group sources 群组来源</h2>
      <p class="small muted">Each WhatsApp group belongs to EAG Listing, TRR Groups or Co Agency. Change a group here if it is sorted wrongly — old and new listings follow.<br>
      每个 WhatsApp 群组属于 EAG Listing、TRR Groups 或 Co Agency。分错了可以在这里改，旧的和新的房源都会跟着改。</p>
      <div id="groupList"></div>
    </section>
    <section class="panel">
      <h2>App logo 应用标志</h2>
      <p class="small muted">Change the logo shown on the cover. 更换封面上的标志。</p>
      <input type="file" data-file="logo">
      <button class="btn small" data-act="logo-reset">Reset to default 恢复默认</button>
    </section>
    <section class="panel">
      <h2 class="err">Clear all import data 清空全部导入资料</h2>
      <p class="small muted">Deletes ALL listings, WTB/WTR and duplicate history. Users are kept. Download a backup first.<br>会删除全部房源、需求和查重记录（用户名单保留）。请先下载备份。</p>
      <button class="btn danger" data-act="clear-all">Clear all 清空全部</button>
    </section>`;
  renderUsers();
  renderGroups();
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

actionHandlers['backup-download'] = async (t) => {
  t.disabled = true;
  try {
    const data = await S.store.exportAll();
    const payload = { app: 'eag-listing-hub', version: 1, exportedAt: new Date().toISOString(), counts: { listings: data.listings.length, requests: data.requests.length }, ...data };
    download(`eag-listing-hub-backup-${mytDay(Date.now())}.json`, JSON.stringify(payload));
    backupDone = true;
    toast(`Backup downloaded 已下载: ${data.listings.length} listings, ${data.requests.length} WTB/WTR`, 3500);
  } catch (e) { toast('Backup failed 备份失败: ' + e.message, 4000); }
  t.disabled = false;
};

fileHandlers.restore = async (input) => {
  const f = input.files && input.files[0];
  if (!f) return;
  const st = $('#restoreStatus');
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'eag-listing-hub' || !Array.isArray(data.listings) || !Array.isArray(data.requests)) throw new Error('Not an EAG Listing Hub backup 不是本系统的备份文件');
    if (!confirm(`Restore ${data.listings.length} listings and ${data.requests.length} WTB/WTR?\n还原 ${data.listings.length} 个房源和 ${data.requests.length} 个需求？`)) return;
    st.innerHTML = '<div class="spinner"></div>';
    const add = await S.store.restore(data);
    await loadData();
    st.innerHTML = `<p class="ok">Restored 已还原: +${add.listings} listings, +${add.requests} WTB/WTR</p>`;
  } catch (e) {
    st.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  } finally { input.value = ''; }
};

actionHandlers['old-count'] = async () => {
  const box = $('#oldInfo');
  box.innerHTML = '<div class="spinner"></div>';
  const all = await S.store.loadAll(null);
  const cut = fromDay();
  const n = all.listings.filter((x) => (x.day || '') < cut).length + all.requests.filter((x) => (x.day || '') < cut).length;
  box.innerHTML = n
    ? `<p>${n.toLocaleString()} old items 个旧资料</p><button class="btn danger" data-act="old-delete" data-n="${n}">Delete old items 删除旧资料</button>`
    : `<p class="ok small">Nothing older than ${RETENTION_DAYS} days 没有旧资料</p>`;
};
actionHandlers['old-delete'] = async (t) => {
  if (!backupDone) { toast('Please download a backup first 请先下载备份', 3500); return; }
  const typed = prompt(`Type DELETE to permanently remove ${t.dataset.n} old items.\n输入 DELETE 以永久删除 ${t.dataset.n} 个旧资料。`);
  if (typed !== 'DELETE') return;
  const n = await S.store.deleteDays(fromDay());
  $('#oldInfo').innerHTML = `<p class="ok">Deleted 已删除 ${n} items</p>`;
};
actionHandlers['clear-all'] = async () => {
  if (!backupDone) { toast('Please download a backup first 请先下载备份', 3500); return; }
  const typed = prompt('Type CLEAR ALL to delete ALL import data. This cannot be undone.\n输入 CLEAR ALL 以删除全部导入资料（无法恢复）。');
  if (typed !== 'CLEAR ALL') { if (typed != null) toast('Not cleared 未清空'); return; }
  await S.store.clearAll();
  await loadData();
  renderShell();
  toast('All import data cleared 已清空', 3500);
};

async function renderUsers() {
  const box = $('#userList');
  try {
    const users = await S.store.listUsers();
    box.innerHTML = users.length
      ? `<table class="simple">${users.map((u) => `<tr><td>${esc(u.email)}</td><td>${u.role === 'editor' ? 'Editor 编辑' : 'Viewer 经纪'}</td><td style="text-align:right"><button class="btn danger small" data-act="user-remove" data-email="${esc(u.email)}">Remove 移除</button></td></tr>`).join('')}</table>`
      : `<p class="muted small">No users yet 还没有用户</p>`;
  } catch (e) { box.innerHTML = `<p class="err small">${esc(e.message)}</p>`; }
}
actionHandlers['user-add'] = async () => {
  const email = $('#newEmail').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Invalid email 邮箱格式不对'); return; }
  await S.store.setUser(email, $('#newRole').value);
  $('#newEmail').value = '';
  toast('Saved 已保存');
  renderUsers();
};
actionHandlers['user-remove'] = async (t) => {
  if (!confirm(`Remove ${t.dataset.email}? 移除这个用户？`)) return;
  await S.store.removeUser(t.dataset.email);
  renderUsers();
};

fileHandlers.logo = async (input) => {
  const f = input.files && input.files[0];
  if (!f) return;
  try {
    const img = await createImageBitmap(f);
    const size = 256, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const s = Math.min(size / img.width, size / img.height);
    ctx.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
    const logo = c.toDataURL('image/png');
    await S.store.setMeta('branding', { logo });
    document.querySelectorAll('.app-logo').forEach((i) => (i.src = logo));
    toast('Logo updated 标志已更新');
  } catch (e) { toast('Could not use this image 无法使用这张图片', 3500); }
  input.value = '';
};
actionHandlers['logo-reset'] = async () => {
  await S.store.setMeta('branding', { logo: '' });
  document.querySelectorAll('.app-logo').forEach((i) => (i.src = 'assets/eag-logo.png'));
  toast('Logo reset 已恢复');
};

boot();
