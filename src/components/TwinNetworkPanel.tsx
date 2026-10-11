'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnectionReport } from '@/components/ConnectionsContext'
import { InnerLife, verbIng } from '@/lib/avatar-inner'
import { Mind, type MindInputs } from '@/lib/avatar-mind'
import { CAPABILITIES, CAPABILITY_TEXT, Ledger, TwinNode, createIdentity, verifyCard, type Capability, type Card, type Decision, type Envelope, type Handled, type MsgType, type Outcome, type SharedScene, type StateProvider } from '@/lib/twin-net'
import { checkRelayUrl, connectRelay, type RelayLink } from '@/lib/twin-relay'

// A prototype of the twin network: two twins with their own minds, memory and (simulated) sensors, talking through a signed and encrypted agent-to-agent layer,
// under a permission policy, with every message and decision written to a hash-chained provenance ledger. Everything runs in this tab: keys live in memory only,
// nothing is sent anywhere and nothing is saved. Only words can be shared, never numbers.

const noDigits = (s: string) => s.replace(/\d+(\.\d+)?%?/g, 'some')
const word = (v: number) => (v < 0.18 ? 'far below usual' : v < 0.38 ? 'below usual' : v < 0.62 ? 'near usual' : v < 0.82 ? 'above usual' : 'far above usual')
type Mood = 'typical' | 'stressed' | 'sleepy'
const MOOD: Record<Mood, { cortisol: MindInputs['cortisol']; melatonin: MindInputs['melatonin'] }> = { typical: { cortisol: 'typical', melatonin: 'low' }, stressed: { cortisol: 'high', melatonin: 'low' }, sleepy: { cortisol: 'low', melatonin: 'high' } }

interface Sim { mind: Mind; inner: InnerLife; mood: Mood; visitor: boolean; notes: string[] }
interface Net { a: TwinNode; b: TwinNode; ledger: Ledger; sims: { a: Sim; b: Sim } }

const OUTCOME_TONE: Record<Outcome, string> = {
  delivered: 'text-muted', answered: 'text-ok', asked: 'text-warn', 'denied-by-policy': 'text-bad', 'denied-by-owner': 'text-bad',
  'bad-signature': 'text-bad', 'bad-card': 'text-bad', replay: 'text-bad', undecryptable: 'text-bad', invalid: 'text-bad',
}

function provider(sim: Sim): StateProvider {
  return {
    status: () => { const s = sim.mind.snapshot(), i = sim.inner.snapshot(); return { emotion: s.emotion, intent: verbIng(s.intent), aware: i.aware ? noDigits(i.aware) : null } },
    presence: () => ({ someone: sim.visitor, moving: sim.visitor ? sim.mind.snapshot().affect.arousal > 0.6 : false }),
    vitals: () => { const a = sim.mind.snapshot().affect; return { arousal: word(a.arousal), energy: word(a.energy), stress: word(a.stress), tiredness: word(a.fatigue) } },
    memory: () => sim.inner.episodes.slice(-3).map((e) => noDigits(e.text)),
    answer: (q) => noDigits(sim.inner.introspect(q)?.text ?? `I feel ${sim.mind.snapshot().emotion} and I am ${verbIng(sim.mind.snapshot().intent)}. That is all I can say about that.`),
    notice: (t) => { sim.notes.unshift(t); sim.notes.length = Math.min(sim.notes.length, 6); sim.inner.notice(t) },
    scene: (sc, sender) => { const t = `${sender} pictures ${sc.words.join(', ')}.`; sim.notes.unshift(t); sim.notes.length = Math.min(sim.notes.length, 6); sim.inner.notice(t); return 'scene noted' },
  }
}

