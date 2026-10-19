-- Per-user record cap: abuse protection for a multi-tenant service.
--
-- One account can't fill the database (or run up the bill) by writing unlimited rows. The cap is a
-- database setting so the operator can change it without a deploy:
--     alter database postgres set app.max_records_per_user = '250000';
-- (applies to new connections). The default is 250,000 records, far beyond normal personal use.
-- Usage is kept in a counter table maintained by triggers, so enforcing the cap costs O(1) per row.

create table if not exists public.record_usage (
  user_id uuid   primary key references auth.users (id) on delete cascade,
  n       bigint not null default 0 check (n >= 0)
);

alter table public.record_usage enable row level security;
alter table public.record_usage force row level security;

drop policy if exists usage_select on public.record_usage;
create policy usage_select on public.record_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- Read-only for users; only the trigger below (security definer) writes.
revoke all on public.record_usage from anon, public;
grant select on public.record_usage to authenticated;

-- Count rows already stored.
insert into public.record_usage (user_id, n)
  select user_id, count(*) from public.records group by user_id
  on conflict (user_id) do update set n = excluded.n;

create or replace function public.records_quota() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap  bigint := coalesce(nullif(current_setting('app.max_records_per_user', true), '')::bigint, 250000);
  used bigint;
begin
  if tg_op = 'INSERT' then
    insert into public.record_usage as u (user_id, n) values (new.user_id, 1)
      on conflict (user_id) do update set n = u.n + 1
      returning u.n into used;
    if used > cap then
      raise exception 'record limit reached (% records)', cap using errcode = '53400';
    end if;
    return new;
  end if;
  update public.record_usage set n = greatest(0, n - 1) where user_id = old.user_id;
  return old;
end;
$$;

-- AFTER triggers fire only for rows really inserted/deleted, so an upsert that updates an
-- existing row (the normal sync case) is not counted twice.
drop trigger if exists records_quota_ins on public.records;
create trigger records_quota_ins after insert on public.records for each row execute function public.records_quota();

drop trigger if exists records_quota_del on public.records;
create trigger records_quota_del after delete on public.records for each row execute function public.records_quota();
