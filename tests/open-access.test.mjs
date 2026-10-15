import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { ANON_TASK_STATUS, COLS, OPEN_READ_TABLES, PROTECTED_TABLES, PUBLIC_USER_ID, TWIN_PUBLIC_COLUMNS, appPage, visitor } from '../src/lib/open-access.ts'

test('every visitor is the same anonymous identity', () => {
  assert.deepEqual(visitor(), visitor())
  assert.equal(visitor().id, PUBLIC_USER_ID)
  assert.match(PUBLIC_USER_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(visitor().is_anonymous, true)
})

test('protected tables are never in the open-read list', () => {
  for (const t of PROTECTED_TABLES) assert.equal(OPEN_READ_TABLES.includes(t), false, t)
  for (const t of ['contact_records', 'api_keys', 'user_settings']) assert.ok(PROTECTED_TABLES.includes(t))
})

test('app pages map only to real pages', () => {
  assert.equal(appPage('/ask'), 'ask')
  assert.equal(appPage('/tasks/x'), 'tasks')
  assert.equal(appPage('/keys'), null)
  assert.equal(appPage('/asking'), null)
})

test('twin name and date of birth are not in any published column list', () => {
  for (const list of [TWIN_PUBLIC_COLUMNS.join(','), COLS.twin]) assert.doesNotMatch(list, /subject_name|subject_dob/)
  for (const cols of Object.values(COLS)) assert.doesNotMatch(cols, /\*/)
})

test('anonymous task proposals are parked, never queued', () => {
  assert.equal(ANON_TASK_STATUS, 'proposed')
})

test('the open_access migration opens exactly the open tables and touches no protected one', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const file = readdirSync(dir).filter((f) => f.endsWith('_open_access.sql')).sort().at(-1)
  assert.ok(file, 'migration exists')
  const sql = readFileSync(new URL(file, dir), 'utf8')
  const after = readdirSync(dir).filter((f) => f.endsWith('.sql') && f > file)
  assert.deepEqual(after.filter((f) => !/_(chain_ledger(_maxwell)?|platform_graph)\.sql$/.test(f)), [], 'nothing but the append-only chain ledger and the read-only platform map comes after it')
  for (const t of OPEN_READ_TABLES) assert.ok(sql.includes(`'${t}'`), `opens ${t}`)
  const open = sql.slice(sql.indexOf('foreach t in array array['), sql.indexOf(']', sql.indexOf('foreach t in array array[')))
  for (const t of PROTECTED_TABLES) assert.equal(open.includes(`'${t}'`), false, `${t} stays closed`)
  assert.match(sql, /revoke select on public\.twin_identity from anon/)
  assert.match(sql, /grant select \(id, is_sealed, biological_hash, sealed_at\)/)
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*to (anon|authenticated)/i)
})
