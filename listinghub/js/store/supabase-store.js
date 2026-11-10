// Supabase (Postgres) data layer. Login = Supabase Auth with Google.
// Roles are enforced by Row Level Security in supabase/schema.sql; the UI only mirrors them.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase-config.js';
import { toStored } from '../core/importer.js';

const TABLE = { L: 'listings', R: 'requests' };
const PAGE = 1000; // Supabase returns at most 1000 rows per request

export function createSupabaseStore() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  let session = null;

  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  /** All rows of a table. The first page also returns the total, then the rest load 5 pages at a time. */
  async function selectAll(table, columns, filter) {
    const order = table === 'seen' ? 'hash' : table === 'app_users' ? 'email' : 'id';
    const page = (from, withCount) => {
      let q = sb.from(table).select(columns, withCount ? { count: 'exact' } : undefined).order(order).range(from, from + PAGE - 1);
      if (filter) q = filter(q);
      return q;
    };
    const first = await page(0, true);
    const firstRows = check(first);
    if (firstRows.length < PAGE) return firstRows;
    const pages = first.count != null ? Math.ceil(first.count / PAGE) : null;
    if (pages == null) { // total unknown → one page after the other
      const out = [...firstRows];
      for (let from = PAGE; ; from += PAGE) { const rows = check(await page(from)); out.push(...rows); if (rows.length < PAGE) return out; }
    }
    const results = new Array(pages);
    results[0] = firstRows;
    let next = 1;
    await Promise.all(Array.from({ length: Math.min(5, pages - 1) }, async () => {
      while (next < pages) { const p = next++; results[p] = check(await page(p * PAGE)); }
    }));
    return results.flat();
  }

  const toRow = (prefix, it) => {
    const data = toStored(it);
    const row = { id: data.id, day: data.day || String(data.postedAt).slice(0, 10), posted_at: data.postedAt || null, data };
    if (prefix === 'R') row.status = data.status === 'closed' ? 'closed' : 'open';
    return row;
  };
  const fromRow = (r) => (r.status ? { ...r.data, status: r.status } : r.data);

  /** Add new items; a re-post (same id) replaces the old copy only if it is newer. Done by the database function import_items(). */
  async function importItems(table, items, prefix) {
    let added = 0, bumped = 0;
    for (let i = 0; i < items.length; i += 300) {
      const out = check(await sb.rpc('import_items', { p_table: table, p_rows: items.slice(i, i + 300).map((x) => toRow(prefix, x)) }));
      added += out.added; bumped += out.bumped;
    }
    return { added, bumped };
  }

  /** Insert, skipping anything already there (ON CONFLICT DO NOTHING). Returns how many were new. */
  async function insertNew(table, rows, key = 'id', returning = true) {
    let added = 0;
    for (let i = 0; i < rows.length; i += 500) {
      let q = sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: key, ignoreDuplicates: true });
      if (returning) q = q.select(key);
      const data = check(await q);
      added += returning ? (data || []).length : 0;
    }
    return added;
  }

  return {
    mode: 'supabase',

    onUser(cb) {
      const emit = async (s) => {
        session = s;
        if (!s) return cb(null);
        const { data: role } = await sb.rpc('app_role');
        cb({ email: s.user.email, name: s.user.user_metadata?.full_name || '', role: role && role !== 'none' ? role : null });
      };
      const { data } = sb.auth.onAuthStateChange((event, s) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => emit(s), 0);
        else session = s; // TOKEN_REFRESHED etc.
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn() {
      const redirectTo = location.origin + location.pathname;
      check(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } }));
    },
    signOut: () => sb.auth.signOut(),
    idToken: async () => (await sb.auth.getSession()).data.session?.access_token || null,

    async loadAll(fromDay) {
      const f = fromDay ? (q) => q.gte('day', fromDay) : null;
      const [l, r] = await Promise.all([selectAll('listings', 'data', f), selectAll('requests', 'data,status', f)]);
      return { listings: l.map(fromRow), requests: r.map(fromRow) };
    },

    async seenFor(days) {
      const set = new Set();
      for (let i = 0; i < days.length; i += 50) {
        const chunk = days.slice(i, i + 50);
        for (const r of await selectAll('seen', 'hash', (q) => q.in('day', chunk))) set.add(r.hash);
      }
      return set;
    },

    async saveImport({ listings, requests, newHashes }) {
      const L = await importItems('listings', listings, 'L');
      const R = await importItems('requests', requests, 'R');
      if (newHashes.length) await insertNew('seen', newHashes.map(({ hash, day }) => ({ hash, day })), 'hash', false);
      return { listings: L.added, requests: R.added, bumpedListings: L.bumped, bumpedRequests: R.bumped };
    },

    async updateRequest(item, patch) {
      const data = toStored({ ...item, ...patch });
      check(await sb.from('requests').update({ data, status: data.status === 'closed' ? 'closed' : 'open' }).eq('id', item.id));
    },
    async deleteItem(prefix, item) {
      check(await sb.from(TABLE[prefix]).delete().eq('id', item.id));
    },

    async exportAll() {
      const [l, r, users, seenRows] = await Promise.all([
        selectAll('listings', 'data'), selectAll('requests', 'data,status'), selectAll('app_users', 'email,role,added_at'), selectAll('seen', 'hash,day'),
      ]);
      const seen = new Map();
      for (const s of seenRows) { if (!seen.has(s.day)) seen.set(s.day, []); seen.get(s.day).push(s.hash); }
      return { listings: l.map(fromRow), requests: r.map(fromRow), users, seen: [...seen].map(([day, hashes]) => ({ day, hashes })) };
    },
    async restore(data) {
      const add = await this.saveImport({ listings: data.listings || [], requests: data.requests || [], newHashes: [] });
      const seenRows = [];
      for (const s of data.seen || []) for (const h of s.hashes || []) seenRows.push({ hash: h, day: s.day });
      if (seenRows.length) await insertNew('seen', seenRows, 'hash', false);
      for (const u of data.users || []) if (u.email && (u.role === 'editor' || u.role === 'viewer')) await this.setUser(u.email, u.role);
      return add;
    },

    async deleteDays(beforeDay) {
      const l = check(await sb.from('listings').delete().lt('day', beforeDay).select('id')) || [];
      const r = check(await sb.from('requests').delete().lt('day', beforeDay).select('id')) || [];
      check(await sb.from('seen').delete().lt('day', beforeDay));
      return l.length + r.length;
    },
    async clearAll() {
      for (const t of ['listings', 'requests']) check(await sb.from(t).delete().neq('id', ''));
      check(await sb.from('seen').delete().neq('hash', ''));
    },

    listUsers: () => selectAll('app_users', 'email,role,added_at'),
    async setUser(email, role) {
      check(await sb.from('app_users').upsert({ email: email.toLowerCase().trim(), role }, { onConflict: 'email' }));
    },
    async removeUser(email) { check(await sb.from('app_users').delete().eq('email', email)); },

    /** Time the newest listing or request was added (by any import, manual or scheduled). */
    async lastUpdated() {
      const m = await this.getMeta('lastImport');
      if (m && m.at) return m.at;
      const newest = async (t) => {
        const rows = check(await sb.from(t).select('created_at').order('created_at', { ascending: false }).limit(1));
        return rows && rows[0] ? rows[0].created_at : null;
      };
      const [a, b] = await Promise.all([newest('listings'), newest('requests')]);
      return [a, b].filter(Boolean).sort().pop() || null;
    },

    async getMeta(id) {
      const rows = check(await sb.from('meta').select('data').eq('id', id).limit(1));
      return rows && rows[0] ? rows[0].data : null;
    },
    async setMeta(id, patch) {
      const cur = (await this.getMeta(id)) || {};
      check(await sb.from('meta').upsert({ id, data: { ...cur, ...patch }, updated_at: new Date().toISOString() }, { onConflict: 'id' }));
    },
  };
}
