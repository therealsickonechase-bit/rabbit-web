import { createAdminClient } from '@/lib/supabase/admin'
import { runtimeEnv } from '@/lib/runtime-env'
import { GENESIS_HEAD, GENESIS_PREV, LEDGER_TABLES, LEDGER_TABLE_NAMES, buildEvents, isClean, isLedgerTable, makeDrafts, planRestore, verifyChain, type Draft, type Head, type LedgerEvent, type Op } from '@/lib/chain-ledger'
import { headInfo, latestPublic, type HeadInfo, type LedgerSummary } from '@/lib/chain-public'
import { mirrorBestEffort, mirrorFromEnv, mirrorable, noopMirror, type ChainMirror } from '@/lib/chain-mirror'

// Server-only wiring for the chain ledger (service role). Every write to an opened table goes through recordWrite() FIRST,
// then the live table. The live tables are a view; restoreFromChain() rebuilds them from the ledger.

type Admin = ReturnType<typeof createAdminClient>
const COLS = 'seq, tbl, op, row_id, payload, prev_hash, hash'
type Row = { seq: number; tbl: string; op: Op; row_id: string; payload: Record<string, unknown>; prev_hash: string; hash: string }
const toEvent = (r: Row): LedgerEvent => ({ seq: Number(r.seq), table: r.tbl, op: r.op, row_id: r.row_id, payload: r.payload ?? {}, prev_hash: r.prev_hash, hash: r.hash })
const toRow = (e: LedgerEvent) => ({ seq: e.seq, tbl: e.table, op: e.op, row_id: e.row_id, payload: e.payload, prev_hash: e.prev_hash, hash: e.hash })

/** The mirror bound to this deployment: an R2 bucket named CHAIN_MIRROR when present, else a no-op. */
export async function getMirror(): Promise<ChainMirror> {
  return mirrorFromEnv(await runtimeEnv())
}

const missingTable = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'
const CHUNK = 200

export async function ledgerHead(sb: Admin): Promise<Head | 'missing'> {
  const r = await sb.from('chain_ledger').select('seq, hash').order('seq', { ascending: false }).limit(1)
  if (r.error) { if (missingTable(r.error)) return 'missing'; throw r.error }
  return r.data?.[0] ? { seq: Number(r.data[0].seq), hash: r.data[0].hash } : GENESIS_HEAD
}

/** Appends events to the ledger and mirrors them. Retries when another writer took the same seq. Returns the events. */
export async function appendEvents(drafts: Draft[], sb: Admin = createAdminClient()): Promise<LedgerEvent[]> {
  const done: LedgerEvent[] = []
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const chunk = drafts.slice(i, i + CHUNK)
    for (let attempt = 0; ; attempt++) {
      const head = await ledgerHead(sb)
      if (head === 'missing') return done
      const events = await buildEvents(head, chunk)
      const ins = await sb.from('chain_ledger').insert(events.map(toRow))
      if (!ins.error) { done.push(...events); break }
      if (attempt >= 8 || !['23505', '23514'].includes(ins.error.code ?? '')) throw ins.error
    }
  }
  if (done.length) mirrorBestEffort(await getMirror(), mirrorable(done))
  return done
}

/** Ledger first. Call this BEFORE the live write; if it throws, do not write. If the chain_ledger table is not migrated yet
 *  it logs once and lets the write proceed, so deploying before the migration does not break the app. */
export async function recordWrite(table: string, op: Op, rows: Record<string, unknown>[], sb?: Admin): Promise<void> {
  if (!rows.length) return
  const events = await appendEvents(makeDrafts(table, op, rows), sb)
  if (!events.length) console.warn('chain_ledger is not migrated: write not recorded on the chain')
}

