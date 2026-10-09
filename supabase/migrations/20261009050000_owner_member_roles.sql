-- Owner vs member access, so the console can be opened to public sign-up.
--
--   owner  = you. Sees everything, exactly as today.
--   member = any other signed-in account (the default for a new sign-up). Reads the public research
--            tables only; never the twin's biometrics, mesh data, chains, or audit trail.
--
-- Safe to run before sign-up is opened: it only tightens access, and the seeded owner keeps full access.
-- Run it, then test with a member account, THEN enable sign-ups in Supabase Auth.

-- 1. Who is an owner. RLS on, no policies: only service role and is_owner() can read it.
create table if not exists public.owners (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.owners o where o.user_id = (select auth.uid()))
$$;
revoke execute on function public.is_owner() from anon, public;
grant execute on function public.is_owner() to authenticated, service_role;

insert into public.owners (user_id)
select id from auth.users where lower(email) = 'ringquistchase@gmail.com'
on conflict do nothing;

-- 2. Sensitive tables: owner only (replaces the "any signed-in user can read" policies).
do $$
declare t text;
begin
  foreach t in array array[
    'twin_identity', 'convergence_tokens', 'sdr_node_profiles', 'mesh_node_readings',
    'xrpl_memo_anchors', 'bci_ledger', 'rabbit_network_latencies',
    'agents', 'chain_blocks', 'node_scores', 'audit_entries', 'assets'
  ] loop
    execute format('drop policy if exists "authenticated read" on public.%I', t);
    execute format('drop policy if exists "owner read" on public.%I', t);
    execute format('create policy "owner read" on public.%I for select to authenticated using ((select public.is_owner()))', t);
  end loop;
end $$;
-- Unchanged on purpose: research_topics, research_runs, research_records, research_summaries keep
-- "authenticated read" (members may read public literature metadata); eeg_token_vocab stays public.

-- 3. Signed-in users become read-only. Every write in the app goes through the service role
--    (signed ingest, server actions), so nothing legitimate needs INSERT/UPDATE/DELETE as a user.
--    This closes tables whose policies let a user write "their own rows" (sensors, spectrum_*, ...).
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from authenticated;

-- 4. Privileged (security definer) functions must not be callable by members.
revoke execute on function public.build_convergence_token(uuid, uuid, real, real, real, real) from authenticated;
revoke execute on function public.close_gateway_session(uuid) from authenticated;
revoke execute on function public.close_spectrum_session(uuid) from authenticated;
revoke execute on function public.get_mask_ratio(uuid) from authenticated;
revoke execute on function public.increment_session_count(uuid) from authenticated;
revoke execute on function public.open_gateway_session(uuid, transport_medium, text, text) from authenticated;
revoke execute on function public.record_chemo_hash(uuid, jsonb, text, text, text, text, uuid, text, uuid) from authenticated;
revoke execute on function public.rls_auto_enable() from authenticated;

-- 5. Attribute AI summaries to whoever asked for them (for per-user limits later).
alter table public.research_summaries
  add column if not exists created_by uuid references auth.users (id) on delete set null;
create index if not exists research_summaries_created_by_idx on public.research_summaries (created_by);
