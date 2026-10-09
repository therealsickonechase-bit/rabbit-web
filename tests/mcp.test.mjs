import assert from 'node:assert/strict'
import test from 'node:test'
import { bearerFrom, generateKey, handleRpc, hashKey, keyUsable, originAllowed, TOOLS } from '../src/lib/mcp.ts'

const calls = []
const db = {
  searchRecords: async (words, source, limit) => { calls.push(['search', words, source, limit]); return [{ id: 'pubmed:1', source: 'pubmed', title: 'BRCA1 paper', url: 'https://x.org' }] },
  semanticSearch: async (q, n) => (q === 'unavailable query' ? null : [{ id: 'pubmed:1', source: 'pubmed', title: 'BRCA1 paper', url: null, similarity: 0.87654321 }]),
  getRecord: async (id) => (id === 'pubmed:1' ? { id, source: 'pubmed', title: 't', url: null, meta: {} } : null),
  guides: async () => [{ id: 'g1', meta: { gene: 'BRCA1', guide: 'A'.repeat(20), secret_internal: 'x' } }],
  stats: async () => ({ pubmed: 8 }),
  digestCheck: async () => ({ status: 'match', recomputed: 'a', logged: 'a', guides: 30 }),
  createTask: async (u, kind, params) => { calls.push(['task', u, kind, params]); return { ok: true, id: 't1' } },
  myTasks: async () => [],
}
const reader = { userId: 'u1', scopes: ['read'], db }
const proposer = { userId: 'u1', scopes: ['read', 'propose'], db }
const call = (name, args, ctx = reader) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)
const text = (r) => r.result.content[0].text

test('keys are random, hashed and only the hash is comparable', async () => {
  const a = generateKey(), b = generateKey()
  assert.match(a.key, /^rbk_[A-Za-z0-9_-]{30,}$/)
  assert.notEqual(a.key, b.key)
  assert.equal(a.prefix, a.key.slice(0, 8))
  assert.match(await hashKey(a.key), /^[0-9a-f]{64}$/)
  assert.equal(await hashKey(a.key), await hashKey(a.key))
  assert.notEqual(await hashKey(a.key), await hashKey(b.key))
})

test('bearer parsing, expiry/revocation and origin rules', () => {
  const { key } = generateKey()
  assert.equal(bearerFrom(`Bearer ${key}`), key)
  for (const bad of [null, '', key, `Basic ${key}`, 'Bearer abc', `Bearer ${key} extra`]) assert.equal(bearerFrom(bad), null)
  const now = Date.now()
  assert.equal(keyUsable({ revoked_at: null, expires_at: new Date(now + 1000).toISOString() }, now), true)
  assert.equal(keyUsable({ revoked_at: null, expires_at: new Date(now - 1000).toISOString() }, now), false)
  assert.equal(keyUsable({ revoked_at: new Date().toISOString(), expires_at: new Date(now + 1000).toISOString() }, now), false)
  assert.equal(originAllowed(null), true)
  assert.equal(originAllowed('https://claude.ai'), true)
  assert.equal(originAllowed('https://evil.example'), false)
})

test('initialize negotiates a supported version; notifications get no reply; ping works', async () => {
  const init = await handleRpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, reader)
  assert.equal(init.result.protocolVersion, '2025-03-26')
  assert.equal(init.result.serverInfo.name, 'rabbitos')
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, reader)).result.protocolVersion, '2025-06-18')
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, reader), null)
  assert.deepEqual((await handleRpc({ jsonrpc: '2.0', id: 2, method: 'ping' }, reader)).result, {})
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 3, method: 'nope' }, reader)).error.code, -32601)
  assert.equal((await handleRpc({ nonsense: true }, reader)).error.code, -32600)
})

test('tools/list only shows tools the key may use', async () => {
  const names = (r) => r.result.tools.map((t) => t.name)
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, reader)
  assert.ok(!names(r).includes('propose_task'))
  assert.ok(names(r).includes('search_research'))
  const p = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, proposer)
  assert.ok(names(p).includes('propose_task'))
  for (const t of TOOLS) assert.equal(t.inputSchema.type, 'object')
})

test('search turns the query into safe keywords and caps the limit', async () => {
  calls.length = 0
  const r = await call('search_research', { query: 'BRCA1, PARP inhibitor); drop', limit: 5 })
  assert.equal(JSON.parse(text(r)).records[0].id, 'pubmed:1')
  assert.deepEqual(calls[0][1].every((w) => /^[a-z0-9]+$/.test(w)), true)
  assert.match(text(await call('search_research', { query: 'ab', limit: 99 })), /Invalid arguments/)
  assert.match(text(await call('search_research', { query: 'x y', limit: 5 })), /Invalid arguments|No usable/)
})

test('arguments are validated strictly', async () => {
  assert.equal((await call('get_record', { id: 'pubmed:1', extra: 1 })).result.isError, true)
  assert.equal((await call('list_crispr_guides', { gene: 'TP53' })).result.isError, true)
  assert.match(text(await call('get_record', { id: 'missing' })), /No such record/)
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'drop_database' } }, reader)).error.code, -32602)
})

test('guide listings expose only whitelisted fields', async () => {
  const g = JSON.parse(text(await call('list_crispr_guides', { gene: 'BRCA1' }))).guides[0]
  assert.equal(g.gene, 'BRCA1')
  assert.equal(g.secret_internal, undefined)
})

test('propose_task needs the propose scope and still validates parameters', async () => {
  assert.match(text(await call('propose_task', { kind: 'brain_search', params: { query: 'EEG alpha' } }, reader)), /scope/)
  calls.length = 0
  const ok = JSON.parse(text(await call('propose_task', { kind: 'brain_search', params: { query: 'EEG alpha' } }, proposer)))
  assert.equal(ok.ok, true)
  assert.deepEqual(calls[0].slice(0, 3), ['task', 'u1', 'brain_search'])
  assert.match(text(await call('propose_task', { kind: 'crispr_guides', params: { gene: 'X;DROP' } }, proposer)), /error/)
})

test('a failing tool returns a generic error and never leaks details', async () => {
  const boom = { ...reader, db: { ...db, stats: async () => { throw new Error('password=hunter2 at db.internal') } } }
  const r = await call('research_stats', {}, boom)
  assert.equal(r.result.isError, true)
  assert.ok(!text(r).includes('hunter2'))
})

test('long results are truncated', async () => {
  const big = { ...reader, db: { ...db, stats: async () => Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`source_${i}`, i])) } }
  assert.match(text(await call('research_stats', {}, big)), /truncated\)$/)
})

test('semantic_search returns rounded similarity, or a clear fallback when embeddings are unavailable', async () => {
  const r = JSON.parse(text(await call('semantic_search', { query: 'DNA repair in breast tumours' })))
  assert.equal(r.records[0].similarity, 0.877)
  assert.match(text(await call('semantic_search', { query: 'unavailable query' })), /search_research/)
  assert.equal((await call('semantic_search', { query: 'hi' })).result.isError, true)   // too short
})
