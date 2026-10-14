import { createAdminClient } from '@/lib/supabase/admin'
import { DATASETS, buildManifest, buildPage, memoryRows, publicColumns, queryMemory, type Dataset, type Manifest, type Page, type Query } from '@/lib/data-hub'
import { readHeadInfo } from '@/lib/chain-ledger-db'

// Server-only wiring for the data hub. The service-role client bypasses RLS, so every read names its columns from the registry
// (never `*`), uses only builder methods (parameterized by PostgREST) and only the filters the registry declares.

const missing = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'

export class HubUnavailable extends Error {}

export async function readPage(ds: Dataset, query: Query): Promise<Page> {
  if (ds.kind === 'commands') return buildPage(ds, queryMemory(ds, memoryRows(ds), query), query)
  const sb = createAdminClient()
  let req = sb.from(ds.table as string).select(publicColumns(ds).join(', '))
  for (const [k, v] of Object.entries(query.filters)) req = req.eq(k, v)
  if (query.q) req = req.or(ds.searchable.map((c) => `${c}.ilike."%${query.q}%"`).join(','))
  req = req.order(query.sort, { ascending: query.dir === 'asc' })
  if (query.sort !== ds.key) req = req.order(ds.key, { ascending: query.dir === 'asc' })
  const r = await req.range(query.offset, query.offset + query.limit) // limit + 1 rows
  if (r.error) { if (missing(r.error)) throw new HubUnavailable(ds.id); throw r.error }
  return buildPage(ds, (r.data ?? []) as unknown as Record<string, unknown>[], query)
}

async function countOf(ds: Dataset): Promise<number | null> {
  if (ds.kind === 'commands') return memoryRows(ds).length
  try {
    const r = await createAdminClient().from(ds.table as string).select('*', { head: true, count: 'exact' })
    return r.error ? null : r.count ?? 0
  } catch { return null }
}

export async function readManifest(): Promise<Manifest> {
  const [counts, head] = await Promise.all([
    Promise.all(DATASETS.map(countOf)),
    readHeadInfo().catch(() => null),
  ])
  return buildManifest(Object.fromEntries(DATASETS.map((x, i) => [x.id, counts[i]])), head)
}
