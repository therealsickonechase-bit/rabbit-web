-- RabbitOS: all pending database changes, in order. Safe to run more than once.
-- Paste this whole file into the Supabase SQL editor and press Run.

-- =====================================================
-- 20261009080000_eeg_band_samples.sql
-- =====================================================
-- Live EEG band powers from a BrainFlow / OpenBCI bridge.
--
-- Neural data is among the most sensitive data there is: owner-only read, written only by the signed ingest
-- (service role). Only band powers per channel are stored, never raw waveforms.

create table if not exists public.eeg_band_samples (
  id         bigint generated always as identity primary key,
  agent_id   text not null references public.agents (node_id) on delete cascade,
  session    text not null check (char_length(session) between 1 and 64),
  ts         timestamptz not null,
  channel    text not null check (char_length(channel) between 1 and 16),
  band       text not null check (band in ('delta', 'theta', 'alpha', 'beta', 'gamma')),
  power      real not null check (power >= 0),          -- absolute band power (uV^2)
  rel_power  real check (rel_power between 0 and 1),    -- share of total 1-45 Hz power
  board      text not null default 'unknown',
  created_at timestamptz not null default now(),
  unique (agent_id, session, ts, channel, band)
);
create index if not exists eeg_band_samples_ts_idx on public.eeg_band_samples (ts desc);

alter table public.eeg_band_samples enable row level security;
drop policy if exists "owner read" on public.eeg_band_samples;
create policy "owner read" on public.eeg_band_samples for select to authenticated using ((select public.is_owner()));
revoke all on public.eeg_band_samples from anon;
revoke insert, update, delete, truncate on public.eeg_band_samples from authenticated;

-- Keep only 30 days of samples; run this occasionally (or schedule it) so the table stays small.
create or replace function public.purge_old_eeg_samples() returns integer
language sql security definer set search_path = '' as $$
  with gone as (delete from public.eeg_band_samples where ts < now() - interval '30 days' returning 1)
  select count(*)::integer from gone
$$;
revoke execute on function public.purge_old_eeg_samples() from anon, authenticated, public;
grant execute on function public.purge_old_eeg_samples() to service_role;


-- =====================================================
-- 20261009090000_agent_tasks.sql
-- =====================================================
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


-- =====================================================
-- 20261009100000_api_keys.sql
-- =====================================================
-- API keys for the RabbitOS MCP server / public API.
--
-- A key belongs to one person and acts as that person with a limited scope:
--   read     search the research, read records and CRISPR guides, check digests
--   propose  also file agent tasks (still approved by an owner before anything is added)
-- Only a SHA-256 hash of the key is stored; the key itself is shown once when created.
-- Owners read nothing here: each person sees only their own keys. Writes go through the service role.

create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  prefix      text not null,                                   -- first characters, to recognise a key in the list
  key_hash    text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes      text[] not null default '{read}' check (scopes <@ array['read', 'propose']),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '90 days'),
  last_used_at timestamptz,
  revoked_at  timestamptz
);
create index if not exists api_keys_user_idx on public.api_keys (user_id, created_at desc);

-- One row per call: rate limiting and a record of what each key did (tool name only, never arguments or results).
create table if not exists public.api_key_calls (
  id        bigint generated always as identity primary key,
  key_id    uuid not null references public.api_keys (id) on delete cascade,
  tool      text not null,
  ok        boolean not null default true,
  called_at timestamptz not null default now()
);
create index if not exists api_key_calls_key_time_idx on public.api_key_calls (key_id, called_at desc);

alter table public.api_keys enable row level security;
alter table public.api_key_calls enable row level security;
drop policy if exists "own keys read" on public.api_keys;
create policy "own keys read" on public.api_keys for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own key calls read" on public.api_key_calls;
create policy "own key calls read" on public.api_key_calls for select to authenticated
  using (exists (select 1 from public.api_keys k where k.id = key_id and k.user_id = (select auth.uid())));
revoke all on public.api_keys, public.api_key_calls from anon;
revoke insert, update, delete, truncate on public.api_keys, public.api_key_calls from authenticated;
-- key_hash must never be readable by the browser, even for your own keys.
revoke select on public.api_keys from authenticated;
grant select (id, user_id, name, prefix, scopes, created_at, expires_at, last_used_at, revoked_at) on public.api_keys to authenticated;


