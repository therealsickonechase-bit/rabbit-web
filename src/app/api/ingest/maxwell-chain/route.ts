import { createAdminClient } from '@/lib/supabase/admin'
import { recordWrite } from '@/lib/chain-ledger-db'
import { clientKey, createLimiter } from '@/lib/chain-public'
import { verifySignature } from '@/lib/ingest'
import { MAX_BODY_BYTES, neededIndexes, parseMirrorBody, planMaxwellMirror, statusFor } from '@/lib/maxwell-mirror'
import { MAXWELL_TABLE } from '@/lib/maxwell-block'

// Signed machine route: copies the owner's Maxwell chain onto the public chain ledger, one ledger event per block.
// Same HMAC as /api/ingest (INGEST_SHARED_SECRET, x-rabbit-timestamp, x-rabbit-signature). A mirror, not consensus.
// Logs counts only, never block contents.
const allow = createLimiter(30, 60_000)
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
const missingTable = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'

export async function POST(request: Request) {
  if (!allow(clientKey(request.headers))) return fail(429, 'too many requests, try again in a minute')
  const secret = process.env.INGEST_SHARED_SECRET
  if (!secret) return fail(500, 'ingest not configured')

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return fail(413, 'body too large')
  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) return fail(413, 'body too large')

  const ok = await verifySignature(secret, request.headers.get('x-rabbit-timestamp') ?? '', body, request.headers.get('x-rabbit-signature') ?? '')
  if (!ok) return fail(401, 'bad signature')

  const parsed = parseMirrorBody(body)
  if (!parsed.ok) return fail(parsed.status, parsed.error)

  try {
    const sb = createAdminClient()
    const mirrored = new Map<number, string>()
    const ids = neededIndexes(parsed.blocks).map(String)
    if (ids.length) {
      const r = await sb.from('chain_ledger').select('row_id, payload').eq('tbl', MAXWELL_TABLE).in('row_id', ids)
      if (r.error) {
        if (missingTable(r.error)) return fail(503, 'chain_ledger is not migrated')
        throw r.error
      }
      for (const row of r.data ?? []) {
        const h = (row.payload as { hash?: unknown } | null)?.hash
        if (typeof h === 'string') mirrored.set(Number(row.row_id), h)
      }
    }

    const plan = planMaxwellMirror(parsed.blocks, mirrored)
    const status = statusFor(plan)
    if (status !== 200) {
      console.warn('maxwell mirror refused', { status, rejected: plan.rejected.length, skipped: plan.skipped })
      return Response.json({ accepted: 0, skipped: plan.skipped, rejected: plan.rejected }, { status, headers: { 'Cache-Control': 'no-store' } })
    }
    if (plan.accepted.length) await recordWrite(MAXWELL_TABLE, 'insert', plan.accepted as unknown as Record<string, unknown>[], sb)
    console.info('maxwell mirror', { accepted: plan.accepted.length, skipped: plan.skipped })
    return Response.json({ accepted: plan.accepted.length, skipped: plan.skipped, rejected: [] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('maxwell mirror failed', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return fail(500, 'mirror failed')
  }
}
