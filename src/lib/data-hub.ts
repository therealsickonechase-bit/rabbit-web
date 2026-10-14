// Data hub: a PUBLIC, READ-ONLY window onto research data and the chain ledger, and nothing else.
//
// The registry below is the only list of datasets the hub serves, each with an EXPLICIT column list. Anything not listed here
// (chats, notes, collections, the memory graph, EEG samples, self_daily, contact records, keys, settings, owners, user ids...)
// cannot be reached through /api/data. Pure logic only (no imports besides the command catalog) so Node tests can load it.
//
// What is served is permanent once somebody copies it. Rows are re-sanitised on the way out: any column or nested key that looks
// like a token, secret, key, email, password or user id is dropped.
import { publicEntries } from './command-catalog.ts'

export const MAX_LIMIT = 200
export const DEFAULT_LIMIT = 50
export const MAX_OFFSET = 100_000
export const MAX_Q = 80
export const FORMATS = ['json', 'csv', 'ndjson'] as const
export type Format = typeof FORMATS[number]

/** Names that must never be served, as a column or as a nested key inside a json value. */
export const SECRET_LIKE = /token|secret|key|e-?mail|passw|passcode|user_?id|created_by|reviewed_by|sealed_by|twin_id|subject_name|subject_dob|\bdob\b|date_of_birth|ciphertext|encrypted/i

/** Tables and sources the hub must never serve (checked by tests against the registry). */
export const NEVER_IN_HUB = [
  'chat_threads', 'chat_messages', 'notes', 'collections', 'collection_items', 'kg_edges', 'eeg_band_samples', 'self_daily',
  'contact_records', 'contact_access_log', 'api_keys', 'api_key_calls', 'user_settings', 'guest_passes', 'owners', 'twin_identity', 'agent_tasks',
] as const

export type DatasetKind = 'table' | 'ledger' | 'commands'

export interface Dataset {
  id: string
  title: string
  description: string
  kind: DatasetKind
  /** Database table (kind 'table' or 'ledger'). */
  table?: string
  /** The ONLY columns ever selected or returned. */
  columns: readonly string[]
  /** Columns that hold json (searched never, sanitised for nested keys). */
  json?: readonly string[]
  /** Text columns the `q` parameter searches (case-insensitive substring). */
  searchable: readonly string[]
  /** Columns `sort` may name. */
  sortable: readonly string[]
  /** Columns that accept an exact-match filter, as ?column=value. */
  filterable: readonly string[]
  defaultSort: { column: string; dir: 'asc' | 'desc' }
  /** Unique column used as the sort tie-breaker so paging is stable. */
  key: string
}

const d = (x: Dataset): Dataset => x

