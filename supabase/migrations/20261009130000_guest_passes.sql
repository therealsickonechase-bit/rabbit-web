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
