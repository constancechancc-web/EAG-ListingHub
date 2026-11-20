-- Visitor links 访客链接: the Admin can open the hub for a while to anyone who has a link.
-- A visitor gets exactly what a Viewer (agent) can read: listings, WTB/WTR requests and a few settings. Nothing else.
-- The link carries a long random key; the browser sends it in the "x-guest-key" header and the database checks it on
-- every read. A link stops working when it expires or when the Admin turns it off.

create table if not exists public.guest_links (
  token      text primary key check (length(token) >= 32),
  label      text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
alter table public.guest_links enable row level security;
revoke all on public.guest_links from anon;
grant select, insert, update on public.guest_links to authenticated;

drop policy if exists "guest links read"   on public.guest_links;
drop policy if exists "guest links add"    on public.guest_links;
drop policy if exists "guest links change" on public.guest_links;
create policy "guest links read"   on public.guest_links for select to authenticated using ((select public.app_role()) = 'admin');
create policy "guest links add"    on public.guest_links for insert to authenticated
  with check ((select public.app_role()) = 'admin' and expires_at <= now() + interval '31 days' and revoked_at is null);
create policy "guest links change" on public.guest_links for update to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin' and expires_at <= now() + interval '31 days');

-- the key the visitor's browser sent ('' if none)
create or replace function public.guest_key() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-guest-key', '')
$$;

-- is that key a live link?
create or replace function public.guest_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guest_links g
    where g.token = public.guest_key() and g.revoked_at is null and g.expires_at > now()
  )
$$;

-- for the visitor's screen: when does my link end? (null = expired / turned off / unknown)
create or replace function public.guest_check() returns timestamptz
language sql stable security definer set search_path = public as $$
  select g.expires_at from public.guest_links g
  where g.token = public.guest_key() and g.revoked_at is null and g.expires_at > now()
$$;

revoke all on function public.guest_key()   from public;
revoke all on function public.guest_ok()    from public;
revoke all on function public.guest_check() from public;
grant execute on function public.guest_key(), public.guest_ok(), public.guest_check() to anon, authenticated;

-- visitors (not signed in = "anon") may READ what a Viewer reads, only while their link is live
grant select on public.listings, public.requests, public.meta to anon;
drop policy if exists "listings guest read" on public.listings;
drop policy if exists "requests guest read" on public.requests;
drop policy if exists "meta guest read"     on public.meta;
create policy "listings guest read" on public.listings for select to anon using ((select public.guest_ok()));
create policy "requests guest read" on public.requests for select to anon using ((select public.guest_ok()));
create policy "meta guest read"     on public.meta     for select to anon
  using ((select public.guest_ok()) and id in ('branding', 'groupSources', 'lastImport'));

-- visitors load the whole list in pages like signed-in users do; the default 3 s limit for anon is too short
-- (run on Supabase only; the test database has no such setting to change)
-- alter role anon set statement_timeout = '30s'; notify pgrst, 'reload config';
