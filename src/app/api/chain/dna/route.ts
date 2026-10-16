import { readHeadInfo } from '@/lib/chain-ledger-db'
import { clientKey, createLimiter } from '@/lib/chain-public'
import { dnaView } from '@/lib/dna-binary'
import { edgeCached } from '@/lib/edge-cache'

// Public, read-only: the head of the public chain shown as DNA-binary letters (4 bases per byte of the head hash, A=00 C=01 G=10 T=11), exactly reversible.
// It is an encoding of a hash that is already public, not a biological claim, and it carries no sequence data of anyone. Same limits and cache as /api/chain/head.
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
      let view = null
      try { view = dnaView(info.headHash) } catch { /* a head that is not a hash (for example before the first block) has no strand */ }
      return Response.json({ ...info, head: view, encoding: 'A=00 C=01 G=10 T=11, 4 bases per byte, most significant bits first' }, { headers: { ...cors, 'Cache-Control': 'public, max-age=10, s-maxage=15' } })
    } catch {
      return Response.json({ error: 'could not read the ledger' }, { status: 500, headers: { ...cors, 'Cache-Control': 'no-store' } })
    }
  })
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'public, max-age=86400' } })
