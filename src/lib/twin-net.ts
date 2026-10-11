// A prototype of the "twin network" in the architecture diagram: digital twins that talk to each other through an agent-to-agent (A2A) layer with
//   identity + encryption   each twin has its own signing key and key-agreement key, publishes a self-signed card, and every message is signed and encrypted
//   policy / permissions    each twin decides, per peer and per capability, what it will tell the other: allow, ask me first, or deny. Raw sensor numbers are not
//                           a capability at all: only words about mood, activity, presence and levels can ever be shared
//   provenance chain        every message and every decision is written to a hash-chained ledger that either side can verify
// The prototype runs inside one page (no server, no network): keys live in memory and are never saved. It uses the browser's standard WebCrypto primitives
// (ECDSA P-256, ECDH P-256, HKDF, AES-GCM, SHA-256). It has not been security-audited and is not a finished protocol. A self-signed card proves that a message
// came from the holder of that key, not who the holder is in the real world.

export const CAPABILITIES = ['status', 'presence', 'vitals', 'memory', 'question', 'scene'] as const
export type Capability = (typeof CAPABILITIES)[number]
export type Decision = 'allow' | 'ask' | 'deny'
export type Policy = Record<Capability, Decision>

export const DEFAULT_POLICY: Policy = { status: 'allow', presence: 'ask', vitals: 'deny', memory: 'ask', question: 'allow', scene: 'ask' }
export const CAPABILITY_TEXT: Record<Capability, string> = {
  status: 'my mood word, what I am doing and what I am aware of',
  presence: 'whether I sense someone in my room, and whether they move',
  vitals: 'level words for my arousal, energy, stress and tiredness (never numbers)',
  memory: 'a few strong moments I remember, in words',
  question: 'an answer about myself when asked',
  scene: 'a scene to picture, as a few words',
}

export const CONFIDENCE_WORDS = ['none', 'weak', 'plausible', 'strong'] as const
export const MAX_SCENE_WORDS = 8
export interface SharedScene { words: string[]; mood: string; confidence: (typeof CONFIDENCE_WORDS)[number] }
const wordOk = (w: unknown): w is string => typeof w === 'string' && /^[a-z][a-z\- ]{0,23}$/.test(w)

/** A scene shared by a peer, reduced to what is safe to act on: up to 8 lowercase words, a mood word and a confidence word. Null if no words remain. */
export function cleanScene(payload: unknown): SharedScene | null {
  const p = payload as { words?: unknown; mood?: unknown; confidence?: unknown } | null
  if (!p || typeof p !== 'object' || !Array.isArray(p.words)) return null
  const words = [...new Set(p.words.filter(wordOk))].slice(0, MAX_SCENE_WORDS)
  if (!words.length) return null
  return { words, mood: wordOk(p.mood) ? p.mood : '', confidence: (CONFIDENCE_WORDS as readonly unknown[]).includes(p.confidence) ? (p.confidence as SharedScene['confidence']) : 'none' }
}

const enc = new TextEncoder(), dec = new TextDecoder()
const b64 = (b: ArrayBuffer | Uint8Array) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const unb64 = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); const r = atob(t), u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u }
const bytes = (u: Uint8Array) => u as unknown as BufferSource

/** JSON with sorted keys, so the same data always gives the same bytes (what gets signed and hashed). */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
}
export async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// ---- identity -------------------------------------------------------------------------------------------------------------------------------
type Jwk = { x: string; y: string }
export interface Card { v: 1; name: string; id: string; sign: Jwk; dh: Jwk; issued: string; sig: string }
export interface Identity { name: string; id: string; signPriv: CryptoKey; signPub: CryptoKey; dhPriv: CryptoKey; card: Card }

const importPub = async (j: Jwk, alg: 'ECDSA' | 'ECDH', usage: KeyUsage[]) => crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, ext: true }, { name: alg, namedCurve: 'P-256' }, true, usage)
const xy = async (k: CryptoKey): Promise<Jwk> => { const j = await crypto.subtle.exportKey('jwk', k); return { x: String(j.x), y: String(j.y) } }
const cardBody = (c: Omit<Card, 'sig'>) => canonical({ v: c.v, name: c.name, id: c.id, sign: c.sign, dh: c.dh, issued: c.issued })

