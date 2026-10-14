import { publicEvent } from '@/lib/chain-ledger'
import { readPublicLedger } from '@/lib/chain-ledger-db'
import { clientKey, createLimiter } from '@/lib/chain-public'

// Public, read-only: ledger events after `since` (default 0), at most 1000 per call. Only whitelisted tables and columns
// are on the ledger, and every payload is re-sanitised here, so nothing on the protected list can leave through this route.
// Anyone may read, verify and copy it. Rate limited per caller (best effort).
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
const headers = { 'Cache-Control': 'no-store', ...cors }
const allow = createLimiter(120, 60_000)

export async function GET(request: Request) {
  if (!allow(clientKey(request.headers))) {
    return Response.json({ error: 'too many requests, try again in a minute' }, { status: 429, headers: { ...headers, 'Retry-After': '30' } })
  }
  const url = new URL(request.url)
  const since = Math.max(0, Math.floor(Number(url.searchParams.get('since') ?? 0)) || 0)
  const limit = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? 1000)) || 1000))
  try {
    const events = (await readPublicLedger(since, limit)).map(publicEvent).filter((e) => e !== null)
    return Response.json({ since, count: events.length, events }, { headers })
  } catch {
    return Response.json({ error: 'could not read the ledger' }, { status: 500, headers })
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'public, max-age=86400' } })
