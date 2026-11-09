// Server-only Supabase client. Uses the SERVICE ROLE key from Vercel env vars — never shipped to browsers.
import { createClient } from '@supabase/supabase-js';

export const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'constancechan.cc@gmail.com').toLowerCase();

let client;
export function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

export const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

/** Verify the caller's Supabase access token; return { email, role } using the same rules as app_role(). */
export async function callerRole(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  const { data, error } = await db().auth.getUser(m[1]);
  if (error || !data.user || !data.user.email) return null;
  const u = data.user;
  const providers = u.app_metadata?.providers || [u.app_metadata?.provider];
  if (!providers.includes('google')) return null;
  const email = u.email.toLowerCase();
  if (email === OWNER_EMAIL) return { email, role: 'admin' };
  const rows = check(await db().from('app_users').select('role').eq('email', email).limit(1));
  return rows && rows[0] ? { email, role: rows[0].role } : null;
}

/** Google service account JSON (for reading the shared Drive folder). */
export function googleServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT is not set');
  return JSON.parse(raw);
}