export const DATASETS: readonly Dataset[] = [
  d({
    id: 'research_records', title: 'Research records', kind: 'table', table: 'research_records',
    description: 'Articles, trials and other records the research agents found (public sources only).',
    columns: ['id', 'source', 'title', 'url', 'topic_id', 'run_id', 'first_seen_at', 'meta'], json: ['meta'],
    searchable: ['title', 'id', 'source'], sortable: ['first_seen_at', 'source', 'title', 'id'], filterable: ['source', 'topic_id', 'run_id'],
    defaultSort: { column: 'first_seen_at', dir: 'desc' }, key: 'id',
  }),
  d({
    id: 'research_topics', title: 'Research topics', kind: 'table', table: 'research_topics',
    description: 'What the agents are exploring, with status.',
    columns: ['id', 'topic', 'biomarker', 'parent_topic_id', 'status', 'discovered_by', 'created_at', 'explored_at'],
    searchable: ['topic', 'biomarker'], sortable: ['created_at', 'explored_at', 'topic', 'status', 'id'], filterable: ['status', 'biomarker', 'discovered_by'],
    defaultSort: { column: 'created_at', dir: 'desc' }, key: 'id',
  }),
  d({
    id: 'research_runs', title: 'Research runs', kind: 'table', table: 'research_runs',
    description: 'One row per agent cycle: how many new records it found.',
    columns: ['id', 'agent_id', 'topic_id', 'cycle', 'new_ids_found', 'summary', 'started_at'],
    searchable: ['summary', 'agent_id'], sortable: ['started_at', 'cycle', 'new_ids_found', 'id'], filterable: ['agent_id', 'topic_id'],
    defaultSort: { column: 'started_at', dir: 'desc' }, key: 'id',
  }),
  d({
    id: 'research_summaries', title: 'AI summaries', kind: 'table', table: 'research_summaries',
    description: 'AI interpretations of a topic. Always labelled as AI, never a primary record.',
    columns: ['id', 'agent_id', 'topic_id', 'model', 'ai_interpretation', 'disclaimer', 'source_counts', 'created_at'], json: ['source_counts'],
    searchable: ['ai_interpretation', 'model'], sortable: ['created_at', 'model', 'id'], filterable: ['model', 'topic_id', 'agent_id'],
    defaultSort: { column: 'created_at', dir: 'desc' }, key: 'id',
  }),
  d({
    id: 'agents', title: 'Agents', kind: 'table', table: 'agents',
    description: 'Research and network nodes (public columns only; no identity links).',
    columns: ['node_id', 'kind', 'created_at', 'last_seen_at'],
    searchable: ['node_id', 'kind'], sortable: ['created_at', 'last_seen_at', 'node_id', 'kind'], filterable: ['kind'],
    defaultSort: { column: 'created_at', dir: 'desc' }, key: 'node_id',
  }),
  d({
    id: 'chain_blocks', title: 'Network chain blocks', kind: 'table', table: 'chain_blocks',
    description: 'Blocks mined by the research network (the gossip chain and others).',
    columns: ['block_id', 'node_id', 'source', 'das_score', 'hash', 'prev_hash', 'mined_at', 'chain', 'height', 'payload'], json: ['payload'],
    searchable: ['block_id', 'source', 'chain', 'node_id'], sortable: ['mined_at', 'height', 'das_score', 'block_id'], filterable: ['chain', 'source', 'node_id'],
    defaultSort: { column: 'mined_at', dir: 'desc' }, key: 'block_id',
  }),
  d({
    id: 'node_scores', title: 'Node scores', kind: 'table', table: 'node_scores',
    description: 'Per-node quality (MOS) and an internal contribution score. Not a currency.',
    columns: ['id', 'node_id', 'mos', 'balance', 'ts'],
    searchable: ['node_id'], sortable: ['ts', 'mos', 'balance', 'id'], filterable: ['node_id'],
    defaultSort: { column: 'ts', dir: 'desc' }, key: 'id',
  }),
  d({
    id: 'merkle_batches', title: 'Merkle batches', kind: 'table', table: 'merkle_batches',
    description: 'Roots over runs of audit entries; a short proof shows an entry belongs to a batch.',
    columns: ['id', 'from_seq', 'to_seq', 'leaf_count', 'root', 'created_at', 'anchor_tx', 'anchor_ledger'],
    searchable: ['root', 'anchor_tx'], sortable: ['created_at', 'from_seq', 'to_seq', 'id'], filterable: [],
    defaultSort: { column: 'id', dir: 'desc' }, key: 'id',
  }),
  d({
    id: 'audit_entries', title: 'Audit entries', kind: 'table', table: 'audit_entries',
    description: 'The hash-chained, append-only audit trail.',
    columns: ['seq', 'module', 'action', 'details', 'node_id', 'prev_hash', 'hash', 'ts'], json: ['details'],
    searchable: ['module', 'action', 'node_id', 'hash'], sortable: ['seq', 'ts', 'module', 'action'], filterable: ['module', 'action', 'node_id'],
    defaultSort: { column: 'seq', dir: 'desc' }, key: 'seq',
  }),
  d({
    id: 'ledger', title: 'Chain ledger (metadata)', kind: 'ledger', table: 'chain_ledger',
    description: 'The hash chain of every write: sequence, table, operation and hashes. Payloads and row ids are NOT here; the full verified log stays at /api/chain/ledger.',
    columns: ['seq', 'tbl', 'op', 'prev_hash', 'hash', 'created_at'],
    searchable: ['tbl', 'hash'], sortable: ['seq', 'created_at', 'tbl', 'op'], filterable: ['tbl', 'op'],
    defaultSort: { column: 'seq', dir: 'desc' }, key: 'seq',
  }),
  d({
    id: 'commands', title: 'Public commands', kind: 'commands',
    description: 'The CloudShell command catalog entries that need no secret (public scope).',
    columns: ['id', 'project', 'group', 'label', 'command', 'description', 'risk', 'source'],
    searchable: ['id', 'label', 'command', 'description', 'group'], sortable: ['id', 'project', 'group', 'label', 'risk'], filterable: ['project', 'group', 'risk'],
    defaultSort: { column: 'id', dir: 'asc' }, key: 'id',
  }),
]

