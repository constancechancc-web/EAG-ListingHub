-- Migration 2026-11-11: Editors may manage Viewers (add / change / remove) and see the Viewer list.
-- Editors still cannot create, change or remove Editors, and cannot create an Admin. Uses ALTER POLICY (no exclusive lock). Safe to run again.
alter policy "users read" on public.app_users to authenticated
  using ((select public.app_role()) = 'admin' or email = lower(coalesce(auth.jwt() ->> 'email', ''))
         or ((select public.app_role()) = 'editor' and role = 'viewer'));
alter policy "users add" on public.app_users to authenticated
  with check ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'editor' and role = 'viewer'));
alter policy "users change" on public.app_users to authenticated
  using ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'editor' and role = 'viewer'))
  with check ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'editor' and role = 'viewer'));
alter policy "users remove" on public.app_users to authenticated
  using ((select public.app_role()) = 'admin' or ((select public.app_role()) = 'editor' and role = 'viewer'));
