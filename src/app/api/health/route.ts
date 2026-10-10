import { createAdminClient } from '@/lib/supabase/admin'
import { corsHeaders } from '@/lib/public-feed'

// Public liveness check for rabbitsoftware.io's status page and for scripts/probe.mjs. Exposes only
// "up or down" and how long the database took to answer; no counts, names or data.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'))
  const started = Date.now()
  let database: 'ok' | 'down' = 'ok'
  try {
    const r = await createAdminClient().from('research_topics').select('id', { head: true, count: 'exact' }).limit(1)
    if (r.error) database = 'down'
  } catch {
    database = 'down'
  }
  const ok = database === 'ok'
  return Response.json(
    { service: 'rabbitos', status: ok ? 'ok' : 'degraded', checks: { database }, database_ms: Date.now() - started, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { ...cors, 'Cache-Control': 'no-store' } },
  )
}
