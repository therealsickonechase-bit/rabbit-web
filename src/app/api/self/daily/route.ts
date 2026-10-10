import { createClient } from '@/lib/supabase/server'
import { summarySchema } from '@/lib/self-summary'

// Owner-only. Saves (or replaces) one day's coarse summary from the self-data panel, using the owner's own session, so row-level security is what
// enforces ownership. Nothing here uses the service role.
const MAX_BODY = 8_000
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function owner() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user || !user.email_confirmed_at) return { sb, user: null, status: 401 as const }
  const { data } = await sb.rpc('is_owner')
  return data === true ? { sb, user, status: 200 as const } : { sb, user: null, status: 403 as const }
}

export async function POST(request: Request) {
  const o = await owner()
  if (!o.user) return json(o.status, { error: o.status === 401 ? 'sign in first' : 'owner only' })
  const text = await request.text()
  if (text.length > MAX_BODY) return json(413, { error: 'too large' })
  let body: unknown
  try { body = JSON.parse(text) } catch { return json(400, { error: 'invalid json' }) }
  const p = summarySchema.safeParse(body)
  if (!p.success) return json(400, { error: 'invalid summary', issues: p.error.issues.map((i) => i.message).slice(0, 5) })
  const today = new Date().toISOString().slice(0, 10)
  if (p.data.day > today) return json(400, { error: 'day is in the future' })
  const { error } = await o.sb.from('self_daily').upsert(
    { user_id: o.user.id, day: p.data.day, dims: p.data.dims, lab_flags: p.data.lab_flags, synthetic: p.data.synthetic, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,day' })
  if (error) return json(500, { error: 'could not save' })
  return json(200, { ok: true, day: p.data.day })
}

export async function GET() {
  const o = await owner()
  if (!o.user) return json(o.status, { error: o.status === 401 ? 'sign in first' : 'owner only' })
  const { data, error } = await o.sb.from('self_daily').select('day, dims, lab_flags, synthetic').order('day', { ascending: false }).limit(90)
  if (error) return json(500, { error: 'could not read' })
  return json(200, { days: data })
}

export async function DELETE() {
  const o = await owner()
  if (!o.user) return json(o.status, { error: o.status === 401 ? 'sign in first' : 'owner only' })
  const { error } = await o.sb.from('self_daily').delete().eq('user_id', o.user.id)
  return error ? json(500, { error: 'could not delete' }) : json(200, { ok: true })
}
