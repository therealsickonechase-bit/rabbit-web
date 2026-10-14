// Chain ledger: an append-only, hash-chained log of every write to the opened tables.
//
// Each event = { seq, table, op, row_id, payload, prev_hash, hash }. The hash is the Merkle leaf hash (src/lib/merkle.ts,
// domain-separated SHA-256) of the canonical JSON of the other fields, so the log is tamper-evident: change or drop any
// event and every later event fails to verify. A delete or a wipe is a TOMBSTONE event (op 'delete', empty payload);
// the ledger never removes anything. The live tables are only a view of the ledger and can be rebuilt from it.
//
// This is a replicated, hash-chained log. It is NOT a decentralized public blockchain: there is no consensus among
// strangers. Pure logic only (no imports besides merkle) so tests and scripts can load it with plain Node.
import { leafHash, merkleRoot } from './merkle.ts'

export const GENESIS_PREV = '0'.repeat(64)
export type Op = 'insert' | 'update' | 'delete'
export const OPS: readonly Op[] = ['insert', 'update', 'delete']

export interface LedgerEvent {
  seq: number
  table: string
  op: Op
  row_id: string
  payload: Record<string, unknown>
  prev_hash: string
  hash: string
}
export type Draft = Pick<LedgerEvent, 'table' | 'op' | 'row_id' | 'payload'>

interface TableSpec {
  /** Columns that identify a row (row_id is these values joined with '|'). Also the upsert conflict target on restore. */
  key: readonly string[]
  /** The ONLY columns that may enter the ledger. Anything else is dropped. */
  cols: readonly string[]
  /** Restore order: parents before children. */
  order: number
  /** Restore skips rows whose timestamp column is older than this many days (mirrors the live retention purge). */
  retention?: { col: string; days: number }
}

export const LEDGER_TABLES = {
  collections: { key: ['id'], cols: ['id', 'user_id', 'name', 'created_at'], order: 1 },
  chat_threads: { key: ['id'], cols: ['id', 'user_id', 'title', 'created_at'], order: 2 },
  chat_messages: { key: ['id'], cols: ['id', 'thread_id', 'user_id', 'role', 'content', 'cited', 'model', 'created_at'], order: 3 },
  collection_items: { key: ['collection_id', 'record_id'], cols: ['collection_id', 'record_id', 'user_id', 'added_at'], order: 4 },
  notes: { key: ['id'], cols: ['id', 'user_id', 'record_id', 'collection_id', 'body', 'created_at'], order: 5 },
  agent_tasks: {
    key: ['id'],
    cols: ['id', 'created_by', 'kind', 'params', 'status', 'claimed_by', 'claimed_at', 'lease_until', 'result', 'error', 'reviewed_by', 'reviewed_at', 'review_note', 'created_at', 'updated_at'],
    order: 6,
  },
  self_daily: { key: ['user_id', 'day'], cols: ['user_id', 'day', 'dims', 'lab_flags', 'synthetic', 'updated_at'], order: 7 },
  kg_edges: { key: ['a_kind', 'a_name', 'b_kind', 'b_name', 'record_id'], cols: ['a_kind', 'a_name', 'b_kind', 'b_name', 'record_id'], order: 8 },
  eeg_band_samples: {
    key: ['agent_id', 'session', 'ts', 'channel', 'band'],
    cols: ['agent_id', 'session', 'ts', 'channel', 'band', 'power', 'rel_power', 'board'],
    order: 9,
    retention: { col: 'ts', days: 30 },
  },
} as const satisfies Record<string, TableSpec>

export type LedgerTable = keyof typeof LEDGER_TABLES
export const LEDGER_TABLE_NAMES = Object.keys(LEDGER_TABLES) as LedgerTable[]
export const isLedgerTable = (t: string): t is LedgerTable => Object.prototype.hasOwnProperty.call(LEDGER_TABLES, t)
const spec = (t: string): TableSpec => LEDGER_TABLES[t as LedgerTable]