export const datasetIds = DATASETS.map((x) => x.id)
export const getDataset = (id: string): Dataset | null => DATASETS.find((x) => x.id === id) ?? null

// ---- request parsing -------------------------------------------------------------------------------------------------

export interface Query {
  q: string
  limit: number
  offset: number
  sort: string
  dir: 'asc' | 'desc'
  filters: Record<string, string>
  format: Format
  download: boolean
}
export type Parsed = { ok: true; query: Query } | { ok: false; status: 400; error: string }

const NUMERIC_FILTERS = ['topic_id', 'run_id']
const RESERVED = new Set(['q', 'limit', 'cursor', 'sort', 'format', 'download'])

export const encodeCursor = (offset: number) => btoa(JSON.stringify({ o: offset })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** Returns the offset, or null when the cursor is not one we issued. */
export function decodeCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cursor)) return null
  try {
    const b = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const o = (JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as { o?: unknown }).o
    return typeof o === 'number' && Number.isInteger(o) && o >= 0 && o <= MAX_OFFSET ? o : null
  } catch { return null }
}

/** Search text reduced to letters, digits, space, hyphen and colon, so it can never change a filter expression or add wildcards. */
export const cleanSearch = (s: string) => s.replace(/[^\p{L}\p{N} :-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_Q)

export function parseQuery(ds: Dataset, params: URLSearchParams): Parsed {
  const bad = (error: string): Parsed => ({ ok: false, status: 400, error })
  const limitRaw = params.get('limit')
  let limit = DEFAULT_LIMIT
  if (limitRaw !== null) {
    if (!/^\d{1,6}$/.test(limitRaw) || Number(limitRaw) < 1) return bad('limit must be a whole number from 1 to ' + MAX_LIMIT)
    limit = Math.min(MAX_LIMIT, Number(limitRaw))
  }
  let offset = 0
  const cursor = params.get('cursor')
  if (cursor) {
    const o = decodeCursor(cursor)
    if (o === null) return bad('cursor is not valid')
    offset = o
  }
  const sortRaw = params.get('sort')
  let sort = ds.defaultSort.column
  let dir = ds.defaultSort.dir
  if (sortRaw) {
    const m = /^(-?)([a-z_]{1,40})$/.exec(sortRaw)
    if (!m || !ds.sortable.includes(m[2])) return bad(`sort must be one of: ${ds.sortable.join(', ')} (prefix with - for descending)`)
    sort = m[2]
    dir = m[1] ? 'desc' : 'asc'
  }
  const format = (params.get('format') ?? 'json').toLowerCase()
  if (!(FORMATS as readonly string[]).includes(format)) return bad('format must be json, csv or ndjson')
  const qRaw = params.get('q') ?? ''
  const q = cleanSearch(qRaw)
  if (q && !ds.searchable.length) return bad('this dataset has no searchable columns')
  const filters: Record<string, string> = {}
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue
    if (!ds.filterable.includes(k)) {
      if (!ds.columns.includes(k)) return bad(`unknown column: ${k.slice(0, 40)}`)
      return bad(`column ${k} cannot be filtered`)
    }
    if (v.length > 120 || /[\u0000-\u001f]/.test(v)) return bad(`filter ${k} is not valid`)
    if (NUMERIC_FILTERS.includes(k) && !/^\d{1,15}$/.test(v)) return bad(`filter ${k} must be a whole number`)
    filters[k] = v
  }
  return { ok: true, query: { q, limit, offset, sort, dir, filters, format: format as Format, download: params.get('download') === '1' } }
}

// ---- sanitising and formats ------------------------------------------------------------------------------------------

/** Removes secret-like keys at any depth. */
export function stripSecretLike<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripSecretLike) as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SECRET_LIKE.test(k)) out[k] = stripSecretLike(x)
    return out as T
  }
  return v
}

