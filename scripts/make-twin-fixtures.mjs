// Writes interoperability fixtures from the TypeScript twin-network code: two identities (with their private keys, TEST KEYS ONLY), their cards, a request
// envelope from A to B and B's response, made with a fixed clock. The Python/MicroPython implementation (research-agents/twinnet) must be able to verify,
// decrypt and answer them, and the same is checked the other way round with tests/fixtures/py-twin.json.
//   node scripts/make-twin-fixtures.mjs tests/fixtures/ts-twin.json
import { writeFileSync } from 'node:fs'
import { Ledger, TwinNode, createIdentity } from '../src/lib/twin-net.ts'

const NOW = 1_800_000_000_000
const out = process.argv[2] ?? 'tests/fixtures/ts-twin.json'
const provider = (who) => ({
  status: () => ({ emotion: 'calm', intent: 'walking', aware: `${who} is thinking about a quiet room` }),
  presence: () => ({ someone: true, moving: false }), vitals: () => ({ arousal: 'near usual', energy: 'above usual', stress: 'below usual', tiredness: 'near usual' }),
  memory: () => [`${who} remembers a long walk.`], answer: (q) => `${who} answers: ${q}`, notice: () => {},
})
const exportPriv = async (id) => ({
  sign_d: (await crypto.subtle.exportKey('jwk', id.signPriv)).d, dh_d: (await crypto.subtle.exportKey('jwk', id.dhPriv)).d,
})
const ia = await createIdentity('Twin A', new Date(NOW)), ib = await createIdentity('Twin B', new Date(NOW))
const ledger = new Ledger()
const a = new TwinNode(ia, provider('A'), ledger, () => NOW), b = new TwinNode(ib, provider('B'), ledger, () => NOW)
await a.addPeer(b.card); await b.addPeer(a.card)
const request = await a.request(b.me.id, 'status.request')
const handled = await b.receive(request)
const question = await a.request(b.me.id, 'question.ask', { question: 'how are you' })
const answered = await b.receive(question)
writeFileSync(out, JSON.stringify({
  now: NOW,
  a: { name: 'Twin A', card: a.card, ...(await exportPriv(ia)) }, b: { name: 'Twin B', card: b.card, ...(await exportPriv(ib)) },
  status_request: request, status_response: handled.response, question_request: question, question_response: answered.response, ledger: ledger.entries,
}, null, 1))
console.log('wrote', out, 'ledger entries:', ledger.entries.length)