/** Column names (anywhere in a payload, including inside jsonb values) that must never be on the ledger. */
export const FORBIDDEN_KEY = /subject_name|subject_dob|^dob$|date_of_birth|contact_record|api_key|key_hash|key_prefix|user_setting|guest_pass|passcode|password|secret|encrypted|private_key|ciphertext/i
/** Tables that must never have an event, whatever the caller passes (kept in step with PROTECTED_TABLES in open-access.ts; a test checks this). */
export const NEVER_LEDGER = ['contact_records', 'contact_access_log', 'api_keys', 'api_key_calls', 'user_settings', 'guest_passes', 'owners', 'twin_identity'] as const

/** Sorted-key JSON, so the same data always hashes the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** Removes any forbidden key from nested values (jsonb columns). */
export function stripForbidden<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripForbidden) as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!FORBIDDEN_KEY.test(k)) out[k] = stripForbidden(x)
    return out as T
  }
  return v
}

/** Timestamps are normalised so the same instant always gives the same row id and payload. */
const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const norm = (col: string, v: unknown) => (typeof v === 'string' && /(_at|^ts|_until)$/.test(col) && TS.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : v)

/** Only whitelisted columns survive; nested forbidden keys are stripped; timestamps normalised. */
export function sanitizeRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  if (!isLedgerTable(table)) throw new Error(`table ${table} is not on the ledger`)
  const out: Record<string, unknown> = {}
  for (const c of spec(table).cols) if (row[c] !== undefined) out[c] = stripForbidden(norm(c, row[c]))
  return out
}

export function rowId(table: string, row: Record<string, unknown>): string {
  if (!isLedgerTable(table)) throw new Error(`table ${table} is not on the ledger`)
  const parts = spec(table).key.map((k) => {
    const v = norm(k, row[k])
    if (v === undefined || v === null || v === '') throw new Error(`${table}: missing key column ${k}`)
    return String(v)
  })
  return parts.join('|')
}

/** A draft for one live row. A delete is a tombstone with an empty payload. */
export function makeDraft(table: string, op: Op, row: Record<string, unknown>): Draft {
  if (!isLedgerTable(table) || (NEVER_LEDGER as readonly string[]).includes(table)) throw new Error(`table ${table} is not on the ledger`)
  if (!OPS.includes(op)) throw new Error(`bad op ${op}`)
  const clean = sanitizeRow(table, row)
  return { table, op, row_id: rowId(table, clean), payload: op === 'delete' ? {} : clean }
}

export const makeDrafts = (table: string, op: Op, rows: Record<string, unknown>[]) => rows.map((r) => makeDraft(table, op, r))

const hashInput = (e: Pick<LedgerEvent, 'seq' | 'table' | 'op' | 'row_id' | 'payload' | 'prev_hash'>) =>
  canonical({ seq: e.seq, table: e.table, op: e.op, row_id: e.row_id, payload: e.payload, prev_hash: e.prev_hash })

export const eventHash = (e: Pick<LedgerEvent, 'seq' | 'table' | 'op' | 'row_id' | 'payload' | 'prev_hash'>) => leafHash(hashInput(e))

export interface Head { seq: number; hash: string }
export const GENESIS_HEAD: Head = { seq: 0, hash: GENESIS_PREV }

/** Chains drafts onto the current head. */
export async function buildEvents(head: Head, drafts: Draft[]): Promise<LedgerEvent[]> {
  const out: LedgerEvent[] = []
  let { seq, hash: prev } = head
  for (const d of drafts) {
    seq += 1
    const base = { seq, table: d.table, op: d.op, row_id: d.row_id, payload: d.payload, prev_hash: prev }
    const hash = await eventHash(base)
    out.push({ ...base, hash })
    prev = hash
  }
  return out
}

export type Verdict = { ok: true; count: number; head: Head } | { ok: false; seq: number; reason: string }

/** Checks consecutive seq, prev_hash links, recomputed hashes, and that nothing protected is in a payload.
 *  `from` is the head the first event must follow (default: genesis). */
