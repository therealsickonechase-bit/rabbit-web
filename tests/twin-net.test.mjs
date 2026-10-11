import assert from 'node:assert/strict'
import test from 'node:test'
import { CAPABILITIES, DEFAULT_POLICY, Ledger, TwinNode, canonical, createIdentity, noDigits, verifyCard } from '../src/lib/twin-net.ts'

const provider = (name, extra = {}) => {
  const seen = []
  return {
    seen,
    status: () => ({ emotion: 'calm', intent: 'walking', aware: 'a quiet room' }),
    presence: () => ({ someone: true, moving: false }),
    vitals: () => ({ arousal: 'near usual', energy: 'above usual', stress: 'below usual', tiredness: 'near usual' }),
    memory: () => [`${name} remembers a long walk.`, 'It rested afterwards.', 'It felt content.', 'A fourth moment.'],
    answer: (q) => `${name} says: I am fine when asked "${q}".`,
    notice: (t) => seen.push(t),
    ...extra,
  }
}
async function pair(clock = () => 1_800_000_000_000, extraA = {}, extraB = {}) {
  const ledger = new Ledger()
  const ia = await createIdentity('Twin A'), ib = await createIdentity('Twin B')
  const pa = provider('A', extraA), pb = provider('B', extraB)
  const a = new TwinNode(ia, pa, ledger, clock), b = new TwinNode(ib, pb, ledger, clock)
  assert.equal(await a.addPeer(b.card), true); assert.equal(await b.addPeer(a.card), true)
  return { a, b, pa, pb, ledger }
}
const open = async (from, to, env) => to.receive(env)

test('each twin has its own identity, and a card only verifies if it is untouched', async () => {
  const x = await createIdentity('One'), y = await createIdentity('Two')
  assert.notEqual(x.id, y.id); assert.match(x.id, /^[0-9a-f]{16}$/)
  assert.equal(await verifyCard(x.card), true)
  assert.equal(await verifyCard({ ...x.card, name: 'Mallory' }), false)
  assert.equal(await verifyCard({ ...x.card, id: y.id }), false)
  assert.equal(await verifyCard({ ...x.card, sign: y.card.sign }), false)
  const a = new TwinNode(x, provider('x'), new Ledger()); assert.equal(await a.addPeer({ ...y.card, sig: x.card.sig }), false); assert.equal(await a.addPeer(x.card), false)
})

test('a status request is signed, encrypted, answered with words, and logged on both sides', async () => {
  const { a, b, pa, ledger } = await pair()
  const env = await a.request(b.me.id, 'status.request')
  assert.ok(!JSON.stringify(env).includes('calm') && !JSON.stringify(env).includes('walking'))      // the payload travels as ciphertext
  const got = await open(a, b, env)
  assert.equal(got.outcome, 'answered'); assert.equal(got.response.h.type, 'response'); assert.equal(got.response.h.re, env.h.id)
  const back = await open(b, a, got.response)
  assert.equal(back.outcome, 'delivered'); assert.match(pa.seen.join(' '), /told me: I feel calm and I am walking/)
  assert.deepEqual(ledger.entries.map((e) => e.outcome), ["delivered", "answered", "delivered"]); assert.equal(await ledger.verify(), null)
})

test('the policy decides: denied capabilities are refused and logged, ask-first requests wait for the owner', async () => {
  const { a, b, ledger, pa } = await pair()
  const denied = await open(a, b, await a.request(b.me.id, 'vitals.request'))
  assert.equal(denied.outcome, 'denied-by-policy'); assert.equal(denied.response.h.type, 'denied')
  await open(b, a, denied.response); assert.match(pa.seen.join(' '), /declined to share/)

  const asked = await open(a, b, await a.request(b.me.id, 'presence.request'))
  assert.equal(asked.outcome, 'asked'); assert.equal(b.pending.length, 1); assert.equal(asked.response, undefined)
  const yes = await b.resolve(asked.pendingId, true); assert.equal(yes.outcome, 'answered'); assert.equal(b.pending.length, 0)
  const asked2 = await open(a, b, await a.request(b.me.id, 'memory.request'))
  const no = await b.resolve(asked2.pendingId, false); assert.equal(no.outcome, 'denied-by-owner'); assert.equal(no.response.h.type, 'denied')
  const outcomes = ledger.entries.map((e) => e.outcome)
  for (const o of ['denied-by-policy', 'asked', 'answered', 'denied-by-owner']) assert.ok(outcomes.includes(o), o)

  b.policyFor(a.me.id).vitals = 'allow'
  assert.equal((await open(a, b, await a.request(b.me.id, 'vitals.request'))).outcome, 'answered')
})