/** Only declared columns survive, in declared order; secret-like names are dropped even if declared. */
export function publicRow(ds: Dataset, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of ds.columns) if (!SECRET_LIKE.test(c) && row[c] !== undefined) out[c] = stripSecretLike(row[c])
  return out
}

export const publicColumns = (ds: Dataset) => ds.columns.filter((c) => !SECRET_LIKE.test(c))

/** One CSV cell. Values that a spreadsheet could read as a formula get a leading apostrophe. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (typeof v !== 'number' && /^[=+\-@\t\r|%]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  return [columns.map(csvCell).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n'
}

export const toNdjson = (rows: readonly Record<string, unknown>[]) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')

export interface Page {
  dataset: string
  columns: string[]
  count: number
  limit: number
  sort: string
  dir: 'asc' | 'desc'
  q: string
  nextCursor: string | null
  rows: Record<string, unknown>[]
}

/** Builds a page from up to limit+1 fetched rows (the extra one only says there is more). */
export function buildPage(ds: Dataset, fetched: Record<string, unknown>[], query: Query): Page {
  const more = fetched.length > query.limit
  const rows = fetched.slice(0, query.limit).map((r) => publicRow(ds, r))
  const next = query.offset + rows.length
  return {
    dataset: ds.id, columns: publicColumns(ds), count: rows.length, limit: query.limit, sort: query.sort, dir: query.dir, q: query.q,
    nextCursor: more && next <= MAX_OFFSET ? encodeCursor(next) : null, rows,
  }
}

// ---- in-memory datasets (commands) ----------------------------------------------------------------------------------

/** Rows of an in-memory dataset. Public-scope commands only; the env-var list is not included. */
export function memoryRows(ds: Dataset): Record<string, unknown>[] {
  if (ds.id !== 'commands') return []
  return publicEntries().map((e) => Object.fromEntries(ds.columns.map((c) => [c, (e as unknown as Record<string, unknown>)[c]])))
}

export function queryMemory(ds: Dataset, all: Record<string, unknown>[], query: Query): Record<string, unknown>[] {
  const needle = query.q.toLowerCase()
  let rows = all.filter((r) => Object.entries(query.filters).every(([k, v]) => String(r[k]) === v))
  if (needle) rows = rows.filter((r) => ds.searchable.some((c) => String(r[c] ?? '').toLowerCase().includes(needle)))
  const key = ds.key
  rows = [...rows].sort((a, b) => {
    const x = a[query.sort] as string | number, y = b[query.sort] as string | number
    const c = x === y ? String(a[key]).localeCompare(String(b[key])) : x < y ? -1 : 1
    return query.dir === 'asc' ? c : -c
  })
  return rows.slice(query.offset, query.offset + query.limit + 1)
}

// ---- manifest --------------------------------------------------------------------------------------------------------

export interface ManifestEntry {
  id: string
  title: string
  description: string
  kind: DatasetKind
  rows: number | null
  columns: string[]
  searchable: string[]
  sortable: string[]
  filterable: string[]
  endpoint: string
  formats: readonly Format[]
}

export interface Manifest {
  name: string
  readOnly: true
  note: string
  maxLimit: number
  datasets: ManifestEntry[]
  ledgerHead: { length: number; headHash: string; updatedAt: string | null } | null
}

export function buildManifest(counts: Record<string, number | null>, ledgerHead: Manifest['ledgerHead']): Manifest {
  return {
    name: 'RabbitOS data hub',
    readOnly: true,
    note: 'Public and read-only. Anything served here is permanent once copied. Personal tables and private local research stores are not included.',
    maxLimit: MAX_LIMIT,
    datasets: DATASETS.map((x) => ({
      id: x.id, title: x.title, description: x.description, kind: x.kind, rows: counts[x.id] ?? null,
      columns: publicColumns(x), searchable: [...x.searchable], sortable: [...x.sortable], filterable: [...x.filterable],
      endpoint: `/api/data/${x.id}`, formats: FORMATS,
    })),
    ledgerHead,
  }
}

/** The exact command the explorer shows for CloudShell. */
export const curlCommand = (id: string, origin = '$ORIGIN') => `curl -fsS "${origin}/api/data/${id}?limit=50" | jq`
