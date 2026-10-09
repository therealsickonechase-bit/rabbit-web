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
