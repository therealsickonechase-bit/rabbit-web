-- Chain ledger: allow the Maxwell chain mirror ('maxwell_chain') as a ledger table.
--
-- NOT APPLIED automatically. Review, then apply by hand, AFTER 20261014000000_chain_ledger.sql and BEFORE the app that
-- posts to /api/ingest/maxwell-chain is used.
--
-- Each Maxwell block becomes one ledger event: tbl 'maxwell_chain', op 'insert', row_id = the block index, payload =
-- { index, timestamp, transactions, previous_hash, nonce, hash } (public-safe; the app validates it strictly).
-- This only widens the allowed-table check; the append-only triggers, grants and linkage are untouched.
--
-- 1) find the existing tbl check by what it says (its name is generated, so do not assume it), drop it, add a named one;
-- 2) a partial unique index so a Maxwell block index can be mirrored at most once, even with two writers at the same time.
-- Safe to run more than once.

do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.chain_ledger'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%tbl%'
      and pg_get_constraintdef(con.oid) ilike '%eeg_band_samples%'
  loop
    execute format('alter table public.chain_ledger drop constraint %I', c.conname);
  end loop;

  alter table public.chain_ledger
    add constraint chain_ledger_tbl_allowed check (tbl in (
      'eeg_band_samples', 'self_daily', 'chat_threads', 'chat_messages', 'collections', 'collection_items',
      'notes', 'kg_edges', 'agent_tasks', 'maxwell_chain'));
end $$;

create unique index if not exists chain_ledger_maxwell_row_uniq
  on public.chain_ledger (row_id) where tbl = 'maxwell_chain';
