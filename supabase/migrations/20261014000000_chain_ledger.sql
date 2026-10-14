-- Chain ledger: an append-only, hash-chained log of every write to the opened tables.
--
-- NOT APPLIED automatically. Review, then apply by hand.
--
-- Each event is { seq, table, op, row_id, payload, prev_hash, hash }. The app computes the hash (src/lib/chain-ledger.ts, the
-- Merkle leaf hash of the canonical JSON). The database enforces the LINKAGE: seq 1 follows the all-zero genesis hash, every later
-- event's prev_hash must equal the hash of seq - 1, and no seq or prev_hash can be used twice, so the log cannot fork or skip.
-- A delete or a wipe is a tombstone event (op 'delete', empty payload). The ledger itself can never be updated, deleted or truncated:
--   * RLS on, with a public read policy only; no insert/update/delete policy for anyone;
--   * update, delete, truncate revoked from every role (including service_role); insert granted to service_role only;
--   * triggers reject update, delete and truncate (a superuser can still disable triggers, so keep the Maxwell / R2 copies).
-- Only whitelisted columns of the opened tables are ever written here (never contact_records, api_keys, user_settings,
-- guest_passes, twin name / date of birth); the app enforces that, and the tbl check below lists the only allowed tables.

create table if not exists public.chain_ledger (
  seq        bigint primary key check (seq >= 1),
  tbl        text   not null check (tbl in (
               'eeg_band_samples', 'self_daily', 'chat_threads', 'chat_messages', 'collections', 'collection_items',
               'notes', 'kg_edges', 'agent_tasks')),
  op         text   not null check (op in ('insert', 'update', 'delete')),
  row_id     text   not null check (char_length(row_id) between 1 and 700),
  payload    jsonb  not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 90000),
  prev_hash  text   not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash       text   not null unique check (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (prev_hash),
  check (op <> 'delete' or payload = '{}'::jsonb)
);
create index if not exists chain_ledger_tbl_idx on public.chain_ledger (tbl, seq);

-- Linkage check, run when the statement commits so a batch insert sees its own earlier rows.
create or replace function public.chain_ledger_link() returns trigger
language plpgsql set search_path = '' as $$
declare p text;
begin
  if new.seq = 1 then
    if new.prev_hash <> repeat('0', 64) then
      raise exception 'chain_ledger: seq 1 must follow the genesis hash' using errcode = '23514';
    end if;
  else
    select hash into p from public.chain_ledger where seq = new.seq - 1;
    if p is null or p <> new.prev_hash then
      raise exception 'chain_ledger: link broken at seq %', new.seq using errcode = '23514';
    end if;
  end if;
  return null;
end $$;

drop trigger if exists chain_ledger_link on public.chain_ledger;
create constraint trigger chain_ledger_link after insert on public.chain_ledger
  deferrable initially deferred for each row execute function public.chain_ledger_link();

-- Append-only: nothing may change or remove an event.
create or replace function public.chain_ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'chain_ledger is append-only';
end $$;

drop trigger if exists chain_ledger_no_change on public.chain_ledger;
create trigger chain_ledger_no_change before update or delete on public.chain_ledger
  for each row execute function public.chain_ledger_immutable();
drop trigger if exists chain_ledger_no_truncate on public.chain_ledger;
create trigger chain_ledger_no_truncate before truncate on public.chain_ledger
  for each statement execute function public.chain_ledger_immutable();

alter table public.chain_ledger enable row level security;
drop policy if exists "public read" on public.chain_ledger;
create policy "public read" on public.chain_ledger for select to anon, authenticated using (true);

revoke all on public.chain_ledger from public, anon, authenticated, service_role;
grant select on public.chain_ledger to anon, authenticated, service_role;
grant insert on public.chain_ledger to service_role;
