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
