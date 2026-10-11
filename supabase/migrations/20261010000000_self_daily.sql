-- Owner-only daily summaries from the local self-data hub (research-agents: python -m selfdata).
--
-- Personal health-adjacent data: owner read AND write, nobody else, never anon. The row holds coarse per-dimension summaries only:
-- a 0..1 position against the owner's own usual, a trend, how many days back it, and lab FLAG counts. No raw lab values or names,
-- no medications or conditions, no wearable readings, no free text. The full data stays encrypted on the owner's own computer.

create table if not exists public.self_daily (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  day        date not null,
  dims       jsonb not null check (jsonb_typeof(dims) = 'array' and jsonb_array_length(dims) <= 16 and pg_column_size(dims) < 4000),
  lab_flags  jsonb not null default '{}'::jsonb check (jsonb_typeof(lab_flags) = 'object' and pg_column_size(lab_flags) < 500),
  synthetic  boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.self_daily enable row level security;
drop policy if exists "owner read" on public.self_daily;
drop policy if exists "owner insert" on public.self_daily;
drop policy if exists "owner update" on public.self_daily;
drop policy if exists "owner delete" on public.self_daily;
create policy "owner read" on public.self_daily for select to authenticated using (user_id = (select auth.uid()) and (select public.is_owner()));
create policy "owner insert" on public.self_daily for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_owner()));
create policy "owner update" on public.self_daily for update to authenticated using (user_id = (select auth.uid()) and (select public.is_owner())) with check (user_id = (select auth.uid()) and (select public.is_owner()));
create policy "owner delete" on public.self_daily for delete to authenticated using (user_id = (select auth.uid()) and (select public.is_owner()));
revoke all on public.self_daily from anon;
