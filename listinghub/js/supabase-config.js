// ─────────────────────────────────────────────────────────────────────────────
// Supabase settings (Supabase → Project Settings → API / Data API).
// SUPABASE_ANON_KEY is the PUBLIC "anon" / "publishable" key — it is safe in the browser,
// because every table is protected by Row Level Security (supabase/schema.sql).
// NEVER put the service_role / secret key here.
// Leave SUPABASE_URL empty to run "Local test mode" on localhost (data stays in this browser).
// ─────────────────────────────────────────────────────────────────────────────
export const SUPABASE_URL = 'https://nmdsxbexodgljmuhewbo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_vsZRLs5HfSLP8qzTxHxH1A_37fp4l41'; // public "publishable" key

// The one and only Admin. Must match the OWNER email in supabase/schema.sql.
export const OWNER_EMAIL = 'constancechan.cc@gmail.com';

// Server endpoint for optional AI help during import (AI key lives on the server only).
export const AI_ENDPOINT = '/api/listinghub/ai-classify';
