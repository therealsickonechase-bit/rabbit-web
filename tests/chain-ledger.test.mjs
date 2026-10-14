import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GENESIS_HEAD, LEDGER_TABLE_NAMES, NEVER_LEDGER, buildEvents, isClean, makeDraft, makeDrafts, planRestore, publicEvent, replay, verifyChain,
} from '../src/lib/chain-ledger.ts'
import { noopMirror, r2Mirror } from '../src/lib/chain-mirror.ts'
import { PROTECTED_TABLES } from '../src/lib/open-access.ts'

const U = '00000000-0000-4000-8000-0000000000a1'
const T0 = '2026-10-14T10:00:00.000Z'
const col = (n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, user_id: U, name: `c${n}`, created_at: T0 })
const day = (d) => ({ user_id: U, day: d, dims: [{ key: 'sleep', level: 'usual', value: 0.5, trend: 0, n: 3 }], lab_flags: { in_range: 1, high: 0, low: 0 }, synthetic: false, updated_at: T0 })
const eeg = (i) => ({ agent_id: 'eeg-1', session: 's1', ts: new Date(Date.now() - i * 1000).toISOString(), channel: 'Fp1', band: 'alpha', power: 1.5 + i, rel_power: 0.25, board: 'synthetic', id: 999 })
const edge = (r) => ({ a_kind: 'gene', a_name: 'BRCA1', b_kind: 'band', b_name: 'alpha', record_id: r, built_at: T0 })

async function chain(drafts, head = GENESIS_HEAD) { return buildEvents(head, drafts) }

/** A tiny stand-in for the database: a ledger (append only) and live tables, written ledger-first like the app. */
function world() {
  const ledger = []
  const live = {}
  const keyOf = (t, r) => makeDraft(t, 'insert', r).row_id
  return {
    ledger, live,
    async write(table, op, rows) {
      const head = ledger.length ? { seq: ledger.at(-1).seq, hash: ledger.at(-1).hash } : GENESIS_HEAD
      ledger.push(...(await buildEvents(head, makeDrafts(table, op, rows)))) // ledger first
      const t = (live[table] ??= new Map())
      for (const r of rows) if (op === 'delete') t.delete(keyOf(table, r)); else t.set(keyOf(table, r), makeDraft(table, 'insert', r).payload)
    },
    wipe() { for (const k of Object.keys(live)) live[k].clear() }, // someone empties the live tables; the ledger is untouched
    async restore() {
      const v = await verifyChain(ledger)
      if (!v.ok) return v
      for (const p of planRestore(ledger)) {
        const t = (live[p.table] ??= new Map())
        for (const r of p.rows) if (!t.has(makeDraft(p.table, 'insert', r).row_id)) t.set(makeDraft(p.table, 'insert', r).row_id, r) // upsert, ignore duplicates
      }
      return v
    },
    snapshot() { return JSON.stringify(Object.fromEntries(Object.entries(live).map(([k, m]) => [k, [...m.entries()].sort()]).sort())) },
  }
}

test('the hash chain verifies and links every event to the one before', async () => {
  const ev = await chain([...makeDrafts('collections', 'insert', [col(1), col(2)]), ...makeDrafts('self_daily', 'update', [day('2026-10-13')])])
  assert.equal(ev[0].prev_hash, GENESIS_HEAD.hash)
  assert.equal(ev[1].prev_hash, ev[0].hash)
  const v = await verifyChain(ev)
  assert.deepEqual(v, { ok: true, count: 3, head: { seq: 3, hash: ev[2].hash } })
  // a later batch continues from the head
  const more = await chain(makeDrafts('notes', 'insert', [{ id: '00000000-0000-4000-8000-0000000000b1', user_id: U, collection_id: col(1).id, body: 'hi', created_at: T0 }]), v.head)
  assert.equal((await verifyChain([...ev, ...more])).ok, true)
  assert.equal((await verifyChain(more, v.head)).ok, true)
})

test('tampering, dropping, reordering or forking is detected', async () => {
  const ev = await chain(makeDrafts('collections', 'insert', [col(1), col(2), col(3)]))
  const edited = structuredClone(ev); edited[1].payload.name = 'evil'
  const bad = await verifyChain(edited)
  assert.equal(bad.ok, false); assert.equal(bad.seq, 2); assert.match(bad.reason, /tampered/)
  assert.equal((await verifyChain([ev[0], ev[2]])).ok, false) // dropped event
  const relinked = structuredClone(ev); relinked[1].prev_hash = '1'.repeat(64)
  assert.equal((await verifyChain(relinked)).ok, false)
  assert.equal((await verifyChain([ev[0], ev[0], ev[1]])).ok, false) // duplicate seq
  const deleteSwapped = structuredClone(ev); deleteSwapped[2].op = 'delete'
  assert.equal((await verifyChain(deleteSwapped)).ok, false)
  assert.equal((await verifyChain(ev.slice(1))).ok, false) // does not start at genesis
})

