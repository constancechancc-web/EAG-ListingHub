-- Less download (Supabase "egress"):
-- 1) deleted_rows: every deleted listing / request leaves a small note (id only), so devices can drop it from their
--    saved copy instead of downloading the whole list again. Notes older than 45 days are removed automatically.
-- 2) listings_lite: the listing list WITHOUT the original WhatsApp text (about 40% of the size). The text is fetched
--    only when someone opens or copies it. Same read rules as the listings table (security_invoker).

create table if not exists public.deleted_rows (
  seq        bigserial primary key,
  tbl        text not null,
  row_id     text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_rows_at on public.deleted_rows (deleted_at);
alter table public.deleted_rows enable row level security;
grant select on public.deleted_rows to authenticated, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, delete on public.deleted_rows to service_role;
    grant usage on sequence public.deleted_rows_seq_seq to service_role;
  end if;
end $$;
drop policy if exists "deleted rows read"       on public.deleted_rows;
drop policy if exists "deleted rows guest read" on public.deleted_rows;
create policy "deleted rows read"       on public.deleted_rows for select to authenticated using ((select public.app_role()) in ('admin', 'editor', 'viewer'));
create policy "deleted rows guest read" on public.deleted_rows for select to anon using ((select public.guest_ok()));

create or replace function public.note_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.deleted_rows (tbl, row_id) select tg_table_name, g.id from gone g;
  delete from public.deleted_rows where deleted_at < now() - interval '45 days';
  return null;
end $$;
revoke all on function public.note_deleted() from public;

drop trigger if exists listings_note_deleted on public.listings;
drop trigger if exists requests_note_deleted on public.requests;
create trigger listings_note_deleted after delete on public.listings referencing old table as gone for each statement execute function public.note_deleted();
create trigger requests_note_deleted after delete on public.requests referencing old table as gone for each statement execute function public.note_deleted();

create or replace view public.listings_lite with (security_invoker = true) as
  select id, day, posted_at, updated_at, data - 'raw' as data from public.listings;
grant select on public.listings_lite to authenticated, anon;
