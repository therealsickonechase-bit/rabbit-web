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
