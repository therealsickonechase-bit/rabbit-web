// Pure helpers for the PUBLIC chain ledger: the explorer page, GET /api/chain/head, and the in-browser verifier.
// The hashing is not duplicated here: verification calls verifyChain() from chain-ledger.ts, the same code the server and
// scripts use (it runs on WebCrypto, which browsers, Workers and Node all have). No imports besides that file.
import { GENESIS_HEAD, publicEvent, verifyChain, type Head, type LedgerEvent } from './chain-ledger.ts'

export interface HeadInfo { length: number; headHash: string; updatedAt: string | null }

export const headInfo = (head: Head, updatedAt: string | null): HeadInfo => ({ length: head.seq, headHash: head.hash, updatedAt })

export interface LedgerSummary extends HeadInfo {
  genesis: string
  firstHash: string | null
  counts: Record<string, number>
  latest: LedgerEvent[]
}

/** Latest events for display: newest first, re-sanitised through the same public filter as the API. */
export const latestPublic = (events: LedgerEvent[], n = 50) =>
  [...events].sort((a, b) => b.seq - a.seq).map(publicEvent).filter((e): e is LedgerEvent => e !== null).slice(0, n)

/** Small in-memory fixed-window limiter, per key. Best effort (one per Worker isolate), meant to blunt scraping, not to be a hard quota. */
export function createLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  return (key: string): boolean => {
    const t = now()
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs)
    if (recent.length >= max) { hits.set(key, recent); return false }
    recent.push(t)
    hits.set(key, recent)
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k)
    return true
  }
}

/** Who is calling, for rate limiting only (never stored or shown). */
export const clientKey = (h: { get(name: string): string | null }) =>
  (h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0] ?? 'anon').trim().slice(0, 64)

export type RemoteVerdict =
  | { ok: true; count: number; head: Head }
  | { ok: false; seq: number; reason: string }

/** Pulls pages with `fetchPage(since)` until one is empty and verifies the whole chain from genesis, page by page.
 *  Used by the browser button; takes the fetcher as an argument so it can be tested without a network. */
export async function verifyRemote(
  fetchPage: (since: number) => Promise<LedgerEvent[]>,
  onProgress: (checked: number) => void = () => {},
  maxPages = 10_000,
): Promise<RemoteVerdict> {
  let head: Head = GENESIS_HEAD
  let count = 0
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(head.seq)
    if (!page.length) return { ok: true, count, head }
    const v = await verifyChain(page, head)
    if (!v.ok) return v
    head = v.head
    count += v.count
    onProgress(count)
  }
  return { ok: false, seq: head.seq, reason: 'too many pages' }
}

/** The command that mirrors this chain to a file on your own machine (verifies as it goes, refuses a broken chain). */
export const mirrorCommand = (origin: string) =>
  `python chain_pull.py --url ${origin.replace(/\/$/, '')} --out chain_ledger_local.jsonl`

/** For the RabbitOS CloudShell (needs an approved shell.execute grant): reads the public ledger, full payloads, one JSON page per call. */
export const cloudshellCommand = (origin: string) =>
  `curl -fsS "${origin.replace(/\/$/, '')}/api/chain/ledger?since=0" | head -c 60000`

/** Same thing with the repo's Node script, for anyone with the rabbit-web checkout. */
export const mirrorCommandNode = (origin: string) =>
  `node scripts/chain-export.mjs export ${origin.replace(/\/$/, '')} chain_ledger_local.jsonl`
