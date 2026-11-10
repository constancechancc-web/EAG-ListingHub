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

-- importLog (scheduled import results), branding (logo), groupSources (admin's group → source overrides), driveState (server only)
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
-- the scheduled import (server only) uses the service_role key, which bypasses RLS but still needs table privileges
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.app_users, public.listings, public.requests, public.seen, public.meta to service_role;
  end if;
end $$;

drop policy if exists "listings read"   on public.listings;
drop policy if exists "listings add"    on public.listings;
drop policy if exists "listings change" on public.listings;
drop policy if exists "listings remove" on public.listings;
create policy "listings read"   on public.listings for select to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer'));
create policy "listings add"    on public.listings for insert to authenticated with check ((select public.app_role()) in ('admin', 'editor'));
create policy "listings change" on public.listings for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
create policy "listings remove" on public.listings for delete to authenticated using ((select public.app_role()) = 'admin');

drop policy if exists "requests read"   on public.requests;
drop policy if exists "requests add"    on public.requests;
drop policy if exists "requests change" on public.requests;
drop policy if exists "requests remove" on public.requests;
create policy "requests read"   on public.requests for select to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer'));
create policy "requests add"    on public.requests for insert to authenticated with check ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'editor' and status = 'open'));
create policy "requests change" on public.requests for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
create policy "requests remove" on public.requests for delete to authenticated using ((select public.app_role()) = 'admin');

drop policy if exists "seen read"   on public.seen;
drop policy if exists "seen add"    on public.seen;
drop policy if exists "seen remove" on public.seen;
create policy "seen read"   on public.seen for select to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer'));
create policy "seen add"    on public.seen for insert to authenticated with check ((select public.app_role()) in ('admin', 'editor'));
create policy "seen remove" on public.seen for delete to authenticated using ((select public.app_role()) = 'admin');

drop policy if exists "users read"   on public.app_users;
drop policy if exists "users add"    on public.app_users;
drop policy if exists "users change" on public.app_users;
drop policy if exists "users remove" on public.app_users;
create policy "users read"   on public.app_users for select to authenticated
  using (public.app_role() = 'admin' or email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "users add"    on public.app_users for insert to authenticated with check ((select public.app_role()) = 'admin');
create policy "users change" on public.app_users for update to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
create policy "users remove" on public.app_users for delete to authenticated using ((select public.app_role()) = 'admin');

drop policy if exists "meta read"  on public.meta;
drop policy if exists "meta add"   on public.meta;
drop policy if exists "meta change" on public.meta;
create policy "meta read"   on public.meta for select to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer') and id <> 'driveState');
create policy "meta add"    on public.meta for insert to authenticated with check ((select public.app_role()) = 'admin' and id in ('branding', 'groupSources'));
create policy "meta change" on public.meta for update to authenticated using ((select public.app_role()) = 'admin' and id in ('branding', 'groupSources')) with check ((select public.app_role()) = 'admin' and id in ('branding', 'groupSources'));

-- ── import: new items are added; a RE-POST (same id) only replaces the old copy when it is NEWER ──
-- Editors may only import through this function (they still cannot update or delete rows directly).
-- It also records the time of the last import for the "Updated" tile.
create or replace function public.import_items(p_table text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_added int := 0;
  n_bumped int := 0;
begin
  if not (public.app_role() in ('admin', 'editor') or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_table = 'listings' then
    with incoming as (
      select distinct on (x.id) x.id, x.day, x.posted_at, x.data
      from jsonb_to_recordset(p_rows) as x(id text, day text, posted_at timestamptz, data jsonb)
      order by x.id, x.posted_at desc
    ), up as (
      insert into public.listings as t (id, day, posted_at, data)
      select id, day, posted_at, data from incoming
      on conflict (id) do update
        set day = excluded.day, posted_at = excluded.posted_at, data = excluded.data
        where excluded.posted_at > coalesce(t.posted_at, '-infinity'::timestamptz)
      returning (xmax = 0) as inserted
    )
    select count(*) filter (where inserted), count(*) filter (where not inserted) into n_added, n_bumped from up;

  elsif p_table = 'requests' then
    with incoming as (
      select distinct on (x.id) x.id, x.day, x.posted_at, x.data
      from jsonb_to_recordset(p_rows) as x(id text, day text, posted_at timestamptz, data jsonb)
      order by x.id, x.posted_at desc
    ), up as (
      insert into public.requests as t (id, day, posted_at, data)
      select id, day, posted_at, data from incoming
      on conflict (id) do update
        set day = excluded.day, posted_at = excluded.posted_at, data = excluded.data   -- status (open/closed) is kept
        where excluded.posted_at > coalesce(t.posted_at, '-infinity'::timestamptz)
      returning (xmax = 0) as inserted
    )
    select count(*) filter (where inserted), count(*) filter (where not inserted) into n_added, n_bumped from up;

  else
    raise exception 'unknown table %', p_table;
  end if;

  if n_added + n_bumped > 0 then
    insert into public.meta (id, data, updated_at) values ('lastImport', jsonb_build_object('at', now()), now())
    on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('added', n_added, 'bumped', n_bumped);
end
$$;
revoke all on function public.import_items(text, jsonb) from public, anon;
grant execute on function public.import_items(text, jsonb) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.import_items(text, jsonb) to service_role;
  end if;
end $$;

-- ── speed ───────────────────────────────────────────────────────────────────
-- The policies above call (select public.app_role()) so Postgres evaluates the role ONCE per request
-- (a bare function call in a policy is evaluated for every row: 16,000 rows took 20 s and hit the 8 s limit).
-- A longer limit is a safety net for the big first load.
alter role authenticated set statement_timeout = '30s';
notify pgrst, 'reload config';
