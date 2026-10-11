// Used by research-agents/test_twinnet_wire_ts.py: a browser-implementation twin joins a relay, introduces itself to a remote twin whose card is given, asks it for its
// status and prints what it hears. Usage: node scripts/twin-wire-check.mjs <relay-url> <remote-card.json>
import { readFileSync } from 'node:fs'
import { Ledger, TwinNode, createIdentity } from '../src/lib/twin-net.ts'
import { connectRelay } from '../src/lib/twin-relay.ts'

const [url, cardFile] = process.argv.slice(2)
const remote = JSON.parse(readFileSync(cardFile, 'utf8'))
const ident = await createIdentity('Browser twin')
const heard = []
const state = {
  status: () => ({ emotion: 'curious', intent: 'looking around', aware: null }), presence: () => ({ someone: null, moving: null }),
  vitals: () => ({ arousal: 'near usual', energy: 'near usual', stress: 'near usual', tiredness: 'near usual' }), memory: () => [], answer: () => 'browser answer', notice: (t) => heard.push(t),
}
const me = new TwinNode(ident, state, new Ledger())
let link
const deliver = async (env) => { const got = await me.receive(env); if (got.response) link.send(got.response) }
link = connectRelay(url, ident, (env) => void deliver(env), (s, d) => { if (s === 'error') console.log('relay error:', d) })
await link.ready
await me.addPeer(remote)
console.log('CARD ' + JSON.stringify(me.card))
// wait until the remote has our card (the driver writes it back), then ask
await new Promise((r) => setTimeout(r, 1500))
link.send(await me.request(remote.id, 'status.request'))
const t0 = Date.now()
while (Date.now() - t0 < 12000 && !heard.some((h) => h.includes('told me'))) await new Promise((r) => setTimeout(r, 100))
console.log('HEARD ' + JSON.stringify(heard))
link.close(); process.exit(0)