export async function createIdentity(name: string, now = new Date()): Promise<Identity> {
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const signJ = await xy(sign.publicKey), dhJ = await xy(dh.publicKey)
  const id = (await sha256(canonical([signJ, dhJ]))).slice(0, 16)
  const body = { v: 1 as const, name: name.slice(0, 40), id, sign: signJ, dh: dhJ, issued: now.toISOString() }
  const sig = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sign.privateKey, enc.encode(cardBody(body))))
  return { name: body.name, id, signPriv: sign.privateKey, signPub: sign.publicKey, dhPriv: dh.privateKey, card: { ...body, sig } }
}

/** A card is valid if its id matches its keys and its self-signature checks out. */
export async function verifyCard(c: Card): Promise<boolean> {
  try {
    if (c.v !== 1 || typeof c.name !== 'string' || c.name.length > 40 || !/^[0-9a-f]{16}$/.test(c.id)) return false
    if ((await sha256(canonical([c.sign, c.dh]))).slice(0, 16) !== c.id) return false
    const pub = await importPub(c.sign, 'ECDSA', ['verify'])
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, bytes(unb64(c.sig)), enc.encode(cardBody(c)))
  } catch { return false }
}

// ---- the provenance ledger ----------------------------------------------------------------------------------------------------------------
export type Outcome = 'delivered' | 'answered' | 'asked' | 'denied-by-policy' | 'denied-by-owner' | 'bad-signature' | 'bad-card' | 'replay' | 'undecryptable' | 'invalid'
export interface LedgerEntry { seq: number; ts: number; from: string; to: string; kind: string; outcome: Outcome; envelope: string; prev: string; hash: string }

export class Ledger {
  entries: LedgerEntry[] = []
  async append(e: Omit<LedgerEntry, 'seq' | 'prev' | 'hash'>): Promise<LedgerEntry> {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : '0'.repeat(64)
    const body = { seq: this.entries.length, ...e, prev }
    const entry = { ...body, hash: await sha256(canonical(body)) }
    this.entries.push(entry)
    return entry
  }
  /** Re-check every link. Returns the index of the first bad entry, or null if the chain is intact. */
  async verify(): Promise<number | null> {
    let prev = '0'.repeat(64)
    for (let i = 0; i < this.entries.length; i++) {
      const { hash, ...body } = this.entries[i]
      if (body.prev !== prev || body.seq !== i || (await sha256(canonical(body))) !== hash) return i
      prev = hash
    }
    return null
  }
}

// ---- envelopes ---------------------------------------------------------------------------------------------------------------------------
export type MsgType = 'status.request' | 'presence.request' | 'vitals.request' | 'memory.request' | 'question.ask' | 'scene.share' | 'response' | 'denied'
const REQUEST_CAPABILITY: Record<string, Capability> = { 'status.request': 'status', 'presence.request': 'presence', 'vitals.request': 'vitals', 'memory.request': 'memory', 'question.ask': 'question', 'scene.share': 'scene' }
export interface Header { v: 1; id: string; from: string; to: string; type: MsgType; ts: number; seq: number; re?: string }
export interface Envelope { h: Header; iv: string; ct: string; sig: string }

/** What a twin can tell another: words only. Anything with a digit is refused before it is sent. */
export interface StateProvider {
  status(): { emotion: string; intent: string; aware: string | null }
  presence(): { someone: boolean | null; moving: boolean | null }
  vitals(): { arousal: string; energy: string; stress: string; tiredness: string }
  memory(): string[]
  answer(question: string): string
  /** the twin notices something said to it or learned from a peer */
  notice?(text: string): void
  /** a peer shared a scene (words only, already cleaned); act on it and return a few words for the sender */
  scene?(scene: SharedScene, sender: string): string
}
export const noDigits = (v: unknown): boolean => !/\d/.test(JSON.stringify(v))

export interface Pending { id: string; from: string; capability: Capability; type: MsgType; payload: unknown; envelope: Envelope }
export interface Handled { outcome: Outcome; response?: Envelope; pendingId?: string; capability?: Capability }

