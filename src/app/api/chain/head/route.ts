import { readHeadInfo } from '@/lib/chain-ledger-db'
import { clientKey, createLimiter } from '@/lib/chain-public'
import { edgeCached } from '@/lib/edge-cache'

// Public, read-only: how long the ledger is and what its head hash is, so other nodes can tell whether they are behind.
// Cacheable for 15 seconds at the edge and in browsers; rate limited per caller (best effort, per Worker instance).
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
const allow = createLimiter(60, 60_000)

export async function GET(request: Request) {
  if (!allow(clientKey(request.headers))) {
    return Response.json({ error: 'too many requests, try again in a minute' }, { status: 429, headers: { ...cors, 'Retry-After': '30', 'Cache-Control': 'no-store' } })
  }
  return edgeCached(request, '', 15, async () => {
    try {
      const info = await readHeadInfo()
      if (!info) return Response.json({ error: 'the chain ledger is not set up yet' }, { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })
      return Response.json(info, { headers: { ...cors, 'Cache-Control': 'public, max-age=10, s-maxage=15' } })
    } catch {
      return Response.json({ error: 'could not read the ledger' }, { status: 500, headers: { ...cors, 'Cache-Control': 'no-store' } })
    }
  })
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'public, max-age=86400' } })
