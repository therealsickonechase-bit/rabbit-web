import assert from 'node:assert/strict'
import test from 'node:test'
import { CORE_LATEST_URL, CORE_PLATFORMS, checksumCommands, fetchCoreLatest, parseCoreLatest } from '../src/lib/maxwell-core-download.ts'

const good = { version: '0.3.0', file: 'maxwell-core-0.3.0.zip', sha256: 'ab'.repeat(32), bytes: 41694 }

test('a well-formed pointer becomes a download on rabbitsoftware.io', () => {
  assert.deepEqual(parseCoreLatest(good), { ...good, url: 'https://rabbitsoftware.io/downloads/maxwell-core-0.3.0.zip', mirror: 'https://rabbitsoftware-io-ledger-public.storage.googleapis.com/releases/maxwell-core/maxwell-core-0.3.0.zip', page: 'https://rabbitsoftware.io/maxwell-core' })
})

test('anything else is refused, so the page falls back to a plain link', () => {
  for (const bad of [null, 'x', [], {}, { ...good, version: '0.3' }, { ...good, file: 'evil.zip' }, { ...good, file: '../maxwell-core-0.3.0.zip' }, { ...good, sha256: 'AB'.repeat(32) }, { ...good, sha256: 'ab' }, { ...good, bytes: 0 }, { ...good, bytes: 1e12 }, { ...good, bytes: 1.5 }]) {
    assert.equal(parseCoreLatest(bad), null, JSON.stringify(bad))
  }
})

test('fetching never throws: bad status, bad JSON and network errors give null', async () => {
  assert.equal(CORE_LATEST_URL, 'https://rabbitsoftware.io/downloads/maxwell-core-latest.json')
  assert.equal((await fetchCoreLatest(async () => new Response(JSON.stringify(good))))?.version, '0.3.0')
  assert.equal(await fetchCoreLatest(async () => new Response('', { status: 404 })), null)
  assert.equal(await fetchCoreLatest(async () => new Response('not json')), null)
  assert.equal(await fetchCoreLatest(async () => { throw new Error('offline') }), null)
})

test('every platform has steps, and the instructions never pipe a download into a shell', () => {
  assert.deepEqual(CORE_PLATFORMS.map((p) => p.id), ['raspberry-pi', 'linux', 'windows', 'macos', 'docker'])
  for (const p of CORE_PLATFORMS) { assert.ok(p.steps.length >= 2, p.id); assert.ok(!p.steps.some((s) => /\|\s*(ba)?sh|curl|iex/i.test(s)), p.id) }
  assert.match(checksumCommands('maxwell-core-0.3.0.zip').windows, /Get-FileHash .*SHA256/)
})
