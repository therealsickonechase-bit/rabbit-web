-- Richer research records, AI summaries, and support for more than one chain.

-- Per-source details (journal, trial status, sponsor, dates, ...).
alter table public.research_records
  add column meta jsonb not null default '{}';

-- chain_blocks now holds several chains ('network' = the gossip chain, 'maxwell', ...).
-- Non-network chains have no DAS score, so it becomes optional.
alter table public.chain_blocks
  add column chain   text not null default 'network',
  add column height  integer,
  add column payload jsonb,
  alter column das_score drop not null;
create index chain_blocks_chain_idx on public.chain_blocks (chain, height);

-- Output of research_summarizer.py. Always labelled AI interpretation, never a primary record.
create table public.research_summaries (
  id                bigint generated always as identity primary key,
  agent_id          text not null references public.agents (node_id) on delete cascade,
  topic_id          bigint references public.research_topics (id) on delete set null,
  model             text not null,
  ai_interpretation text not null,
  disclaimer        text not null,
  source_counts     jsonb not null default '{}',
  input_hash        text not null,
  created_at        timestamptz not null default now(),
  unique (agent_id, input_hash)
);
create index research_summaries_topic_idx on public.research_summaries (topic_id);

alter table public.research_summaries enable row level security;
create policy "authenticated read" on public.research_summaries
  for select to authenticated using (true);