const MAX_SKEW_MS = 5 * 60_000

export class TwinNode {
  peers = new Map<string, { card: Card; key: CryptoKey; lastSeq: number; sendSeq: number }>()
  policy = new Map<string, Policy>()
  pending: Pending[] = []
  private counter = 0
  readonly me: Identity
  readonly ledger: Ledger
  private state: StateProvider
  private clock: () => number
  constructor(me: Identity, state: StateProvider, ledger: Ledger, clock: () => number = Date.now) { this.me = me; this.state = state; this.ledger = ledger; this.clock = clock }

  get card() { return this.me.card }
  policyFor(peer: string): Policy { let p = this.policy.get(peer); if (!p) { p = { ...DEFAULT_POLICY }; this.policy.set(peer, p) } return p }

  async addPeer(card: Card): Promise<boolean> {
    if (!(await verifyCard(card)) || card.id === this.me.id) return false
    const theirDh = await importPub(card.dh, 'ECDH', [])
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirDh }, this.me.dhPriv, 256)
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
    const ids = [this.me.id, card.id].sort().join('|')
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('rabbitos-twin-net-v1'), info: enc.encode(ids) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    this.peers.set(card.id, { card, key, lastSeq: -1, sendSeq: 0 })
    return true
  }

  private async seal(peerId: string, type: MsgType, payload: unknown, re?: string): Promise<Envelope> {
    const peer = this.peers.get(peerId)
    if (!peer) throw new Error('unknown peer')
    if (!noDigits(payload)) throw new Error('refusing to send numbers: only words may be shared')
    const h: Header = { v: 1, id: `${this.me.id}-${++this.counter}-${this.clock()}`, from: this.me.id, to: peerId, type, ts: this.clock(), seq: peer.sendSeq++, ...(re ? { re } : {}) }
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: enc.encode(canonical(h)) }, peer.key, enc.encode(JSON.stringify(payload))))
    const body = { h, iv: b64(iv), ct: b64(ct) }
    const sig = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.me.signPriv, enc.encode(canonical(body))))
    return { ...body, sig }
  }

  /** Ask a peer for something. Returns the signed, encrypted envelope to deliver to them. */
  async request(peerId: string, type: Exclude<MsgType, 'response' | 'denied'>, payload: unknown = {}): Promise<Envelope> {
    const env = await this.seal(peerId, type, payload)
    await this.ledger.append({ ts: this.clock(), from: this.me.id, to: peerId, kind: type, outcome: 'delivered', envelope: (await sha256(canonical(env))).slice(0, 16) })
    return env
  }

  /** Receive an envelope: check it, apply the policy, and answer, queue it for approval, or refuse. Everything is written to the ledger. */
  async receive(env: Envelope): Promise<Handled> {
    const log = (outcome: Outcome, kind = 'unknown') => this.ledger.append({ ts: this.clock(), from: env?.h?.from ?? '?', to: env?.h?.to ?? '?', kind, outcome, envelope: '' })
    const done = async (outcome: Outcome, kind: string, extra: Partial<Handled> = {}): Promise<Handled> => { const e = await this.ledger.append({ ts: this.clock(), from: env.h.from, to: env.h.to, kind, outcome, envelope: (await sha256(canonical(env))).slice(0, 16) }); void e; return { outcome, ...extra } }
    try {
      if (!env || env.h?.v !== 1 || env.h.to !== this.me.id) { await log('invalid'); return { outcome: 'invalid' } }
      const peer = this.peers.get(env.h.from)
      if (!peer) return done('bad-card', env.h.type)
      const { sig, ...body } = env
      const pub = await importPub(peer.card.sign, 'ECDSA', ['verify'])
      if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, bytes(unb64(sig)), enc.encode(canonical(body))))) return done('bad-signature', env.h.type)
      if (env.h.seq <= peer.lastSeq || Math.abs(this.clock() - env.h.ts) > MAX_SKEW_MS) return done('replay', env.h.type)
      let payload: unknown
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(unb64(env.iv)), additionalData: enc.encode(canonical(env.h)) }, peer.key, bytes(unb64(env.ct)))
        payload = JSON.parse(dec.decode(pt))
      } catch { return done('undecryptable', env.h.type) }
      peer.lastSeq = env.h.seq

      if (env.h.type === 'response' || env.h.type === 'denied') {
        this.state.notice?.(env.h.type === 'denied' ? `${peer.card.name} declined to share that with me.` : `${peer.card.name} told me: ${summarise(payload)}`)
        return done('delivered', env.h.type)
      }
      const capability = REQUEST_CAPABILITY[env.h.type]
      if (!capability) return done('invalid', env.h.type)
      const decision = this.policyFor(env.h.from)[capability]
      if (decision === 'deny') { const r = await this.seal(env.h.from, 'denied', { reason: 'policy' }, env.h.id); await done('denied-by-policy', env.h.type, { capability }); return { outcome: 'denied-by-policy', response: r, capability } }
      if (decision === 'ask') {
        const id = `p${++this.counter}`
        this.pending.push({ id, from: env.h.from, capability, type: env.h.type, payload, envelope: env })
        this.state.notice?.(capability === 'scene' ? `${peer.card.name} wants to share a scene with me. I will decide.` : `${peer.card.name} is asking for ${CAPABILITY_TEXT[capability]}. I will decide.`)
        return done('asked', env.h.type, { pendingId: id, capability })
      }
      return await this.answerRequest(env, capability, payload)
    } catch { return { outcome: 'invalid' } }
  }

  private async answerRequest(env: Envelope, capability: Capability, payload: unknown): Promise<Handled> {
    const out = this.collect(capability, payload, env.h.from)
    const r = await this.seal(env.h.from, 'response', out, env.h.id)
    await this.ledger.append({ ts: this.clock(), from: env.h.to, to: env.h.from, kind: `${env.h.type}`, outcome: 'answered', envelope: (await sha256(canonical(env))).slice(0, 16) })
    return { outcome: 'answered', response: r, capability }
  }

  private collect(capability: Capability, payload: unknown, from: string): unknown {
    switch (capability) {
      case 'scene': {
        const sc = cleanScene(payload)
        if (!sc) return { received: 'nothing usable' }
        const sender = this.peers.get(from)?.card.name ?? 'a peer'
        return { received: (this.state.scene ? this.state.scene(sc, sender) : 'scene noted').slice(0, 60) }
      }
      case 'status': return this.state.status()
      case 'presence': return this.state.presence()
      case 'vitals': return this.state.vitals()
      case 'memory': return { moments: this.state.memory().slice(0, 3) }
      case 'question': return { answer: this.state.answer(String((payload as { question?: unknown })?.question ?? '').slice(0, 300)) }
    }
  }

  /** The owner of this twin answers a request that policy said to ask about. */
  async resolve(pendingId: string, allow: boolean): Promise<Handled> {
    const i = this.pending.findIndex((p) => p.id === pendingId)
    if (i < 0) return { outcome: 'invalid' }
    const [p] = this.pending.splice(i, 1)
    if (!allow) {
      const r = await this.seal(p.from, 'denied', { reason: 'owner' }, p.envelope.h.id)
      await this.ledger.append({ ts: this.clock(), from: this.me.id, to: p.from, kind: p.type, outcome: 'denied-by-owner', envelope: (await sha256(canonical(p.envelope))).slice(0, 16) })
      return { outcome: 'denied-by-owner', response: r, capability: p.capability }
    }
    return this.answerRequest(p.envelope, p.capability, p.payload)
  }
}

function summarise(p: unknown): string {
  if (!p || typeof p !== 'object') return String(p)
  const o = p as Record<string, unknown>
  if (typeof o.answer === 'string') return o.answer
  if (typeof o.received === 'string') return `it replied: ${o.received}`
  if (Array.isArray(o.moments)) return (o.moments as string[]).join(' ')
  if (typeof o.emotion === 'string') return `I feel ${o.emotion} and I am ${o.intent}.`
  if ('someone' in o) return o.someone ? 'someone is in the room' : o.someone === false ? 'the room is empty' : 'I cannot tell if anyone is there'
  return Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ')
}
