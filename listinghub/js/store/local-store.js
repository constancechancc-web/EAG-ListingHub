// Local test mode (localhost only, no Supabase settings): data lives in this browser's IndexedDB.
// A role switcher lets the owner try Admin / Editor / Viewer screens before going live.
import { OWNER_EMAIL } from '../supabase-config.js';

const DB_NAME = 'eag-listing-hub-local';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('L', { keyPath: 'id' });
      db.createObjectStore('R', { keyPath: 'id' });
      db.createObjectStore('seen', { keyPath: 'hash' });
      db.createObjectStore('users', { keyPath: 'email' });
      db.createObjectStore('meta', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export function createLocalStore() {
  const dbP = open();
  let listeners = [];
  const roleKey = 'eag.localRole';
  const getRole = () => { try { return localStorage.getItem(roleKey) || ''; } catch { return ''; } };
  const user = () => {
    const role = getRole();
    return role ? { email: role === 'admin' ? OWNER_EMAIL : `${role}@test.local`, name: 'Local ' + role, role } : null;
  };
  const all = async (store) => reqP((await dbP).transaction(store).objectStore(store).getAll());
  const putMany = async (store, items) => {
    const tx = (await dbP).transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    let added = 0;
    for (const it of items) {
      const exists = await reqP(os.getKey(it.id ?? it.hash ?? it.email));
      if (exists === undefined) added++;
      os.put(it);
    }
    await done(tx);
    return added;
  };

  return {
    mode: 'local',
    onUser(cb) { listeners.push(cb); setTimeout(() => cb(user()), 0); return () => (listeners = listeners.filter((x) => x !== cb)); },
    async signIn(role = 'admin') { try { localStorage.setItem(roleKey, role); } catch {} listeners.forEach((cb) => cb(user())); },
    async signOut() { try { localStorage.removeItem(roleKey); } catch {} listeners.forEach((cb) => cb(null)); },
    idToken: async () => null,

    async loadAll(fromDay) {
      const f = (x) => !fromDay || (x.day || '') >= fromDay;
      return { listings: (await all('L')).filter(f), requests: (await all('R')).filter(f) };
    },
    async seenFor(days) {
      const want = new Set(days);
      return new Set((await all('seen')).filter((s) => want.has(s.day)).map((s) => s.hash));
    },
    async saveImport({ listings, requests, newHashes }) {
      const strip = (o) => JSON.parse(JSON.stringify(o));
      // new items are added; a re-post (same id) replaces the old copy only if it is newer
      const merge = async (store, items) => {
        const tx = (await dbP).transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        let added = 0, bumped = 0;
        for (const raw of items) {
          const it = strip(raw);
          const cur = await reqP(os.get(it.id));
          if (!cur) { os.put(it); added++; }
          else if ((it.postedAt || '') > (cur.postedAt || '')) { os.put({ ...it, ...(cur.status ? { status: cur.status } : {}) }); bumped++; }
        }
        await done(tx);
        return { added, bumped };
      };
      const l = await merge('L', listings);
      const r = await merge('R', requests);
      if (newHashes.length) await putMany('seen', newHashes);
      if (l.added || r.added || l.bumped || r.bumped) await this.setMeta('lastImport', { at: new Date().toISOString() });
      return { listings: l.added, requests: r.added, bumpedListings: l.bumped, bumpedRequests: r.bumped };
    },
    async lastUpdated() {
      const m = await this.getMeta('lastImport');
      return m && m.at ? m.at : null;
    },
    async updateRequest(item, patch) {
      const tx = (await dbP).transaction('R', 'readwrite');
      const os = tx.objectStore('R');
      const cur = await reqP(os.get(item.id));
      if (cur) os.put({ ...cur, ...patch });
      await done(tx);
    },
    async deleteItem(prefix, item) {
      const tx = (await dbP).transaction(prefix, 'readwrite');
      tx.objectStore(prefix).delete(item.id);
      await done(tx);
    },
    async exportAll() {
      const seenRows = await all('seen');
      const seen = new Map();
      for (const s of seenRows) { if (!seen.has(s.day)) seen.set(s.day, []); seen.get(s.day).push(s.hash); }
      return { listings: await all('L'), requests: await all('R'), users: await all('users'), seen: [...seen].map(([day, hashes]) => ({ day, hashes })) };
    },
    async restore(data) {
      const add = await this.saveImport({ listings: data.listings || [], requests: data.requests || [], newHashes: [] });
      const rows = [];
      for (const s of data.seen || []) for (const h of s.hashes) rows.push({ hash: h, day: s.day });
      if (rows.length) await putMany('seen', rows);
      if (data.users) await putMany('users', data.users.filter((u) => u.role === 'editor' || u.role === 'viewer'));
      return add;
    },
    async deleteDays(beforeDay) {
      let removed = 0;
      const db = await dbP;
      for (const s of ['L', 'R', 'seen']) {
        const rows = await all(s);
        const tx = db.transaction(s, 'readwrite');
        for (const x of rows) if ((x.day || '') < beforeDay) { tx.objectStore(s).delete(x.id ?? x.hash); if (s !== 'seen') removed++; }
        await done(tx);
      }
      return removed;
    },
    async clearAll() {
      const db = await dbP;
      for (const s of ['L', 'R', 'seen']) { const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).clear(); await done(tx); }
    },
    listUsers: async () => (await all('users')).sort((a, b) => a.email.localeCompare(b.email)),
    setUser: (email, role) => putMany('users', [{ email: email.toLowerCase().trim(), role, addedAt: new Date().toISOString() }]),
    async removeUser(email) { const tx = (await dbP).transaction('users', 'readwrite'); tx.objectStore('users').delete(email); await done(tx); },
    async getMeta(id) { return (await reqP((await dbP).transaction('meta').objectStore('meta').get(id))) || null; },
    async setMeta(id, data) {
      const tx = (await dbP).transaction('meta', 'readwrite');
      const os = tx.objectStore('meta');
      const cur = (await reqP(os.get(id))) || { id };
      os.put({ ...cur, ...data, id });
      await done(tx);
    },
  };
}