/** Every row of a table (optionally where one column equals a value), in pages. Used to tombstone a wipe. */
export async function selectAll(sb: Admin, table: string, columns: string, where?: [string, string]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(columns)
    if (where) q = q.eq(where[0], where[1])
    const r = await q.range(from, from + 999)
    if (r.error) throw r.error
    const page = (r.data ?? []) as unknown as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

/** Columns to select when a write needs the full row (so the ledger event carries the whole row, not a patch). */
export const ledgerCols = (table: string) => (isLedgerTable(table) ? LEDGER_TABLES[table].cols.join(', ') : '')

async function readLedger(sb: Admin, since = 0): Promise<{ events: LedgerEvent[]; missing: boolean }> {
  const out: LedgerEvent[] = []
  let cursor = since
  for (;;) {
    const r = await sb.from('chain_ledger').select(COLS).gt('seq', cursor).order('seq').limit(1000)
    if (r.error) { if (missingTable(r.error)) return { events: [], missing: true }; throw r.error }
    const page = (r.data ?? []).map((x) => toEvent(x as Row))
    out.push(...page)
    if (page.length < 1000) break
    cursor = page[page.length - 1].seq
  }
  return { events: out, missing: false }
}

/** A page of events for the public read endpoint. */
export async function readPublicLedger(since: number, limit: number) {
  const sb = createAdminClient()
  const r = await sb.from('chain_ledger').select(COLS).gt('seq', since).order('seq').limit(limit)
  if (r.error) throw r.error
  return (r.data ?? []).map((x) => toEvent(x as Row))
}

/** Length, head hash and time of the last event (for GET /api/chain/head). Null when the ledger table is not migrated yet. */
export async function readHeadInfo(): Promise<HeadInfo | null> {
  const r = await createAdminClient().from('chain_ledger').select('seq, hash, created_at').order('seq', { ascending: false }).limit(1)
  if (r.error) { if (missingTable(r.error)) return null; throw r.error }
  const row = r.data?.[0]
  return row ? headInfo({ seq: Number(row.seq), hash: row.hash }, row.created_at ?? null) : headInfo(GENESIS_HEAD, null)
}

/** Everything the public explorer shows: head, genesis, per-table counts, newest 50 events (payloads sanitised). */
export async function readLedgerSummary(): Promise<LedgerSummary | null> {
  const sb = createAdminClient()
  const head = await readHeadInfo()
  if (!head) return null
  const [first, latest, ...counts] = await Promise.all([
    sb.from('chain_ledger').select('hash').eq('seq', 1).maybeSingle(),
    sb.from('chain_ledger').select(COLS).order('seq', { ascending: false }).limit(50),
    ...LEDGER_TABLE_NAMES.map((t) => sb.from('chain_ledger').select('seq', { head: true, count: 'exact' }).eq('tbl', t)),
  ])
  if (latest.error) throw latest.error
  return {
    ...head,
    genesis: GENESIS_PREV,
    firstHash: first.data?.hash ?? null,
    counts: Object.fromEntries(LEDGER_TABLE_NAMES.map((t, i) => [t, counts[i].count ?? 0])),
    latest: latestPublic((latest.data ?? []).map((x) => toEvent(x as Row)), 50),
  }
}

export type RestoreResult =
  | { ok: true; events: number; restored: Record<string, number>; errors: Record<string, string>; head: Head; from: 'supabase' | 'supabase+mirror' }
  | { ok: false; reason: string; seq?: number }

/** Replays the ledger, verifies the hash chain (refusing a broken one) and rebuilds the live tables to the latest
 *  non-tombstoned state. Idempotent: rows already present are left alone. If the Supabase ledger is short or empty,
 *  the missing tail comes from the mirror, and is only used if the whole chain verifies. */
export async function restoreFromChain(tables?: readonly string[]): Promise<RestoreResult> {
  const sb = createAdminClient()
  const local = await readLedger(sb)
  let events = local.events
  let from: 'supabase' | 'supabase+mirror' = 'supabase'
  const mirror = await getMirror()
  if (mirror !== noopMirror) {
    try {
      const head = events.length ? events[events.length - 1].seq : 0
      const tail = await mirror.list(head)
      if (tail.length) {
        const merged = [...events, ...tail]
        const v = await verifyChain(merged)
        if (!v.ok) return { ok: false, reason: `mirror does not extend the ledger cleanly: ${v.reason}`, seq: v.seq }
        events = merged
        from = 'supabase+mirror'
        if (!local.missing) {
          for (let i = 0; i < tail.length; i += CHUNK) {
            const ins = await sb.from('chain_ledger').insert(tail.slice(i, i + CHUNK).map(toRow))
            if (ins.error) console.warn('could not copy mirror events back to the ledger', ins.error.code)
          }
        }
      }
    } catch (e) { console.warn('mirror read failed', e instanceof Error ? e.message.slice(0, 200) : 'error') }
  }
  const verdict = await verifyChain(events)
  if (!verdict.ok) return { ok: false, reason: `ledger refused: ${verdict.reason}`, seq: verdict.seq }
  if (!events.length) return { ok: false, reason: local.missing ? 'chain_ledger is not migrated' : 'the ledger is empty' }
  const restored: Record<string, number> = {}
  const errors: Record<string, string> = {}
  for (const plan of planRestore(events, tables)) {
    let n = 0
    for (let i = 0; i < plan.rows.length; i += 500) {
      const batch = plan.rows.slice(i, i + 500)
      const r = await sb.from(plan.table).upsert(batch, { onConflict: plan.conflict, ignoreDuplicates: true })
      if (r.error) { errors[plan.table] = r.error.message.slice(0, 160); break }
      n += batch.length
    }
    restored[plan.table] = n
  }
  return { ok: true, events: verdict.count, restored, errors, head: verdict.head, from }
}

const lastTry = new Map<string, number>()

/** If a table that should have rows is empty, restore it from the chain (at most once a minute per table per instance). */
export async function autoRestoreIfEmpty(table: string): Promise<boolean> {
  try {
    if (!isLedgerTable(table) || (LEDGER_TABLES[table] as { live?: false }).live === false) return false
    const sb = createAdminClient()
    const live = await sb.from(table).select('*', { count: 'exact', head: true })
    if (live.error || (live.count ?? 0) > 0) return false
    const now = Date.now()
    if (now - (lastTry.get(table) ?? 0) < 60_000) return false
    lastTry.set(table, now)
    const seen = await sb.from('chain_ledger').select('seq', { head: true, count: 'exact' }).eq('tbl', table).neq('op', 'delete')
    const ledgerHas = !seen.error && (seen.count ?? 0) > 0
    // The Supabase ledger may itself be gone; then only a mirror could still hold this table's events.
    if (!ledgerHas && (await getMirror()) === noopMirror) return false
    const r = await restoreFromChain([table])
    return r.ok && (r.restored[table] ?? 0) > 0
  } catch (e) {
    console.warn('auto-restore skipped', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return false
  }
}

/** Accepts events from outside (the Maxwell node's import): they must extend our head, verify, and carry nothing protected. */
export async function importEvents(incoming: LedgerEvent[]): Promise<{ ok: true; added: number; head: Head } | { ok: false; reason: string }> {
  const sb = createAdminClient()
  const head = await ledgerHead(sb)
  if (head === 'missing') return { ok: false, reason: 'chain_ledger is not migrated' }
  const fresh = incoming.filter((e) => e.seq > head.seq).sort((a, b) => a.seq - b.seq)
  if (!fresh.length) return { ok: true, added: 0, head }
  if (!fresh.every(isClean)) return { ok: false, reason: 'event carries data that may not be on the ledger' }
  const v = await verifyChain(fresh, head)
  if (!v.ok) return { ok: false, reason: `${v.reason} (seq ${v.seq})` }
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const ins = await sb.from('chain_ledger').insert(fresh.slice(i, i + CHUNK).map(toRow))
    if (ins.error) return { ok: false, reason: 'insert refused by the ledger' }
  }
  mirrorBestEffort(await getMirror(), mirrorable(fresh))
  return { ok: true, added: fresh.length, head: v.head }
}
