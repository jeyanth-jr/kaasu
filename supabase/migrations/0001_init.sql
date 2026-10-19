-- Kaasu cloud storage: one row per record, per user, protected by row-level security.
--
-- The app is local-first (IndexedDB). This table is the durable, multi-device
-- copy. Rows are generic JSON documents keyed by (user, collection, id) so the
-- app's schema can evolve without migrations; `seq` gives every change a
-- strictly increasing number the clients use as a sync cursor (no clock skew).

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection text        not null check (collection ~ '^[a-zA-Z][a-zA-Z0-9]{0,31}$'),
  id         text        not null check (char_length(id) between 1 and 200),
  data       jsonb,
  deleted    boolean     not null default false,
  seq        bigint      not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id),
  -- A live row carries data; a tombstone does not. Caps a single record at 256 KB.
  constraint records_shape check (
    (deleted and data is null) or (not deleted and data is not null and pg_column_size(data) <= 262144)
  )
);

create sequence if not exists public.records_seq;

-- Assigned by the database, never by the client.
create or replace function public.records_touch() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.seq := nextval('public.records_seq');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
  before insert or update on public.records
  for each row execute function public.records_touch();

-- Pull = "everything for me after cursor N, oldest first".
create index if not exists records_user_seq_idx on public.records (user_id, seq);

alter table public.records enable row level security;
alter table public.records force row level security;

drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
drop policy if exists records_delete on public.records;

create policy records_select on public.records
  for select to authenticated using (user_id = (select auth.uid()));
create policy records_insert on public.records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy records_update on public.records
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy records_delete on public.records
  for delete to authenticated using (user_id = (select auth.uid()));

-- Never reachable without signing in.
revoke all on public.records from anon, public;
grant select, insert, update, delete on public.records to authenticated;
revoke all on sequence public.records_seq from anon, authenticated, public;

-- "Delete my account": removes the login and, via cascade, every record.
create or replace function public.delete_my_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
