import { createAdminClient } from '@/lib/supabase/admin'
import { summarySchema } from '@/lib/self-summary'
import { PUBLIC_USER_ID } from '@/lib/open-access'
import { autoRestoreIfEmpty, recordWrite, selectAll } from '@/lib/chain-ledger-db'

// Open to everyone, no login. Saves (or replaces) one day's coarse summary from the self-data panel. Everyone shares one set of days.
// Written through the server's admin client; the body is validated by summarySchema (coarse summaries only, no raw values or free text).
const MAX_BODY = 8_000
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// Best-effort write guard that needs no database: an hourly cap per Worker instance.
const writes: number[] = []
const HOURLY_WRITES = 120
function writeAllowed() {
  const now = Date.now()
  while (writes.length && now - writes[0] > 3600_000) writes.shift()
  if (writes.length >= HOURLY_WRITES) return false
  writes.push(now)
  return true
}

export async function POST(request: Request) {
  if (!writeAllowed()) return json(429, { error: 'too many saves, try again later' })
  const text = await request.text()
  if (text.length > MAX_BODY) return json(413, { error: 'too large' })
  let body: unknown
  try { body = JSON.parse(text) } catch { return json(400, { error: 'invalid json' }) }
  const p = summarySchema.safeParse(body)
  if (!p.success) return json(400, { error: 'invalid summary', issues: p.error.issues.map((i) => i.message).slice(0, 5) })
  if (p.data.day > new Date().toISOString().slice(0, 10)) return json(400, { error: 'day is in the future' })
  const row = { user_id: PUBLIC_USER_ID, day: p.data.day, dims: p.data.dims, lab_flags: p.data.lab_flags, synthetic: p.data.synthetic, updated_at: new Date().toISOString() }
  try { await recordWrite('self_daily', 'update', [row]) } catch { return json(500, { error: 'could not save' }) } // chain first, then the live table
  const { error } = await createAdminClient().from('self_daily').upsert(row, { onConflict: 'user_id,day' })
  if (error) return json(500, { error: 'could not save' })
  return json(200, { ok: true, day: p.data.day })
}

export async function GET() {
  await autoRestoreIfEmpty('self_daily') // a wiped view comes back from the chain
  const { data, error } = await createAdminClient().from('self_daily').select('day, dims, lab_flags, synthetic').eq('user_id', PUBLIC_USER_ID).order('day', { ascending: false }).limit(90)
  return error ? json(500, { error: 'could not read' }) : json(200, { days: data })
}

export async function DELETE() {
  if (!writeAllowed()) return json(429, { error: 'too many requests, try again later' })
  // A wipe removes only the live view: tombstones go on the chain first, so Restore from chain can bring the days back.
  const admin = createAdminClient()
  try { await recordWrite('self_daily', 'delete', await selectAll(admin, 'self_daily', 'user_id, day', ['user_id', PUBLIC_USER_ID])) } catch { return json(500, { error: 'could not delete' }) }
  const { error } = await admin.from('self_daily').delete().eq('user_id', PUBLIC_USER_ID)
  return error ? json(500, { error: 'could not delete' }) : json(200, { ok: true })
}
