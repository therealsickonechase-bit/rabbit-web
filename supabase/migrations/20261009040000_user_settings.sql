-- Per-user settings, currently the user's own Anthropic API key (encrypted by the app
-- with AES-GCM before it is stored). RLS is on with NO policies: neither the browser nor
-- a logged-in session can read this table. Only server actions, using the service role, do.
create table public.user_settings (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  anthropic_key_enc   text,
  anthropic_key_last4 text,
  updated_at          timestamptz not null default now()
);

alter table public.user_settings enable row level security;