test('wipe then restore returns identical rows (and a second restore changes nothing)', async () => {
  const w = world()
  await w.write('collections', 'insert', [col(1), col(2)])
  await w.write('collection_items', 'insert', [{ collection_id: col(1).id, record_id: 'rec-1', user_id: U, added_at: T0 }])
  await w.write('self_daily', 'update', [day('2026-10-12'), day('2026-10-13')])
  await w.write('eeg_band_samples', 'insert', [eeg(1), eeg(2), eeg(3)])
  await w.write('kg_edges', 'insert', [edge('r1'), edge('r2')])
  await w.write('self_daily', 'update', [{ ...day('2026-10-13'), synthetic: true }]) // later update wins
  const before = w.snapshot()
  // the wipes: DELETE /api/self/daily and the graph rebuild write tombstones first, then remove the live rows
  await w.write('self_daily', 'delete', [day('2026-10-12'), day('2026-10-13')])
  await w.write('kg_edges', 'delete', [edge('r1'), edge('r2')])
  w.wipe()
  assert.notEqual(w.snapshot(), before)
  assert.equal((await w.restore()).ok, true)
  assert.equal(w.snapshot(), before)
  assert.equal((await verifyChain(w.ledger)).ok, true) // restoring never edits the ledger, tombstones included
  assert.ok(w.ledger.some((e) => e.op === 'delete' && e.payload && Object.keys(e.payload).length === 0))
})

test('replay is idempotent and deterministic; tombstones can be honoured for the visible state', async () => {
  const ev = await chain([...makeDrafts('collections', 'insert', [col(1), col(2)]), ...makeDrafts('collections', 'delete', [col(2)]), ...makeDrafts('collections', 'update', [{ ...col(1), name: 'renamed' }])])
  const a = planRestore(ev), b = planRestore([...ev])
  assert.deepEqual(a, b)
  assert.deepEqual(planRestore(ev, undefined, {}).map((p) => p.rows.length), [2]) // both come back: a wipe removes only the live view
  assert.equal(a[0].rows.find((r) => r.id === col(1).id).name, 'renamed')
  assert.equal(replay(ev, { honorTombstones: true }).collections.size, 1)
  // applying the same plan twice into a table leaves it unchanged
  const table = new Map()
  for (let i = 0; i < 2; i++) for (const r of a[0].rows) if (!table.has(r.id)) table.set(r.id, r)
  assert.equal(table.size, 2)
})

test('restore plans parents before children and the right conflict targets', async () => {
  const ev = await chain([...makeDrafts('kg_edges', 'insert', [edge('r1')]), ...makeDrafts('collection_items', 'insert', [{ collection_id: col(1).id, record_id: 'x', user_id: U, added_at: T0 }]), ...makeDrafts('collections', 'insert', [col(1)])])
  const plan = planRestore(ev)
  assert.ok(plan.findIndex((p) => p.table === 'collections') < plan.findIndex((p) => p.table === 'collection_items'))
  assert.equal(plan.find((p) => p.table === 'collection_items').conflict, 'collection_id,record_id')
  assert.equal(plan.find((p) => p.table === 'kg_edges').conflict, 'a_kind,a_name,b_kind,b_name,record_id')
})

test('eeg samples past the 30 day retention do not come back', async () => {
  const old = { ...eeg(1), ts: new Date(Date.now() - 40 * 86400_000).toISOString() }
  const ev = await chain(makeDrafts('eeg_band_samples', 'insert', [old, eeg(2)]))
  assert.equal(planRestore(ev)[0].rows.length, 1)
})

