-- Ask RabbitOS (chat), collections and notes.
--
-- Every row belongs to one account. A signed-in user may READ only their own rows (RLS); all writes go
-- through server actions using the service role, which check ownership first. This matches the rest of the
-- schema, where signed-in users are read-only.

-- 1. Chat ---------------------------------------------------------------------------------------------
create table if not exists public.chat_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now()
);
create index if not exists chat_threads_user_idx on public.chat_threads (user_id, created_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (char_length(content) between 1 and 20000),
  cited      text[] not null default '{}',          -- research_records.id values the answer relied on
  model      text,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at);
create index if not exists chat_messages_user_day_idx on public.chat_messages (user_id, created_at desc);

-- 2. Collections --------------------------------------------------------------------------------------
create table if not exists public.collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  record_id     text not null references public.research_records (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, record_id)
);
create index if not exists collection_items_user_idx on public.collection_items (user_id);

-- 3. Notes (private to the author) --------------------------------------------------------------------
create table if not exists public.notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  record_id     text references public.research_records (id) on delete cascade,
  collection_id uuid references public.collections (id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 5000),
  created_at    timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id, created_at desc);

-- 4. Row-level security: read your own rows, nothing else ---------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['chat_threads', 'chat_messages', 'collections', 'collection_items', 'notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows read" on public.%I', t);
    execute format('create policy "own rows read" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
