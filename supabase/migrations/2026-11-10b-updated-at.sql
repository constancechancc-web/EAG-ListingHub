-- Migration 2026-11-10b: "last changed" time per row, so each browser can keep its own copy of the list and
-- only ask for what changed. Safe to run again.
set lock_timeout = '10s';
alter table public.listings add column if not exists updated_at timestamptz not null default now();
alter table public.requests add column if not exists updated_at timestamptz not null default now();
create index if not exists listings_updated_idx on public.listings (updated_at, id);
create index if not exists requests_updated_idx on public.requests (updated_at, id);

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
        set day = excluded.day, posted_at = excluded.posted_at, data = excluded.data, updated_at = now()
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
        set day = excluded.day, posted_at = excluded.posted_at, data = excluded.data, updated_at = now()   -- status (open/closed) is kept
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
notify pgrst, 'reload schema';