export default function TwinNetworkPanel({ scene }: { scene?: SharedScene | null }) {
  const [net, setNet] = useState<Net | null>(null)
  const netRef = useRef<Net | null>(null)
  const [tick, setTick] = useState(0)
  const [auto, setAuto] = useState(false)
  const [verdict, setVerdict] = useState('')
  const [question, setQuestion] = useState('How are you really doing?')
  const [lastCt, setLastCt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // the transport to twins on other computers (through a relay); Twin A is the one that connects
  const [relayUrl, setRelayUrl] = useState('ws://127.0.0.1:8790')
  const [relayState, setRelayState] = useState<'off' | 'connecting' | 'live' | 'closed' | 'error'>('off')
  const [relayNote, setRelayNote] = useState('')
  useConnectionReport('relay', { status: relayState === 'closed' ? 'off' : relayState, detail: relayState === 'live' ? 'Twin A is connected' : relayState === 'error' ? relayNote : '', lastAt: null })
  const [remotes, setRemotes] = useState<Card[]>([])
  const [pasted, setPasted] = useState('')
  const relay = useRef<RelayLink | null>(null)

  const build = useCallback(async () => {
    const ledger = new Ledger()
    const sims = { a: { mind: new Mind(11), inner: new InnerLife(11), mood: 'typical' as Mood, visitor: false, notes: [] as string[] }, b: { mind: new Mind(29), inner: new InnerLife(29), mood: 'stressed' as Mood, visitor: true, notes: [] as string[] } }
    const [ia, ib] = await Promise.all([createIdentity('Twin A'), createIdentity('Twin B')])
    const a = new TwinNode(ia, provider(sims.a), ledger), b = new TwinNode(ib, provider(sims.b), ledger)
    await a.addPeer(b.card); await b.addPeer(a.card)
    netRef.current = { a, b, ledger, sims }; setNet(netRef.current); setVerdict(''); setLastCt('')
  }, [])
  useEffect(() => { const t = setTimeout(() => void build().catch(() => setErr('This browser cannot do the cryptography the prototype needs (WebCrypto with P-256).')), 0); return () => clearTimeout(t) }, [build])

  // both twins live their own lives while the page is open
  useEffect(() => {
    const id = setInterval(() => {
      const n = netRef.current; if (!n) return
      const d = new Date(), hour = d.getHours() + d.getMinutes() / 60
      for (const sim of [n.sims.a, n.sims.b]) {
        const inputs: MindInputs = { hour, ...MOOD[sim.mood], eeg: null, heartBpm: null, occupant: sim.visitor ? { present: true, motion: 0.3 } : null }
        const s = sim.mind.step(0.1, inputs, sim.inner.biases())
        sim.inner.step(0.1, s, { t: performance.now() / 1000, exertion: ['jog', 'run'].includes(s.intent) ? 0.8 : 0, heart: 70, scenario: 'healthy', cortisol: MOOD[sim.mood].cortisol, melatonin: MOOD[sim.mood].melatonin, occupant: sim.visitor ? { present: true, motion: 0.3, simulated: true } : null })
      }
    }, 100)
    const ui = setInterval(() => setTick((x) => x + 1), 700)
    return () => { clearInterval(id); clearInterval(ui) }
  }, [])

  const deliver = useCallback(async (from: 'a' | 'b', type: Exclude<MsgType, 'response' | 'denied'>, payload: unknown = {}) => {
    const n = netRef.current; if (!n) return
    const [src, dst] = from === 'a' ? [n.a, n.b] : [n.b, n.a]
    setBusy(true); setErr('')
    try {
      const env: Envelope = await src.request(dst.me.id, type, payload)
      setLastCt(env.ct.slice(0, 56) + '…')
      const got: Handled = await dst.receive(env)
      if (got.response) { setLastCt(got.response.ct.slice(0, 56) + '…'); await src.receive(got.response) }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send.') }
    setBusy(false); setTick((x) => x + 1)
  }, [])

  const resolve = useCallback(async (who: 'a' | 'b', id: string, allow: boolean) => {
    const n = netRef.current; if (!n) return
    const [me, other] = who === 'a' ? [n.a, n.b] : [n.b, n.a]
    const got = await me.resolve(id, allow)
    if (got.response) { setLastCt(got.response.ct.slice(0, 56) + '…'); await other.receive(got.response) }
    setTick((x) => x + 1)
  }, [])

  useEffect(() => {
    if (!auto) return
    const id = setInterval(() => { void deliver('a', 'status.request'); setTimeout(() => void deliver('b', 'status.request'), 1500) }, 12_000)
    return () => clearInterval(id)
  }, [auto, deliver])

  const relayDeliver = useCallback(async (env: Envelope) => {
    const n = netRef.current; if (!n) return
    const got = await n.a.receive(env)
    if (got.response) relay.current?.send(got.response)
    setTick((x) => x + 1)
  }, [])
  const connect = () => {
    const n = netRef.current; if (!n) return
    relay.current?.close()
    const bad = checkRelayUrl(relayUrl); if (bad) { setRelayState('error'); setRelayNote(bad); return }
    relay.current = connectRelay(relayUrl, n.a.me, (env) => void relayDeliver(env), (s, d) => { setRelayState(s); setRelayNote(d ?? '') })
  }
  const disconnect = () => { relay.current?.close(); relay.current = null; setRelayState('off'); setRelayNote('') }
  useEffect(() => () => { relay.current?.close() }, [])
  const addRemote = async () => {
    const n = netRef.current; if (!n) return
    try {
      const card = JSON.parse(pasted) as Card
      if (!(await verifyCard(card))) { setRelayNote('That card is not valid (its keys and signature do not match).'); return }
      if (!(await n.a.addPeer(card))) { setRelayNote('That card could not be added (it may be this twin\u2019s own).'); return }
      setRemotes((r) => [...r.filter((c) => c.id !== card.id), card]); setPasted(''); setRelayNote(`Added ${card.name}.`)
    } catch { setRelayNote('Paste the whole card (the JSON from the other twin\u2019s card file).') }
  }
  const askRemote = async (peerId: string, type: Exclude<MsgType, 'response' | 'denied'>, payload: unknown = {}) => {
    const n = netRef.current; if (!n || !relay.current) return
    try { relay.current.send(await n.a.request(peerId, type, payload)); setTick((x) => x + 1) } catch (e) { setRelayNote(e instanceof Error ? e.message : 'Could not send.') }
  }

  // changes to a twin go through these handlers (the simulation objects live outside React state)
  const setMood = (who: 'a' | 'b', mood: Mood) => { const n = netRef.current; if (!n) return; n.sims[who].mood = mood; setTick((x) => x + 1) }
  const setVisitor = (who: 'a' | 'b', on: boolean) => { const n = netRef.current; if (!n) return; n.sims[who].visitor = on; setTick((x) => x + 1) }
  const setPolicy = (who: 'a' | 'b', cap: Capability, d: Decision) => { const n = netRef.current; if (!n) return; const [me, other] = who === 'a' ? [n.a, n.b] : [n.b, n.a]; me.policyFor(other.me.id)[cap] = d; setTick((x) => x + 1) }

  const verify = async () => { const n = netRef.current; if (!n) return; const bad = await n.ledger.verify(); setVerdict(bad === null ? `Chain intact: all ${n.ledger.entries.length} entries link and hash correctly.` : `Chain BROKEN at entry ${bad}: that entry (or an earlier one) was changed.`) }
  const tamper = () => { const n = netRef.current; if (!n || n.ledger.entries.length < 2) return; const i = Math.floor(n.ledger.entries.length / 2); n.ledger.entries[i] = { ...n.ledger.entries[i], outcome: n.ledger.entries[i].outcome === 'answered' ? 'denied-by-policy' : 'answered' }; setVerdict(`Entry ${i} was edited in memory (demo). Press "Verify" to see it found.`); setTick((x) => x + 1) }

  void tick
  if (err && !net) return <p className="text-xs text-bad">{err}</p>
  if (!net) return <p className="text-xs text-muted">Creating two twins and their keys…</p>
  const name = (id: string) => (id === net.a.me.id ? 'A' : id === net.b.me.id ? 'B' : (remotes.find((c) => c.id === id)?.name ?? id.slice(0, 4)))
  const sel = 'rounded border border-line bg-canvas px-1 py-0.5 text-xs'
  const btn = 'text-xs rounded-md border border-line px-2.5 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50'

  const card = (who: 'a' | 'b') => {
    const me = who === 'a' ? net.a : net.b, other = who === 'a' ? net.b : net.a, sim = who === 'a' ? net.sims.a : net.sims.b
    const s = sim.mind.snapshot(), i = sim.inner.snapshot(), pol = me.policyFor(other.me.id)
    return (
      <div className="rounded-md border border-line p-3 space-y-2 text-xs min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-sm">{me.me.name}</span><span className="font-mono text-muted">id {me.me.id}</span></div>
        <p>Feels <strong>{s.emotion}</strong>, {verbIng(s.intent)}. <span className="text-muted">Aware of: {i.aware ? noDigits(i.aware) : 'nothing in particular'}</span></p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1">Hormones <select className={sel} value={sim.mood} onChange={(e) => setMood(who, e.target.value as Mood)}><option value="typical">typical</option><option value="stressed">stressed</option><option value="sleepy">sleepy</option></select></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={sim.visitor} onChange={(e) => setVisitor(who, e.target.checked)} /> a visitor is in my room</label>
        </div>
        <details>
          <summary className="cursor-pointer text-muted">What I allow {other.me.name} to ask me (policy)</summary>
          <ul className="mt-1 space-y-1">{CAPABILITIES.map((c: Capability) => (
            <li key={c} className="flex flex-wrap items-center gap-2"><select className={sel} value={pol[c]} aria-label={`${c} policy`} onChange={(e) => setPolicy(who, c, e.target.value as Decision)}><option>allow</option><option>ask</option><option>deny</option></select><span><strong>{c}</strong>: {CAPABILITY_TEXT[c]}</span></li>
          ))}</ul>
        </details>
        {me.pending.length > 0 && (
          <div className="rounded border border-warn/40 p-2 space-y-1">{me.pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2"><span>{name(p.from)} asks for <strong>{p.capability}</strong>.</span><button className={btn} onClick={() => void resolve(who, p.id, true)}>Allow once</button><button className={btn} onClick={() => void resolve(who, p.id, false)}>Refuse</button></div>
          ))}</div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted">Ask {other.me.name}:</span>
          {(['status.request', 'presence.request', 'vitals.request', 'memory.request'] as const).map((t) => <button key={t} className={btn} disabled={busy} onClick={() => void deliver(who, t)}>{t.split('.')[0]}</button>)}
          <button className={btn} disabled={busy || !scene} title={scene ? `Share: ${scene.words.join(', ')}` : 'Use a scene in the Wormhole panel first'} onClick={() => scene && void deliver(who, 'scene.share', scene)}>share wormhole scene</button>
        </div>
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void deliver(who, 'question.ask', { question: question.slice(0, 200) }) }}>
          <input className="flex-1 min-w-0 rounded border border-line bg-canvas px-2 py-1" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label={`Question from ${me.me.name}`} maxLength={200} />
          <button className={btn} disabled={busy}>Ask</button>
        </form>
        {sim.notes.length > 0 && <ul className="list-disc pl-4 text-muted space-y-0.5">{sim.notes.slice(0, 4).map((x, k) => <li key={k}>{x}</li>)}</ul>}
      </div>
    )
  }

  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold">Twin network (prototype): two twins talking</h3>
      <p className="text-xs text-muted">
        Each twin has its own identity (a signing key and a key-agreement key), its own mind and memory, and (simulated) sensors. They exchange messages that are signed and encrypted, a permission policy decides what each will tell the other
        (only words, never numbers; raw sensor data cannot be asked for at all), and every message and decision goes into a hash-chained provenance ledger either side can verify. The two twins here live in this tab and their keys exist only in memory. Twin A can also join a relay to talk to twins on other computers (below); only signed, encrypted envelopes ever leave the tab.
        This is a prototype of the design, not a finished or audited protocol.
      </p>
      <div className="grid md:grid-cols-2 gap-3">{card('a')}{card('b')}</div>
      <details className="rounded-md border border-line p-3 text-xs space-y-2">
        <summary className="cursor-pointer font-medium">Twins on other computers (via a relay)</summary>
        <p className="text-muted">Twin A can join a relay and talk to twins running on other computers (a MicroPython node on Windows, Linux or macOS, or another browser). Start a relay with <code className="font-mono">start-twinnet.ps1 -Relay</code>, start a node with <code className="font-mono">-Node</code>, then swap cards. From this https page the browser only allows <code className="font-mono">ws://127.0.0.1</code>; a relay on another computer must be behind TLS (<code className="font-mono">wss://</code>). The relay sees who talks to whom, never what is said.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="rounded border border-line bg-canvas px-2 py-1 font-mono w-64" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} aria-label="Relay address" />
          {relayState === 'live' || relayState === 'connecting' ? <button className={btn} onClick={disconnect}>Disconnect</button> : <button className={btn} onClick={connect}>Connect Twin A</button>}
          <span className="text-muted">{relayState === 'live' ? 'connected' : relayState === 'connecting' ? 'connecting…' : relayState === 'closed' ? 'connection closed' : relayState === 'error' ? 'problem' : 'not connected'}</span>
        </div>
        {relayNote && <p className="text-muted">{relayNote}</p>}
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">Twin A&apos;s card (copy this to the other twin)<textarea readOnly value={JSON.stringify(net.a.card)} rows={4} className="w-full rounded border border-line bg-canvas px-2 py-1 font-mono" onFocus={(e) => e.currentTarget.select()} /></label>
          <label className="block">Add a remote twin: paste its card<textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} className="w-full rounded border border-line bg-canvas px-2 py-1 font-mono" /></label>
        </div>
        <button className={btn} disabled={!pasted.trim()} onClick={() => void addRemote()}>Add this twin</button>
        {remotes.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-1.5 rounded border border-line p-2"><span><strong>{c.name}</strong> <span className="font-mono text-muted">{c.id}</span></span>
            <span className="text-muted">Ask:</span>{(['status.request', 'presence.request', 'vitals.request', 'memory.request'] as const).map((t) => <button key={t} className={btn} disabled={relayState !== 'live'} onClick={() => void askRemote(c.id, t)}>{t.split('.')[0]}</button>)}
            <button className={btn} disabled={relayState !== 'live'} onClick={() => void askRemote(c.id, 'question.ask', { question: question.slice(0, 200) })}>question</button>
            <button className={btn} disabled={relayState !== 'live' || !scene} title={scene ? `Share: ${scene.words.join(', ')}` : 'Use a scene in the Wormhole panel first'} onClick={() => scene && void askRemote(c.id, 'scene.share', scene)}>share scene</button></div>
        ))}
      </details>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> let them check on each other every 12 seconds</label>
        <button className={btn} onClick={() => void verify()}>Verify provenance chain</button>
        <button className={btn} onClick={tamper}>Tamper with an entry (demo)</button>
        <button className={btn} onClick={() => void build()}>New twins</button>
      </div>
      {verdict && <p role="status" className={`text-xs ${verdict.includes('BROKEN') ? 'text-bad' : 'text-ok'}`}>{verdict}</p>}
      {err && <p className="text-xs text-bad">{err}</p>}
      {lastCt && <p className="text-xs text-muted">Last message on the wire (ciphertext, nothing readable): <code className="font-mono break-all">{lastCt}</code></p>}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-xs">
          <thead className="text-muted text-left"><tr><th className="p-2">#</th><th className="p-2">From → to</th><th className="p-2">Message</th><th className="p-2">Outcome</th><th className="p-2">Entry hash</th></tr></thead>
          <tbody>
            {net.ledger.entries.length === 0 && <tr><td className="p-2 text-muted" colSpan={5}>Nothing yet. Press one of the Ask buttons.</td></tr>}
            {net.ledger.entries.slice().reverse().slice(0, 14).map((e) => (
              <tr key={e.seq} className="border-t border-line"><td className="p-2 font-mono">{e.seq}</td><td className="p-2">{name(e.from)} → {name(e.to)}</td><td className="p-2">{e.kind}</td><td className={`p-2 ${OUTCOME_TONE[e.outcome]}`}>{e.outcome}</td><td className="p-2 font-mono text-muted">{e.hash.slice(0, 12)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Built: transport between computers through a relay, and MicroPython nodes (see research-agents/docs/twin-network-protocol.md). Not built yet: an agent kernel per twin beyond these minds, a relay hosted with TLS for the internet, and card introduction other than copying the card.</p>
    </div>
  )
}
