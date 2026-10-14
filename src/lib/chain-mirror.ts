import { pad, publicEvent, type LedgerEvent } from './chain-ledger.ts'

// A second store for the ledger, so the data does not live only in Supabase. Best effort and non-blocking:
// a mirror failure never blocks a write (the Supabase ledger is authoritative; the mirror is the safety copy).

export interface ChainMirror {
  readonly name: string
  put(events: LedgerEvent[]): Promise<void>
  /** Events with seq greater than `since`, ascending. */
  list(since: number): Promise<LedgerEvent[]>
}

/** Default when no bucket is bound: does nothing. */
export const noopMirror: ChainMirror = { name: 'none', async put() {}, async list() { return [] } }

// The slice of the Cloudflare R2 binding this file uses.
export interface R2Like {
  put(key: string, value: string): Promise<unknown>
  get(key: string): Promise<{ text(): Promise<string> } | null>
  list(o: { prefix: string; startAfter?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>
}

const PREFIX = 'chain/'
const keyOf = (seq: number) => `${PREFIX}${pad(seq)}.json`

/** R2 implementation: one small JSON object per event, keyed by zero-padded seq. Re-putting an event is harmless (same bytes). */
export function r2Mirror(bucket: R2Like): ChainMirror {
  return {
    name: 'r2',
    async put(events) {
      await Promise.all(events.map((e) => bucket.put(keyOf(e.seq), JSON.stringify(e))))
    },
    async list(since) {
      const out: LedgerEvent[] = []
      let cursor: string | undefined
      do {
        const page = await bucket.list({ prefix: PREFIX, startAfter: since > 0 ? keyOf(since) : undefined, cursor, limit: 500 })
        const got = await Promise.all(page.objects.map(async (o) => { const b = await bucket.get(o.key); return b ? (JSON.parse(await b.text()) as LedgerEvent) : null }))
        for (const e of got) if (e) out.push(e)
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      return out.sort((a, b) => a.seq - b.seq)
    },
  }
}

/** Fire and forget: errors are swallowed (logged), never thrown. */
export function mirrorBestEffort(mirror: ChainMirror, events: LedgerEvent[]): void {
  if (!events.length || mirror === noopMirror) return
  void mirror.put(events).catch((e) => console.warn('chain mirror failed', e instanceof Error ? e.message.slice(0, 200) : 'error'))
}

/** What the mirror may hold is exactly what the public may read. */
export const mirrorable = (events: LedgerEvent[]) => events.map(publicEvent).filter((e): e is LedgerEvent => e !== null)

/** The mirror for a Workers env: the `CHAIN_MIRROR` R2 binding (bucket rabbitos-chain-mirror, declared in cloudflare.config.ts) when it
 *  looks like a bucket, else the no-op (local development, Node, Cloud Run). */
export function mirrorFromEnv(env: Record<string, unknown> | undefined): ChainMirror {
  const b = env?.CHAIN_MIRROR as Partial<R2Like> | undefined
  return b && typeof b.put === 'function' && typeof b.get === 'function' && typeof b.list === 'function' ? r2Mirror(b as R2Like) : noopMirror
}
