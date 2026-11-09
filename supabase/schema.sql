-- ════════════════════════════════════════════════════════════════════════════
-- EAG Listing Hub — Postgres schema for Supabase.
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to run again.
--
-- Roles are enforced HERE by Row Level Security, not by hiding buttons:
--   admin  = OWNER email only (exactly one person) — full control
--   editor = app_users.role = 'editor' — can ADD listings/requests; cannot update, delete or manage users
--   viewer = app_users.role = 'viewer' — read only
--   anyone else (even signed in with Google) — sees nothing
-- ════════════════════════════════════════════════════════════════════════════

-- ── tables ──────────────────────────────────────────────────────────────────
create table if not exists public.app_users (
  email     text primary key check (email = lower(email)),
  role      text not null check (role in ('editor', 'viewer')),   -- 'admin' can never be granted
  added_at  timestamptz not null default now()
);

create table if not exists public.listings (
  id         text primary key,            -- message hash (de-duplication key)
  day        text not null,               -- YYYY-MM-DD (Malaysia time) the message was posted
  posted_at  timestamptz,
  data       jsonb not null,              -- full parsed listing incl. original message
  created_at timestamptz not null default now()
);
create index if not exists listings_day_idx on public.listings (day);

create table if not exists public.requests (
  id         text primary key,
  day        text not null,
  posted_at  timestamptz,
  status     text not null default 'open' check (status in ('open', 'closed')),
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists requests_day_idx on public.requests (day);

-- every message hash ever imported, so importing the same chat twice adds nothing
create table if not exists public.seen (
  hash text primary key,
  day  text not null
);
create index if not exists seen_day_idx on public.seen (day);

-- importLog (scheduled import results), branding (logo), driveState (server only)
create table if not exists public.meta (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── who is calling? ─────────────────────────────────────────────────────────
-- Google sign-in only; e-mail/password accounts never get a role.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(auth.jwt() ->> 'email', '') = '' then 'none'
    when not (
      coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
      or coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
    ) then 'none'
    when lower(auth.jwt() ->> 'email') = 'constancechan.cc@gmail.com' then 'admin'   -- ← OWNER email
    else coalesce((select u.role from public.app_users u where u.email = lower(auth.jwt() ->> 'email')), 'none')
  end
$$;
revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;

-- ── row level security ──────────────────────────────────────────────────────
alter table public.app_users enable row level security;
alter table public.listings  enable row level security;
alter table public.requests  enable row level security;
alter table public.seen      enable row level security;
alter table public.meta      enable row level security;

-- nobody who is not signed in gets anything
revoke all on public.app_users, public.listings, public.requests, public.seen, public.meta from anon;
grant select, insert, update, delete on public.app_users, public.listings, public.requests, public.seen, public.meta to authenticated;

drop policy if exists "listings read"   on public.listings;
drop policy if exists "listings add"    on public.listings;
drop policy if exists "listings change" on public.listings;
drop policy if exists "listings remove" on public.listings;
create policy "listings read"   on public.listings for select to authenticated using (public.app_role() in ('admin', 'editor', 'viewer'));
create policy "listings add"    on public.listings for insert to authenticated with check (public.app_role() in ('admin', 'editor'));
create policy "listings change" on public.listings for update to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "listings remove" on public.listings for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists "requests read"   on public.requests;
drop policy if exists "requests add"    on public.requests;
drop policy if exists "requests change" on public.requests;
drop policy if exists "requests remove" on public.requests;
create policy "requests read"   on public.requests for select to authenticated using (public.app_role() in ('admin', 'editor', 'viewer'));
create policy "requests add"    on public.requests for insert to authenticated with check (public.app_role() = 'admin' or (public.app_role() = 'editor' and status = 'open'));
create policy "requests change" on public.requests for update to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "requests remove" on public.requests for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists "seen read"   on public.seen;
drop policy if exists "seen add"    on public.seen;
drop policy if exists "seen remove" on public.seen;
create policy "seen read"   on public.seen for select to authenticated using (public.app_role() in ('admin', 'editor', 'viewer'));
create policy "seen add"    on public.seen for insert to authenticated with check (public.app_role() in ('admin', 'editor'));
create policy "seen remove" on public.seen for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists "users read"   on public.app_users;
drop policy if exists "users add"    on public.app_users;
drop policy if exists "users change" on public.app_users;
drop policy if exists "users remove" on public.app_users;
create policy "users read"   on public.app_users for select to authenticated
  using (public.app_role() = 'admin' or email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "users add"    on public.app_users for insert to authenticated with check (public.app_role() = 'admin');
create policy "users change" on public.app_users for update to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "users remove" on public.app_users for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists "meta read"  on public.meta;
drop policy if exists "meta add"   on public.meta;
drop policy if exists "meta change" on public.meta;
create policy "meta read"   on public.meta for select to authenticated using (public.app_role() in ('admin', 'editor', 'viewer') and id <> 'driveState');
create policy "meta add"    on public.meta for insert to authenticated with check (public.app_role() = 'admin' and id = 'branding');
create policy "meta change" on public.meta for update to authenticated using (public.app_role() = 'admin' and id = 'branding') with check (public.app_role() = 'admin' and id = 'branding');
