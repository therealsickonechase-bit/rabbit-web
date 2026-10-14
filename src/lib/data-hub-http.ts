import { clientKey, createLimiter } from '@/lib/chain-public'
import { edgeCached } from '@/lib/edge-cache'
import { getDataset, parseQuery, toCsv, toNdjson } from '@/lib/data-hub'
import { HubUnavailable, readManifest, readPage } from '@/lib/data-hub-db'

// Shared GET handlers for /api/data and /api/data/[dataset]. Public, read-only, CORS *, rate limited per caller (best effort).
export const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'X-Next-Cursor' }
const allow = createLimiter(120, 60_000)
const SHARED = 'public, max-age=15, s-maxage=30'
const err = (status: number, error: string, extra: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { ...cors, 'Cache-Control': 'no-store', ...extra } })

export const optionsResponse = () => new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'public, max-age=86400' } })

function limited(request: Request) {
  return allow(clientKey(request.headers)) ? null : err(429, 'too many requests, try again in a minute', { 'Retry-After': '30' })
}

export async function manifestResponse(request: Request): Promise<Response> {
  const blocked = limited(request)
  if (blocked) return blocked
  return edgeCached(request, '', 30, async () => {
    try {
      return Response.json(await readManifest(), { headers: { ...cors, 'Cache-Control': SHARED } })
    } catch {
      return err(500, 'could not read the data hub')
    }
  })
}

export async function datasetResponse(request: Request, id: string): Promise<Response> {
  const blocked = limited(request)
  if (blocked) return blocked
  const ds = /^[a-z_]{1,40}$/.test(id) ? getDataset(id) : null
  if (!ds) return err(404, 'unknown dataset')
  const url = new URL(request.url)
  const parsed = parseQuery(ds, url.searchParams)
  if (!parsed.ok) return err(parsed.status, parsed.error)
  const { query } = parsed
  return edgeCached(request, '', 30, async () => {
    try {
      const page = await readPage(ds, query)
      const base: Record<string, string> = { ...cors, 'Cache-Control': SHARED, 'X-Content-Type-Options': 'nosniff' }
      const name = `${ds.id}${query.offset ? `-${query.offset}` : ''}`
      const disp: Record<string, string> = query.download ? { 'Content-Disposition': `attachment; filename="${name}.${query.format === 'json' ? 'json' : query.format}"` } : {}
      const next: Record<string, string> = page.nextCursor ? { 'X-Next-Cursor': page.nextCursor } : {}
      if (query.format === 'csv') return new Response(toCsv(page.columns, page.rows), { headers: { ...base, ...disp, ...next, 'Content-Type': 'text/csv; charset=utf-8' } })
      if (query.format === 'ndjson') return new Response(toNdjson(page.rows), { headers: { ...base, ...disp, ...next, 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
      return Response.json(page, { headers: { ...base, ...disp, ...next } })
    } catch (e) {
      if (e instanceof HubUnavailable) return err(503, 'this dataset is not set up yet')
      return err(500, 'could not read this dataset')
    }
  })
}
