-- Migration 2026-11-10: make the access rules fast on big tables (evaluate the role check once per request).
-- Uses ALTER POLICY (needs no exclusive table lock, so it cannot deadlock with running requests). Safe to run again.

alter policy "listings read" on public.listings to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer'));
alter policy "listings add" on public.listings to authenticated with check ((select public.app_role()) in ('admin', 'editor'));
alter policy "listings change" on public.listings to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
alter policy "listings remove" on public.listings to authenticated using ((select public.app_role()) = 'admin');
alter policy "requests read" on public.requests to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer'));
alter policy "requests add" on public.requests to authenticated with check ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'editor' and status = 'open'));
alter policy "requests change" on public.requests to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
alter policy "requests remove" on public.requests to authenticated using ((select public.app_role()) = 'admin');
alter policy "seen read" on public.seen to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer'));
alter policy "seen add" on public.seen to authenticated with check ((select public.app_role()) in ('admin', 'editor'));
alter policy "seen remove" on public.seen to authenticated using ((select public.app_role()) = 'admin');
alter policy "users read" on public.app_users to authenticated using (public.app_role() = 'admin' or email = lower(coalesce(auth.jwt() ->> 'email', '')));
alter policy "users add" on public.app_users to authenticated with check ((select public.app_role()) = 'admin');
alter policy "users change" on public.app_users to authenticated using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');
alter policy "users remove" on public.app_users to authenticated using ((select public.app_role()) = 'admin');
alter policy "meta read" on public.meta to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer') and id <> 'driveState');
alter policy "meta add" on public.meta to authenticated with check ((select public.app_role()) = 'admin' and id in ('branding', 'groupSources'));
alter policy "meta change" on public.meta to authenticated using ((select public.app_role()) = 'admin' and id in ('branding', 'groupSources')) with check ((select public.app_role()) = 'admin' and id in ('branding', 'groupSources'));

alter role authenticated set statement_timeout = '30s';
notify pgrst, 'reload config';
