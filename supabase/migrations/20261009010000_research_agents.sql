-- Research-agent tables. Written only by the ingest Worker (service-role key,
-- which bypasses RLS); read by signed-in dashboard users.
-- Corpus embeddings live in Cloudflare Vectorize, keyed by research_records.id.

create table public.agents (
  node_id      text primary key,
  kind         text not null,           -- e.g. 'research', 'ai_participant', 'network_node'
  twin_id      uuid references public.twin_identity (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);
create index agents_twin_id_idx on public.agents (twin_id);

create table public.research_topics (
  id              bigint generated always as identity primary key,
  topic           text not null,
  biomarker       text,
  parent_topic_id bigint references public.research_topics (id) on delete set null,
  status          text not null default 'queued'
                  check (status in ('queued', 'explored', 'dropped')),
  discovered_by   text references public.agents (node_id) on delete set null,
  created_at      timestamptz not null default now(),
  explored_at     timestamptz,
  unique (topic, biomarker)
);
create index research_topics_parent_idx on public.research_topics (parent_topic_id);
create index research_topics_discovered_by_idx on public.research_topics (discovered_by);

create table public.research_runs (
  id            bigint generated always as identity primary key,
  agent_id      text not null references public.agents (node_id) on delete cascade,
  twin_id       uuid references public.twin_identity (id) on delete set null,
  topic_id      bigint references public.research_topics (id) on delete set null,
  cycle         integer not null,
  new_ids_found integer not null default 0,
  summary       text,
  started_at    timestamptz not null default now(),
  unique (agent_id, cycle)
);
create index research_runs_topic_idx on public.research_runs (topic_id);
create index research_runs_twin_idx on public.research_runs (twin_id);

-- id is the agents' own dedupe key, e.g. 'article:42566532', 'trial:NCT06760507'.
create table public.research_records (
  id            text primary key,
  source        text not null,          -- pubmed | trial | stjude | fda | ...
  title         text not null,
  url           text,
  topic_id      bigint references public.research_topics (id) on delete set null,
  run_id        bigint references public.research_runs (id) on delete set null,
  first_seen_at timestamptz not null default now()
);
create index research_records_topic_idx on public.research_records (topic_id);
create index research_records_run_idx on public.research_records (run_id);
create index research_records_source_idx on public.research_records (source);

create table public.chain_blocks (
  block_id   text primary key,
  node_id    text not null references public.agents (node_id) on delete cascade,
  source     text not null,
  das_score  numeric not null,
  hash       text not null,
  prev_hash  text,
  mined_at   timestamptz not null default now()
);
create index chain_blocks_node_idx on public.chain_blocks (node_id, mined_at desc);

create table public.node_scores (
  id       bigint generated always as identity primary key,
  node_id  text not null references public.agents (node_id) on delete cascade,
  mos      numeric,                     -- 1.0 - 5.0
  balance  numeric,                     -- internal contribution score, not a currency
  ts       timestamptz not null default now()
);
create index node_scores_node_idx on public.node_scores (node_id, ts desc);

-- Mirrors audit_trail.py: hash-chained, append-only.
create table public.audit_entries (
  seq        bigint primary key,
  module     text not null,
  action     text not null,
  details    jsonb not null default '{}',
  node_id    text references public.agents (node_id) on delete set null,
  prev_hash  text,
  hash       text not null unique,
  ts         timestamptz not null default now()
);
create index audit_entries_node_idx on public.audit_entries (node_id);

create function public.audit_entries_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_entries is append-only';
end $$;

create trigger audit_entries_no_change
  before update or delete on public.audit_entries
  for each row execute function public.audit_entries_immutable();

create table public.assets (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('chart', 'video', 'corpus', 'other')),
  r2_key     text not null unique,      -- object key in the R2 bucket
  sha256     text not null,
  run_id     bigint references public.research_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index assets_run_idx on public.assets (run_id);

-- Link existing XRPL anchors to what they anchor.
alter table public.xrpl_memo_anchors
  add column if not exists audit_seq bigint references public.audit_entries (seq) on delete set null,
  add column if not exists block_id  text references public.chain_blocks (block_id) on delete set null;
create index if not exists xrpl_memo_anchors_audit_idx on public.xrpl_memo_anchors (audit_seq);
create index if not exists xrpl_memo_anchors_block_idx on public.xrpl_memo_anchors (block_id);

-- RLS: signed-in users read; no write policies, so only the service role writes.
do $$
declare t text;
begin
  foreach t in array array[
    'agents','research_topics','research_runs','research_records',
    'chain_blocks','node_scores','audit_entries','assets'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "authenticated read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;
