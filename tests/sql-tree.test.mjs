import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { buildTree } from '../src/lib/sql-tree.ts'

const tree = (...sqls) => buildTree(sqls.map((sql, i) => ({ name: `2026101${i}000000_m.sql`, sql })))
const table = (t, name) => t.tables.find((x) => x.name === name)

test('columns: types, defaults, nested parentheses, primary and foreign keys; table constraints are not columns', () => {
  const t = tree(`
    create table if not exists public.notes (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null references auth.users (id) on delete cascade,
      amount numeric(10, 2) default 0 check (amount >= 0),
      body text,
      meta jsonb not null default '{"a": [1,2]}'::jsonb,
      created_at timestamptz not null default now(),
      constraint notes_amount_ck check (amount < 1000),
      unique (owner_id, created_at),
      foreign key (owner_id) references auth.users (id)
    );`)
  const n = table(t, 'notes')
  assert.deepEqual(n.columns.map((c) => c.name), ['id', 'owner_id', 'amount', 'body', 'meta', 'created_at'])
  assert.deepEqual(n.columns.map((c) => c.type), ['uuid', 'uuid', 'numeric(10, 2)', 'text', 'jsonb', 'timestamptz'])
  assert.equal(n.columns[0].primaryKey, true)
  assert.equal(n.columns[1].references, 'auth.users')
  assert.equal(n.columns[1].notNull, true)
  assert.equal(n.columns[3].notNull, false)
})

test('later migrations add columns, drop tables and drop policies; comments and function bodies are ignored', () => {
  const t = tree(
    `create table public.a (id int);
     create table public.gone (id int);
     create policy "read" on public.a for select to anon using (true);`,
    `-- create table public.commented (id int);
     alter table public.a add column if not exists extra text;
     drop table if exists public.gone;
     create or replace function public.helper() returns int language plpgsql as $$ begin create table public.inside_body (x int); return 1; end $$;
     drop policy if exists "read" on public.a;`)
  assert.deepEqual(t.tables.map((x) => x.name), ['a'])
  assert.deepEqual(table(t, 'a').columns.map((c) => c.name), ['id', 'extra'])
  assert.equal(table(t, 'a').policies.length, 0)
  assert.equal(table(t, 'a').publicRead, false)
  assert.deepEqual(t.functions, ['helper'])
})

test('row level security, policies and public read are read from plain statements', () => {
  const t = tree(`create table public.r (id int);
    alter table public.r enable row level security;
    create policy "public read" on public.r for select to anon, authenticated using (true);
    create policy "owner write" on public.r for insert to authenticated with check (true);`)
  const r = table(t, 'r')
  assert.equal(r.rls, true)
  assert.deepEqual(r.policies.map((p) => `${p.name}/${p.command}/${p.roles}`), ['public read/select/anon, authenticated', 'owner write/insert/authenticated'])
  assert.equal(r.publicRead, true)
})

test('loop blocks apply to every table in the array, in order, and skip tables that do not exist', () => {
  const t = tree(
    `create table public.agents (id int); create table public.secrets (id int); create table public.ghost_free (id int);`,
    `do $$
     declare t text;
     begin
       foreach t in array array['agents', 'not_a_table', 'secrets'] loop
         continue when to_regclass(format('public.%I', t)) is null;
         execute format('alter table public.%I enable row level security', t);
         execute format('drop policy if exists "public read" on public.%I', t);
         execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
         execute format('grant select on public.%I to anon, authenticated', t);
       end loop;
     end $$;`,
    `do $$ begin foreach t in array array['secrets'] loop
       execute format('revoke all on public.%I from anon, authenticated', t);
     end loop; end $$;`)
  assert.equal(table(t, 'agents').rls, true)
  assert.equal(table(t, 'agents').publicRead, true)
  assert.equal(table(t, 'agents').policies.length, 1)
  assert.equal(table(t, 'secrets').closed, true)                         // closed again by the later migration
  assert.equal(table(t, 'secrets').publicRead, false)
  assert.equal(table(t, 'secrets').policies.length, 0)
  assert.equal(table(t, 'ghost_free').rls, false)                        // not in any array: untouched
  assert.ok(!t.tables.some((x) => x.name === 'not_a_table'))
})

test('append-only triggers, indexes, storage buckets and hand-applied migrations are noticed', () => {
  const t = buildTree([
    { name: '1_a.sql', sql: `create table public.log (id int);
      create trigger log_no_change before update or delete on public.log for each row execute function f();
      create unique index if not exists log_id on public.log (id);
      insert into storage.buckets (id, name, public, file_size_limit) values ('packages', 'packages', true, 1000);` },
    { name: '2_b.sql', sql: '-- NOT APPLIED automatically. Review, then apply by hand.\nalter table public.log add column x int;' },
  ])
  const l = table(t, 'log')
  assert.equal(l.appendOnly, true); assert.equal(l.indexes, 1); assert.deepEqual(l.triggers, ['log_no_change'])
  assert.deepEqual(t.storageBuckets, [{ id: 'packages', public: true }])
  assert.deepEqual(t.migrations, [{ name: '1_a.sql', manual: false }, { name: '2_b.sql', manual: true }])
})

test('migrations are read in file-name order whatever order they are given', () => {
  const a = buildTree([{ name: '2_b.sql', sql: 'alter table public.t add column late int;' }, { name: '1_a.sql', sql: 'create table public.t (id int);' }])
  assert.deepEqual(table(a, 't').columns.map((c) => c.name), ['id', 'late'])
})

test('drop then create of the same policy in one file leaves the policy in place; create then drop removes it', () => {
  const kept = tree(`create table public.l (id int); alter table public.l enable row level security;
    drop policy if exists "public read" on public.l;
    create policy "public read" on public.l for select to anon, authenticated using (true);`)
  assert.equal(table(kept, 'l').publicRead, true)
  const removed = tree(`create table public.l (id int);
    create policy "public read" on public.l for select to anon using (true);
    drop policy if exists "public read" on public.l;`)
  assert.equal(table(removed, 'l').publicRead, false)
})

test('the real migrations produce a believable tree: public read exactly where the open-access migration says, and private tables closed', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const t = buildTree(readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') })))
  assert.ok(t.tables.length >= 25 && t.migrations.length >= 15)
  for (const open of ['research_records', 'agents', 'chain_blocks', 'audit_entries', 'agent_tasks']) assert.equal(table(t, open).publicRead, true, `${open} should be publicly readable`)
  for (const closed of ['contact_records', 'api_keys', 'user_settings', 'guest_passes', 'owners']) { const x = table(t, closed); assert.equal(x.publicRead, false, `${closed} must not be publicly readable`); assert.equal(x.rls, true, `${closed} must have RLS on`) }
  assert.equal(table(t, 'chain_ledger').publicRead, true)                  // its migration drops and then creates "public read"
  assert.equal(table(t, 'public_packages').publicRead, true)
  assert.equal(table(t, 'audit_entries').appendOnly, true)
  assert.equal(table(t, 'chain_ledger').appendOnly, true)
  assert.ok(t.migrations.some((m) => m.manual), 'at least the open-access migration says it is applied by hand')
  assert.ok(table(t, 'research_records').columns.some((c) => c.name === 'title'))
})
