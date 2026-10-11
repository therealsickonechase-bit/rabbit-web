import assert from 'node:assert/strict'
import test from 'node:test'
import { edgeCached } from '../src/lib/edge-cache.ts'

function fakeCache() {
  const store = new Map()
  return {
    store,
    async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined },
    async put(req, res) { store.set(req.url, res.clone()) },
  }
}
const req = (url = 'https://app.example/api/public/research-feed', init = {}) => new Request(url, init)
const ok = (body = '{"n":1}', cc = 'public, max-age=60, s-maxage=300', extra = {}) => () => Promise.resolve(new Response(body, { status: 200, headers: { 'Cache-Control': cc, ...extra } }))

test('the first call builds and marks MISS, the second is served from the cache and marked HIT, with the original Cache-Control back', async () => {
  const cache = fakeCache()
  let builds = 0
  const build = () => { builds++; return ok()() }
  const a = await edgeCached(req(), 'https://rabbitsoftware.io', 300, build, cache)
  assert.equal(a.headers.get('X-Edge-Cache'), 'MISS'); assert.equal(await a.text(), '{"n":1}')
  const b = await edgeCached(req(), 'https://rabbitsoftware.io', 300, build, cache)
  assert.equal(b.headers.get('X-Edge-Cache'), 'HIT'); assert.equal(await b.text(), '{"n":1}')
  assert.equal(b.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=300')
  assert.equal(b.headers.get('X-Original-Cache-Control'), null)
  assert.equal(builds, 1)
})

test('each origin variant has its own copy, so one site never receives another site\'s CORS header', async () => {
  const cache = fakeCache()
  const mk = (origin) => () => Promise.resolve(new Response('{}', { status: 200, headers: { 'Cache-Control': 'public, s-maxage=300', 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } }))
  await edgeCached(req(), 'https://rabbitsoftware.io', 300, mk('https://rabbitsoftware.io'), cache)
  const other = await edgeCached(req(), 'https://www.rabbitsoftware.io', 300, mk('https://www.rabbitsoftware.io'), cache)
  assert.equal(other.headers.get('X-Edge-Cache'), 'MISS')
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), 'https://www.rabbitsoftware.io')
  const again = await edgeCached(req(), 'https://rabbitsoftware.io', 300, mk('https://wrong.example'), cache)
  assert.equal(again.headers.get('X-Edge-Cache'), 'HIT'); assert.equal(again.headers.get('Access-Control-Allow-Origin'), 'https://rabbitsoftware.io')
  assert.equal(cache.store.size, 2)
})

test('errors, non-200 and responses that do not ask for shared caching are never stored', async () => {
  const cache = fakeCache()
  await edgeCached(req(), '', 300, () => Promise.resolve(new Response('x', { status: 503, headers: { 'Cache-Control': 'public, s-maxage=300' } })), cache)
  await edgeCached(req(), '', 300, ok('x', 'no-store'), cache)
  await edgeCached(req(), '', 300, ok('x', 'public, max-age=60'), cache)
  assert.equal(cache.store.size, 0)
})

test('without a cache, or for non-GET requests, the handler just runs', async () => {
  let builds = 0
  const build = () => { builds++; return ok()() }
  await edgeCached(req(), '', 300, build, null); await edgeCached(req(), '', 300, build, null)
  assert.equal(builds, 2)
  const cache = fakeCache()
  await edgeCached(req('https://app.example/x', { method: 'POST' }), '', 300, build, cache)
  assert.equal(cache.store.size, 0)
})

test('a failing cache never breaks the API', async () => {
  const broken = { async match() { throw new Error('boom') }, async put() { throw new Error('boom') } }
  const r = await edgeCached(req(), '', 300, ok(), broken)
  assert.equal(r.status, 200); assert.equal(await r.text(), '{"n":1}')
})

test('the query string is part of the key (a different seq is a different entry)', async () => {
  const cache = fakeCache()
  await edgeCached(req('https://app.example/api/public/proof?seq=1'), '', 300, ok('1'), cache)
  const two = await edgeCached(req('https://app.example/api/public/proof?seq=2'), '', 300, ok('2'), cache)
  assert.equal(await two.text(), '2'); assert.equal(two.headers.get('X-Edge-Cache'), 'MISS')
})
