import { withSupabase, type SupabaseContext } from '@supabase/server'
import { summarySchema } from '@/lib/self-summary'

// Owner-only. Saves (or replaces) one day's coarse summary from the self-data panel.
// @supabase/server verifies the caller's access token (sent as `Authorization: Bearer ...`) against the project's signing keys before this code runs,
// and gives a client limited to that user, so row-level security is what enforces ownership. The service role is never used here.
const MAX_BODY = 8_000
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

type Ctx = SupabaseContext

/** Built per request so the environment is read when the request arrives. */
function guarded(handler: (req: Request, ctx: Ctx) => Promise<Response>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return withSupabase({
    auth: 'user',
    cors: 'disabled',                       // same-origin only; no cross-site calls
    env: { url, publishableKeys: { default: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' }, jwks: new URL(`${url}/auth/v1/.well-known/jwks.json`) },
  }, async (req, ctx) => {
    const { data: isOwner } = await ctx.supabase.rpc('is_owner')
    if (isOwner !== true) return json(403, { error: 'owner only' })
    return handler(req, ctx)
  })
}

export async function POST(request: Request) {
  return guarded(async (req, ctx) => {
    const text = await req.text()
    if (text.length > MAX_BODY) return json(413, { error: 'too large' })
    let body: unknown
    try { body = JSON.parse(text) } catch { return json(400, { error: 'invalid json' }) }
    const p = summarySchema.safeParse(body)
    if (!p.success) return json(400, { error: 'invalid summary', issues: p.error.issues.map((i) => i.message).slice(0, 5) })
    if (p.data.day > new Date().toISOString().slice(0, 10)) return json(400, { error: 'day is in the future' })
    const { error } = await ctx.supabase.from('self_daily').upsert(
      { user_id: ctx.userClaims!.id, day: p.data.day, dims: p.data.dims, lab_flags: p.data.lab_flags, synthetic: p.data.synthetic, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,day' })
    if (error) return json(500, { error: 'could not save' })
    return json(200, { ok: true, day: p.data.day })
  })(request)
}

export async function GET(request: Request) {
  return guarded(async (_req, ctx) => {
    const { data, error } = await ctx.supabase.from('self_daily').select('day, dims, lab_flags, synthetic').order('day', { ascending: false }).limit(90)
    return error ? json(500, { error: 'could not read' }) : json(200, { days: data })
  })(request)
}

export async function DELETE(request: Request) {
  return guarded(async (_req, ctx) => {
    const { error } = await ctx.supabase.from('self_daily').delete().eq('user_id', ctx.userClaims!.id)
    return error ? json(500, { error: 'could not delete' }) : json(200, { ok: true })
  })(request)
}
