import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Ledger, TwinNode, verifyCard } from '../src/lib/twin-net.ts'

// The Python / MicroPython implementation (research-agents/twinnet) made these cards and envelopes. The browser implementation must accept and answer them,
// and the Python side checks the TypeScript-made fixtures (tests/fixtures/ts-twin.json) in test_twinnet_node.py.
const fx = JSON.parse(readFileSync(new URL('./fixtures/py-twin.json', import.meta.url), 'utf8'))

const identityFrom = async (who) => {
  const c = who.card
  const jwk = (k, d) => ({ kty: 'EC', crv: 'P-256', x: k.x, y: k.y, d, ext: true })
  const hex2b64 = (h) => Buffer.from(h, 'hex').toString('base64url')
  return {
    name: who.name, id: c.id, card: c,
    signPriv: await crypto.subtle.importKey('jwk', jwk(c.sign, hex2b64(who.sign_d)), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']),
    signPub: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: c.sign.x, y: c.sign.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']),
    dhPriv: await crypto.subtle.importKey('jwk', jwk(c.dh, hex2b64(who.dh_d)), { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
  }
}
const provider = (who, seen = []) => ({
  seen, status: () => ({ emotion: 'calm', intent: 'walking', aware: null }), presence: () => ({ someone: true, moving: false }),
  vitals: () => ({ arousal: 'near usual', energy: 'near usual', stress: 'near usual', tiredness: 'near usual' }), memory: () => [], answer: (q) => `${who} answers: ${q}`, notice: (t) => seen.push(t),
})
async function nodes() {
  const ledger = new Ledger(), now = () => fx.now
  const ia = await identityFrom(fx.a), ib = await identityFrom(fx.b)
  const a = new TwinNode(ia, provider('A'), ledger, now), b = new TwinNode(ib, provider('B'), ledger, now)
  assert.equal(await a.addPeer(fx.b.card), true); assert.equal(await b.addPeer(fx.a.card), true)
  return { a, b }
}

test('cards made by the Python implementation verify in the browser implementation', async () => {
  assert.equal(await verifyCard(fx.a.card), true); assert.equal(await verifyCard(fx.b.card), true)
  assert.equal(await verifyCard({ ...fx.a.card, name: 'Mallory' }), false)
})

test('the browser implementation answers a Python request and reads the Python response', async () => {
  const { a, b } = await nodes()
  const got = await b.receive(fx.status_request)
  assert.equal(got.outcome, 'answered')
  assert.equal((await a.receive(got.response)).outcome, 'delivered')
  const { a: a2 } = await nodes()
  assert.equal((await a2.receive(fx.status_response)).outcome, 'delivered')          // made by Python, read here
})

test('questions interoperate too, and the Python-made ledger verifies here', async () => {
  const { b } = await nodes()
  const got = await b.receive(fx.question_request); assert.equal(got.outcome, 'answered')
  const led = new Ledger(); led.entries = fx.ledger.map((e) => ({ ...e }))
  assert.equal(await led.verify(), null)
  led.entries[1] = { ...led.entries[1], outcome: 'denied-by-policy' }; assert.equal(await led.verify(), 1)
})