-- =====================================================
-- 20261009110000_merkle_batches.sql
-- =====================================================
-- Merkle batches over the audit trail.
--
-- The owner seals a batch of consecutive audit entries; the root of their Merkle tree is stored here. Only the root
-- (a 64-character hash) needs publishing, and a short proof shows any single audit entry belongs to it.
-- Roots are not secret, so any signed-in user may read them. Writes go through the service role only.
-- anchor_tx / anchor_ledger stay empty until a root is anchored on a public ledger.

create table if not exists public.merkle_batches (
  id            bigint generated always as identity primary key,
  from_seq      bigint not null,
  to_seq        bigint not null,
  leaf_count    integer not null check (leaf_count between 1 and 256),
  root          text not null check (root ~ '^[0-9a-f]{64}$'),
  sealed_by     uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  anchor_tx     text,
  anchor_ledger bigint,
  check (to_seq >= from_seq and leaf_count = to_seq - from_seq + 1),
  unique (from_seq, to_seq)
);

alter table public.merkle_batches enable row level security;
drop policy if exists "signed-in read" on public.merkle_batches;
create policy "signed-in read" on public.merkle_batches for select to authenticated using (true);
revoke all on public.merkle_batches from anon;
revoke insert, update, delete, truncate on public.merkle_batches from authenticated;


-- =====================================================
-- 20261009120000_semantic_memory.sql
-- =====================================================
-- Semantic memory (embeddings) and a persistent knowledge graph.
--
-- record_embeddings: one 768-number vector per research record, made by Cloudflare Workers AI (bge-base-en-v1.5).
--   "Find records that mean the same thing" instead of matching exact words.
-- kg_edges: pairs of terms (gene, chemical, EEG band, brain region) that stored records mention together,
--   with the record that says so. A co-mention is a pointer to papers, not a claim of cause.
-- Both are derived from public research records only; no personal data goes in either.

create extension if not exists vector with schema extensions;

create table if not exists public.record_embeddings (
  record_id   text primary key references public.research_records (id) on delete cascade,
  embedding   extensions.vector(768) not null,
  model       text not null,
  embedded_at timestamptz not null default now()
);
create index if not exists record_embeddings_hnsw on public.record_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.kg_edges (
  a_kind    text not null check (a_kind in ('chemical', 'band', 'region', 'gene')),
  a_name    text not null,
  b_kind    text not null check (b_kind in ('chemical', 'band', 'region', 'gene')),
  b_name    text not null,
  record_id text not null references public.research_records (id) on delete cascade,
  built_at  timestamptz not null default now(),
  primary key (a_kind, a_name, b_kind, b_name, record_id)
);
create index if not exists kg_edges_b_idx on public.kg_edges (b_kind, b_name);

alter table public.record_embeddings enable row level security;
alter table public.kg_edges enable row level security;
drop policy if exists "signed-in read" on public.kg_edges;
create policy "signed-in read" on public.kg_edges for select to authenticated using (true);
-- embeddings are only read through match_records() below
revoke all on public.record_embeddings, public.kg_edges from anon;
revoke all on public.record_embeddings from authenticated;
revoke insert, update, delete, truncate on public.kg_edges from authenticated;

-- Nearest records to a query vector, limited to the sources the app is allowed to show. Service role only.
create or replace function public.match_records(query_embedding extensions.vector(768), match_count integer default 10, only_sources text[] default null)
returns table (id text, source text, title text, url text, similarity double precision)
language sql stable security definer set search_path = '' as $$
  select r.id, r.source, r.title, r.url, 1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
    from public.record_embeddings e
    join public.research_records r on r.id = e.record_id
   where only_sources is null or r.source = any(only_sources)
   order by e.embedding operator(extensions.<=>) query_embedding
   limit greatest(1, least(match_count, 50))
$$;
revoke execute on function public.match_records(extensions.vector, integer, text[]) from anon, authenticated, public;
grant execute on function public.match_records(extensions.vector, integer, text[]) to service_role;