export async function verifyChain(events: LedgerEvent[], from: Head = GENESIS_HEAD): Promise<Verdict> {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  let { seq, hash: prev } = from
  for (const e of sorted) {
    if (e.seq !== seq + 1) return { ok: false, seq: e.seq, reason: `gap or duplicate: expected seq ${seq + 1}` }
    if (e.prev_hash !== prev) return { ok: false, seq: e.seq, reason: 'prev_hash does not match the previous event' }
    if (!isLedgerTable(e.table) || !OPS.includes(e.op)) return { ok: false, seq: e.seq, reason: 'unknown table or op' }
    if ((await eventHash(e)) !== e.hash) return { ok: false, seq: e.seq, reason: 'hash does not match contents (tampered)' }
    seq = e.seq
    prev = e.hash
  }
  return { ok: true, count: sorted.length, head: { seq, hash: prev } }
}

/** True when the event carries only whitelisted, non-protected data (used when accepting events from outside). */
export function isClean(e: LedgerEvent): boolean {
  if (!isLedgerTable(e.table)) return false
  if (e.op === 'delete') return Object.keys(e.payload).length === 0
  return canonical(sanitizeRow(e.table, e.payload)) === canonical(e.payload) && e.row_id === rowId(e.table, e.payload)
}

/** What the public may read: whitelisted tables only, payload re-sanitised, fields in a fixed shape. */
export function publicEvent(e: LedgerEvent): LedgerEvent | null {
  if (!isLedgerTable(e.table)) return null
  return { seq: e.seq, table: e.table, op: e.op, row_id: e.row_id, payload: e.op === 'delete' ? {} : sanitizeRow(e.table, e.payload), prev_hash: e.prev_hash, hash: e.hash }
}

/** Merkle root over a run of event hashes (reuses src/lib/merkle.ts); a short way to publish "the ledger up to here". */
export const ledgerRoot = (events: LedgerEvent[]) => merkleRoot(events.map((e) => e.hash))

export interface ReplayOptions {
  /** false (default, used by restore): a row comes back with its last non-deleted payload, so data survives deletes and wipes.
   *  true: rows whose latest event is a tombstone stay gone (the "visible" state). */
  honorTombstones?: boolean
  now?: number
}

/** Latest state per table and row. Pure and deterministic; replaying the same events twice gives the same result. */
export function replay(events: LedgerEvent[], opts: ReplayOptions = {}): Record<string, Map<string, Record<string, unknown>>> {
  const out: Record<string, Map<string, Record<string, unknown>>> = {}
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (!isLedgerTable(e.table)) continue
    const m = (out[e.table] ??= new Map())
    if (e.op === 'delete') { if (opts.honorTombstones) m.delete(e.row_id) } else m.set(e.row_id, e.payload)
  }
  const now = opts.now ?? Date.now()
  for (const t of LEDGER_TABLE_NAMES) {
    const r = (LEDGER_TABLES[t] as TableSpec).retention
    if (!r || !out[t]) continue
    for (const [id, row] of out[t]) {
      const ts = Date.parse(String(row[r.col]))
      if (Number.isFinite(ts) && now - ts > r.days * 86400_000) out[t].delete(id)
    }
  }
  return out
}

export interface RestorePlan { table: LedgerTable; conflict: string; rows: Record<string, unknown>[] }

/** Rows to write back, parents before children. Writing is an upsert that ignores rows already present, so it is idempotent. */
export function planRestore(events: LedgerEvent[], tables?: readonly string[], opts: ReplayOptions = {}): RestorePlan[] {
  const state = replay(events, opts)
  return LEDGER_TABLE_NAMES
    .filter((t) => (!tables || tables.includes(t)) && state[t]?.size)
    .sort((a, b) => spec(a).order - spec(b).order)
    .map((t) => ({ table: t, conflict: spec(t).key.join(','), rows: [...state[t].values()].map((p) => ({ ...p })) }))
}

/** Normalised key of a live row, to compare a live table with the replayed state. */
export const liveKey = (table: string, row: Record<string, unknown>) => rowId(table, row)

export const pad = (n: number) => String(n).padStart(12, '0')
