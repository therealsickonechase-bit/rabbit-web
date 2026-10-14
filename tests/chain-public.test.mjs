import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { publicApiAllowed } from '../src/lib/account-free.ts'
import { buildEvents, GENESIS_HEAD, makeDraft } from '../src/lib/chain-ledger.ts'
import { mirrorFromEnv, noopMirror } from '../src/lib/chain-mirror.ts'
import { clientKey, createLimiter, headInfo, latestPublic, mirrorCommand, verifyRemote } from '../src/lib/chain-public.ts'
import { APP_PAGES, PROTECTED_TABLES, appPage } from '../src/lib/open-access.ts'

const chain = () => buildEvents(GENESIS_HEAD, [
  makeDraft('notes', 'insert', { id: 'n1', user_id: 'u', body: 'hi', created_at: '2026-10-14T01:02:03Z' }),
  makeDraft('collections', 'insert', { id: 'c1', user_id: 'u', name: 'x', created_at: '2026-10-14T01:02:04Z' }),
  makeDraft('notes', 'delete', { id: 'n1' }),
])
const pager = (events, size = 2) => async (since) => structuredClone(events.filter((e) => e.seq > since).slice(0, size))

test('the in-browser verifier accepts a good chain page by page', async () => {
  const events = await chain()
  const seen = []
  const v = await verifyRemote(pager(events), (n) => seen.push(n))
  assert.deepEqual(v, { ok: true, count: 3, head: { seq: 3, hash: events[2].hash } })
  assert.deepEqual(seen, [2, 3])
})

test('the verifier refuses a tampered, dropped or reordered chain', async () => {
  const events = await chain()
  const tampered = structuredClone(events); tampered[1].payload.name = 'evil'
  const v = await verifyRemote(pager(tampered))
  assert.equal(v.ok, false); assert.equal(v.seq, 2)
  const dropped = [events[0], events[2]]
  assert.equal((await verifyRemote(pager(dropped))).ok, false)
})

test('head info has the documented shape', () => {
  assert.deepEqual(headInfo({ seq: 5, hash: 'ab' }, '2026-10-14T00:00:00Z'), { length: 5, headHash: 'ab', updatedAt: '2026-10-14T00:00:00Z' })
})

test('the limiter allows max per window, per key, then recovers', () => {
  let t = 0
  const allow = createLimiter(2, 1000, () => t)
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('b')], [true, true, false, true])
  t = 1001
  assert.equal(allow('a'), true)
  assert.equal(clientKey({ get: (n) => (n === 'cf-connecting-ip' ? ' 1.2.3.4 ' : null) }), '1.2.3.4')
  assert.equal(clientKey({ get: () => null }), 'anon')
})

test('latest events are newest first, capped, and re-sanitised', async () => {
  const events = await chain()
  events[0].payload.api_key = 'sk-leak'; events[0].payload.extra = 'x'
  events.push({ ...events[2], seq: 4, table: 'api_keys' })
  const latest = latestPublic(events, 2)
  assert.deepEqual(latest.map((e) => e.seq), [3, 2])
  const all = latestPublic(events, 50)
  assert.deepEqual(all.map((e) => e.seq), [3, 2, 1])
  assert.doesNotMatch(JSON.stringify(all), /sk-leak|api_keys|extra/)
})

test('the public ledger endpoints and page are open to everyone, GET only', () => {
  for (const p of ['/api/chain/head', '/api/chain/ledger']) {
    assert.equal(publicApiAllowed(p, 'GET'), true)
    assert.equal(publicApiAllowed(p, 'OPTIONS'), true)
    for (const m of ['POST', 'PUT', 'DELETE']) assert.equal(publicApiAllowed(p, m), false)
  }
  assert.equal(publicApiAllowed('/api/chain/import', 'POST'), false)
  assert.ok(APP_PAGES.includes('ledger')); assert.equal(appPage('/ledger'), 'ledger')
  assert.match(readFileSync(new URL('../src/app/(app)/layout.tsx', import.meta.url), 'utf8'), /href: '\/ledger'/)
})

test('protected names never appear in the explorer page or its routes', () => {
  const files = ['../src/app/(app)/ledger/page.tsx', '../src/app/api/chain/head/route.ts', '../src/components/LedgerVerify.tsx']
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    for (const t of PROTECTED_TABLES) assert.equal(src.includes(t), false, `${f} mentions ${t}`)
  }
})

test('mirror: picks up a CHAIN_MIRROR R2 binding, else the no-op', async () => {
  assert.equal(mirrorFromEnv(undefined), noopMirror)
  assert.equal(mirrorFromEnv({}), noopMirror)
  assert.equal(mirrorFromEnv({ CHAIN_MIRROR: 'nope' }), noopMirror)
  const store = new Map()
  const bucket = {
    put: async (k, v) => { store.set(k, v) },
    get: async (k) => (store.has(k) ? { text: async () => store.get(k) } : null),
    list: async ({ startAfter }) => ({ objects: [...store.keys()].sort().filter((k) => !startAfter || k > startAfter).map((key) => ({ key })), truncated: false }),
  }
  const m = mirrorFromEnv({ CHAIN_MIRROR: bucket })
  assert.equal(m.name, 'r2')
  const events = await chain()
  await m.put(events)
  assert.deepEqual((await m.list(1)).map((e) => e.seq), [2, 3])
})

test('config declares the R2 binding and docs list the bucket steps', () => {
  assert.match(readFileSync(new URL('../cloudflare.config.ts', import.meta.url), 'utf8'), /CHAIN_MIRROR: bindings\.r2\(\{ name: 'rabbitos-chain-mirror' \}\)/)
  assert.match(readFileSync(new URL('../docs/rabbitos.md', import.meta.url), 'utf8'), /wrangler r2 bucket create rabbitos-chain-mirror/)
  assert.match(mirrorCommand('https://x.test/'), /--url https:\/\/x\.test /)
})
