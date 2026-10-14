import { verifySignature } from '@/lib/ingest'
import { importEvents } from '@/lib/chain-ledger-db'
import type { LedgerEvent } from '@/lib/chain-ledger'

// Signed like /api/ingest (HMAC-SHA256 of `${timestampMs}.${body}` with INGEST_SHARED_SECRET). The Maxwell node pushes
// ledger events it holds; they are accepted only if they extend our head with a valid hash chain and carry nothing protected.
const fail = (status: number, error: string) => Response.json({ error }, { status })

export async function POST(request: Request) {
  const secret = process.env.INGEST_SHARED_SECRET
  if (!secret) return fail(500, 'import not configured')
  const body = await request.text()
  if (body.length > 4_000_000) return fail(413, 'too large')
  const ok = await verifySignature(secret, request.headers.get('x-rabbit-timestamp') ?? '', body, request.headers.get('x-rabbit-signature') ?? '')
  if (!ok) return fail(401, 'bad signature')
  let events: LedgerEvent[]
  try { events = (JSON.parse(body) as { events?: LedgerEvent[] }).events ?? [] } catch { return fail(400, 'invalid json') }
  if (!Array.isArray(events) || events.length > 2000) return fail(400, 'send up to 2000 events')
  try {
    const r = await importEvents(events)
    return r.ok ? Response.json(r) : fail(422, r.reason)
  } catch { return fail(500, 'import failed') }
}
