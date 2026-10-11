// The browser's side of the twin-network transport: connect a twin to a relay (research-agents: python -m twinnet.relay), prove it holds its card's key, and
// carry signed, encrypted envelopes to and from twins on other computers. The relay sees only who talks to whom, never what is said.
//
// From an https page the browser only allows ws:// to this computer (127.0.0.1 / localhost). To reach a relay on another computer, put the relay behind TLS
// and use a wss:// address. The page never sends a private key anywhere: the proof is a signature made in the browser.

import type { Envelope, Identity } from './twin-net.ts'

const b64u = (b: ArrayBuffer) => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }

/** ws:// only to this computer; wss:// anywhere. Returns an error message, or null if the address is acceptable. */
export function checkRelayUrl(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return 'That is not a web address.' }
  if (u.protocol === 'wss:') return null
  if (u.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return null
  return 'Use ws://127.0.0.1:PORT for a relay on this computer, or wss:// for a relay behind TLS.'
}

export interface RelayLink { send(env: Envelope): void; close(): void; ready: Promise<void> }

export function connectRelay(url: string, me: Identity, onEnvelope: (env: Envelope) => void, onState: (s: 'connecting' | 'live' | 'closed' | 'error', detail?: string) => void): RelayLink {
  const bad = checkRelayUrl(url)
  if (bad) { onState('error', bad); return { send() {}, close() {}, ready: Promise.reject(new Error(bad)) } }
  let ws: WebSocket
  let resolve!: () => void, reject!: (e: Error) => void
  const ready = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  ready.catch(() => {})
  onState('connecting')
  try { ws = new WebSocket(url) } catch { onState('error', 'Could not open the connection.'); reject(new Error('open')); return { send() {}, close() {}, ready } }
  let stage: 'hello' | 'proof' | 'ready' = 'hello'
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', card: me.card }))
  ws.onmessage = async (ev) => {
    if (typeof ev.data !== 'string' || ev.data.length > 200_000) return
    let m: { t?: string; nonce?: string; env?: Envelope; reason?: string }
    try { m = JSON.parse(ev.data) } catch { return }
    if (stage === 'hello' && m.t === 'challenge' && typeof m.nonce === 'string') {
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, me.signPriv, new TextEncoder().encode(`relay-auth:${m.nonce}:${me.id}`))
      stage = 'proof'; ws.send(JSON.stringify({ t: 'proof', sig: b64u(sig) }))
    } else if (stage === 'proof' && m.t === 'ready') { stage = 'ready'; onState('live'); resolve() }
    else if (m.t === 'error') { onState('error', `The relay refused this twin (${m.reason ?? 'unknown'}).`); reject(new Error('refused')) }
    else if (stage === 'ready' && m.t === 'msg' && m.env && typeof m.env === 'object') onEnvelope(m.env)
  }
  ws.onerror = () => { onState('error', 'The relay is not reachable. Start it with: python -m twinnet.relay'); reject(new Error('unreachable')) }
  ws.onclose = () => { if (stage === 'ready') onState('closed'); reject(new Error('closed')) }
  return {
    ready,
    send: (env) => { if (ws.readyState === WebSocket.OPEN && stage === 'ready') ws.send(JSON.stringify({ t: 'msg', env })) },
    close: () => ws.close(),
  }
}
