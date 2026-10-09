-- Agent task queue: people ask for research, agents claim and run it, an owner approves what enters the corpus.
--
--   queued -> claimed -> proposed -> approved | rejected      (or failed)
--
-- Agents never write research records directly from a task: they attach a PROPOSAL (result) and an owner approves it.
-- Members read their own tasks, the owner reads all; every write goes through the service role (server actions and the
-- signed agent endpoint).

create table if not exists public.agent_tasks (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('research_topic', 'crispr_guides', 'brain_search')),
  params       jsonb not null default '{}'::jsonb,
  status       text not null default 'queued' check (status in ('queued', 'claimed', 'proposed', 'approved', 'rejected', 'failed')),
  claimed_by   text references public.agents (node_id) on delete set null,
  claimed_at   timestamptz,
  lease_until  timestamptz,
  result       jsonb,                                   -- the proposal: { summary, records: [...] }
  error        text check (char_length(error) <= 500),
  reviewed_by  uuid references auth.users (id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text check (char_length(review_note) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists agent_tasks_status_idx on public.agent_tasks (status, created_at);
create index if not exists agent_tasks_owner_idx on public.agent_tasks (created_by, created_at desc);

alter table public.agent_tasks enable row level security;
drop policy if exists "own tasks read" on public.agent_tasks;
create policy "own tasks read" on public.agent_tasks for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_owner()));
revoke all on public.agent_tasks from anon;
revoke insert, update, delete, truncate on public.agent_tasks from authenticated;

-- Atomically hand the oldest runnable task to an agent. A claimed task whose lease ran out is runnable again.
create or replace function public.claim_agent_task(p_agent text, p_lease_seconds integer default 600)
returns setof public.agent_tasks
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.agent_tasks t
     set status = 'claimed', claimed_by = p_agent, claimed_at = now(), updated_at = now(),
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600)))
   where t.id = (
     select id from public.agent_tasks
      where status = 'queued' or (status = 'claimed' and lease_until < now())
      order by created_at
      for update skip locked
      limit 1)
  returning t.*;
end $$;
revoke execute on function public.claim_agent_task(text, integer) from anon, authenticated, public;
grant execute on function public.claim_agent_task(text, integer) to service_role;