test('memory and questions share only a few words, and only what the provider offers', async () => {
  const { a, b, pa } = await pair()
  b.policyFor(a.me.id).memory = 'allow'
  const m = await open(a, b, await a.request(b.me.id, 'memory.request')); await open(b, a, m.response)
  assert.match(pa.seen.at(-1), /long walk/); assert.ok(!pa.seen.at(-1).includes('fourth'))                  // at most three moments
  const q = await open(a, b, await a.request(b.me.id, 'question.ask', { question: 'how are you' })); await open(b, a, q.response)
  assert.match(pa.seen.at(-1), /B says/)
})

test('a tampered envelope is rejected: ciphertext, header or signature', async () => {
  const { a, b } = await pair()
  const env = await a.request(b.me.id, 'status.request')
  const flip = (s) => s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1)
  assert.equal((await open(a, b, { ...env, ct: flip(env.ct) })).outcome, 'bad-signature')
  assert.equal((await open(a, b, { ...env, h: { ...env.h, type: 'vitals.request' } })).outcome, 'bad-signature')
  assert.equal((await open(a, b, { ...env, sig: flip(env.sig) })).outcome, 'bad-signature')
  assert.equal((await open(a, b, env)).outcome, 'answered')                                                      // the untouched one still works
})

test('replays and stale messages are refused', async () => {
  let now = 1_800_000_000_000
  const { a, b } = await pair(() => now)
  const env = await a.request(b.me.id, 'status.request')
  assert.equal((await open(a, b, env)).outcome, 'answered'); assert.equal((await open(a, b, env)).outcome, 'replay')
  const old = await a.request(b.me.id, 'status.request'); now += 10 * 60_000
  assert.equal((await open(a, b, old)).outcome, 'replay')
})

test('a third twin cannot read or accept a message meant for someone else', async () => {
  const { a, b, ledger } = await pair()
  const c = new TwinNode(await createIdentity('Twin C'), provider('C'), ledger); await c.addPeer(a.card); await a.addPeer(c.card)
  const env = await a.request(b.me.id, 'status.request')
  assert.equal((await open(a, c, env)).outcome, 'invalid')
  const forged = { ...env, h: { ...env.h, to: c.me.id } }
  assert.equal((await open(a, c, forged)).outcome, 'bad-signature')
})

test('numbers can never be shared: a provider that tries, or a question with digits, is stopped before anything is sent', async () => {
  const { a, b } = await pair(undefined, {}, { status: () => ({ emotion: 'calm', intent: 'walking at 3 m/s', aware: null }) })
  const res = await open(a, b, await a.request(b.me.id, 'status.request'))
  assert.equal(res.outcome, 'invalid'); assert.equal(res.response, undefined)
  await assert.rejects(() => a.request(b.me.id, 'question.ask', { question: 'is it 5?' }), /only words/)
  assert.equal(noDigits({ a: 'words only' }), true); assert.equal(noDigits({ a: 'x1' }), false)
  assert.ok(!CAPABILITIES.includes('eeg') && !CAPABILITIES.includes('sensors') && !CAPABILITIES.includes('raw'))   // raw signals are not a capability
})

test('the provenance ledger verifies, and any edit to any entry is found', async () => {
  const { a, b, ledger } = await pair()
  for (let i = 0; i < 3; i++) await open(a, b, await a.request(b.me.id, 'status.request'))
  assert.equal(await ledger.verify(), null); assert.equal(ledger.entries[0].prev, '0'.repeat(64))
  ledger.entries[2] = { ...ledger.entries[2], outcome: 'denied-by-policy' }; assert.equal(await ledger.verify(), 2)
  ledger.entries[2] = { ...ledger.entries[2], outcome: 'delivered' }
  ledger.entries.splice(1, 1); assert.equal(await ledger.verify(), 1)
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}'); assert.deepEqual(DEFAULT_POLICY, { status: 'allow', presence: 'ask', vitals: 'deny', memory: 'ask', question: 'allow' })
})