-- =====================================================
-- 20261009130000_guest_passes.sql
-- =====================================================
-- Guest passes: a link the owner issues that signs someone in for 3 days (from first use) with no password.
--
-- The guest is a real auth user with a throwaway address on guest.rabbitsoftware.io that never receives mail. The server
-- marks it as a guest in app_metadata (guest: true, guest_until) when the pass is first used, and the app sends guests only
-- to Research, the CRISPR Explorer and the Guide. Only a hash of the link token is stored.
-- Owner-only: guests and members cannot read this table; every write goes through the service role.

create table if not exists public.guest_passes (
  id              uuid primary key default gen_random_uuid(),
  label           text not null check (char_length(label) between 1 and 60),
  issued_to       text check (char_length(issued_to) <= 120),          -- who the owner gave it to (the owner's own record)
  user_id         uuid unique references auth.users (id) on delete set null,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  link_expires_at timestamptz not null default (now() + interval '14 days'),
  first_used_at   timestamptz,
  access_until    timestamptz,
  uses            integer not null default 0 check (uses >= 0),
  max_uses        integer not null default 5 check (max_uses between 1 and 20),
  revoked_at      timestamptz
);
create index if not exists guest_passes_created_idx on public.guest_passes (created_at desc);

alter table public.guest_passes enable row level security;
drop policy if exists "owner read" on public.guest_passes;
create policy "owner read" on public.guest_passes for select to authenticated using ((select public.is_owner()));
revoke all on public.guest_passes from anon;
revoke insert, update, delete, truncate on public.guest_passes from authenticated;
-- The token hash must never reach the browser: drop table-level SELECT, then grant every column except token_hash.
revoke select on public.guest_passes from authenticated;
grant select (id, label, issued_to, user_id, created_by, created_at, link_expires_at, first_used_at, access_until, uses, max_uses, revoked_at)
  on public.guest_passes to authenticated;

-- =====================================================
-- 20261010000000_self_daily.sql
-- =====================================================
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

-- =====================================================
-- 20261010010000_public_packages.sql
-- =====================================================
-- Public downloads: files the owner uploads from their computer that anyone on the internet may download.
--
-- Storage bucket "packages" is PUBLIC for reading (anyone can download a file if they have its link) and writable ONLY by the owner (is_owner()).
-- The list of packages is the table public.public_packages: readable by everyone (including signed-out visitors), writable only by the owner.
-- Nothing private belongs here: the app checks names, types, size and scans text files in the owner's browser before upload, but the owner decides what to publish.

insert into storage.buckets (id, name, public, file_size_limit)
values ('packages', 'packages', true, 52428800)       -- 50 MB per file
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "owner uploads packages" on storage.objects;
drop policy if exists "owner updates packages" on storage.objects;
drop policy if exists "owner deletes packages" on storage.objects;
create policy "owner uploads packages" on storage.objects for insert to authenticated with check (bucket_id = 'packages' and (select public.is_owner()));
create policy "owner updates packages" on storage.objects for update to authenticated using (bucket_id = 'packages' and (select public.is_owner())) with check (bucket_id = 'packages' and (select public.is_owner()));
create policy "owner deletes packages" on storage.objects for delete to authenticated using (bucket_id = 'packages' and (select public.is_owner()));
-- No select policy is needed for downloads: a public bucket serves files by link without one, and nobody can list the bucket through the API.

create table if not exists public.public_packages (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  licence     text not null check (char_length(licence) between 2 and 80),
  file_name   text not null check (char_length(file_name) between 1 and 120),
  path        text not null unique check (char_length(path) between 3 and 200),
  size_bytes  bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references auth.users (id) default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.public_packages enable row level security;
drop policy if exists "anyone reads packages" on public.public_packages;
drop policy if exists "owner adds packages" on public.public_packages;
drop policy if exists "owner removes packages" on public.public_packages;
create policy "anyone reads packages" on public.public_packages for select to anon, authenticated using (true);
create policy "owner adds packages" on public.public_packages for insert to authenticated with check (uploaded_by = (select auth.uid()) and (select public.is_owner()));
create policy "owner removes packages" on public.public_packages for delete to authenticated using ((select public.is_owner()));
revoke insert, update, delete, truncate on public.public_packages from anon;
revoke update, truncate on public.public_packages from authenticated;