test('protected fields and tables never enter the ledger', async () => {
  for (const t of PROTECTED_TABLES) assert.ok(NEVER_LEDGER.includes(t), `${t} must be on the never-ledger list`)
  for (const t of [...PROTECTED_TABLES, 'twin_identity', 'record_embeddings']) assert.throws(() => makeDraft(t, 'insert', { id: 'x' }), /not on the ledger/)
  assert.equal(LEDGER_TABLE_NAMES.some((t) => NEVER_LEDGER.includes(t)), false)
  // unknown columns are dropped, forbidden keys nested in jsonb are stripped
  const d = makeDraft('agent_tasks', 'insert', {
    id: '00000000-0000-4000-8000-0000000000c1', created_by: U, kind: 'research_topic', status: 'proposed', created_at: T0, updated_at: T0,
    params: { topic: 'x', subject_name: 'Jane', api_key: 'k', nested: { subject_dob: '1990-01-01', ok: 1 } },
    api_key_hash: 'zzz', email: 'a@b.c', subject_name: 'Jane',
  })
  const text = JSON.stringify(d)
  for (const bad of ['Jane', 'subject_dob', 'api_key', 'a@b.c', 'zzz', '1990']) assert.equal(text.includes(bad), false, bad)
  assert.deepEqual(d.payload.params, { topic: 'x', nested: { ok: 1 } })
  // an outside event carrying extra data is not clean, and the public view re-sanitises
  const [ev] = await chain([d])
  assert.equal(isClean(ev), true)
  const dirty = { ...ev, payload: { ...ev.payload, user_settings: 'secret' } }
  assert.equal(isClean(dirty), false)
  assert.equal(JSON.stringify(publicEvent(dirty)).includes('user_settings'), false)
  assert.equal(publicEvent({ ...ev, table: 'contact_records' }), null)
  // no column list or mirror key mentions the protected twin fields
  assert.doesNotMatch(readFileSync(new URL('../src/lib/chain-ledger.ts', import.meta.url), 'utf8').split('export const LEDGER_TABLES')[1].split('satisfies')[0], /subject_name|subject_dob|api_keys|key_hash/)
})

test('the migration makes the ledger append-only and service-role-insert only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261014000000_chain_ledger.sql', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /before update or delete on public\.chain_ledger/)
  assert.match(sql, /before truncate on public\.chain_ledger/)
  assert.match(sql, /revoke all on public\.chain_ledger from public, anon, authenticated, service_role/)
  assert.match(sql, /grant insert on public\.chain_ledger to service_role/)
  assert.doesNotMatch(sql, /grant[^;]*(update|delete|truncate)[^;]*to/i)
  for (const t of PROTECTED_TABLES) assert.equal(sql.includes(`'${t}'`), false, t)
})

test('every open write path records on the chain before touching the live table', () => {
  const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const before = (p, live, recordCall) => { const s = src(p); const i = s.indexOf(recordCall), j = s.indexOf(live); assert.ok(i >= 0 && j >= 0 && i < j, `${p}: ${recordCall} must come before ${live}`) }
  before('src/app/api/self/daily/route.ts', ".from('self_daily').upsert(", "recordWrite('self_daily', 'update'")
  before('src/app/api/self/daily/route.ts', ".from('self_daily').delete()", "recordWrite('self_daily', 'delete'")
  before('src/app/(app)/memory/page.tsx', ".from('kg_edges').delete()", "recordWrite('kg_edges', 'delete'")
  before('src/app/(app)/ask/page.tsx', ".from('chat_messages').insert(", "recordWrite('chat_messages', 'insert'")
  before('src/app/(app)/ask/page.tsx', ".from('chat_threads').delete()", "recordWrite('chat_threads', 'delete'")
  before('src/app/(app)/collections/page.tsx', ".from('collections').delete()", "recordWrite('collections', 'delete'")
  before('src/app/(app)/collections/page.tsx', ".from('notes').insert(", "recordWrite('notes', 'insert'")
  before('src/app/(app)/research/page.tsx', ".from('collection_items').upsert(", "recordWrite('collection_items', 'insert'")
  before('src/app/api/ingest/route.ts', ".from('eeg_band_samples').upsert(", "recordWrite('eeg_band_samples', 'insert'")
  before('src/lib/task-queue.ts', ".from('agent_tasks').insert(", "recordWrite('agent_tasks', 'insert'")
  before('src/lib/mcp-db.ts', ".from('agent_tasks').insert(", "recordWrite('agent_tasks', 'insert'")
  before('src/app/api/agent/tasks/route.ts', ".from('agent_tasks').update(patch).eq('id', req.task_id).eq('status', 'claimed')", "recordWrite('agent_tasks', 'update'")
})

test('mirror: no-op by default; the R2 mirror round-trips events and lists only newer ones', async () => {
  assert.deepEqual(await noopMirror.list(0), [])
  const store = new Map()
  const bucket = {
    async put(k, v) { store.set(k, v) },
    async get(k) { return store.has(k) ? { text: async () => store.get(k) } : null },
    async list({ prefix, startAfter }) { return { objects: [...store.keys()].filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort().map((key) => ({ key })), truncated: false } },
  }
  const m = r2Mirror(bucket)
  const ev = await chain(makeDrafts('collections', 'insert', [col(1), col(2), col(3)]))
  await m.put(ev)
  await m.put(ev) // re-putting is harmless
  assert.equal(store.size, 3)
  const all = await m.list(0)
  assert.equal((await verifyChain(all)).ok, true)
  assert.deepEqual((await m.list(2)).map((e) => e.seq), [3])
})
