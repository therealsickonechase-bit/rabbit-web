import { createClient } from '@/lib/supabase/server'

// Latest EEG band samples for the 3D brain. Owner only: the database's row-level security enforces it as well
// (a member's query simply returns nothing), this check just gives a clear status code.
export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'sign in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  const { data: isOwner } = await sb.rpc('is_owner')
  if (isOwner !== true) return Response.json({ error: 'owner only' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })

  const since = new Date(Date.now() - 30_000).toISOString()
  const { data, error } = await sb
    .from('eeg_band_samples')
    .select('channel, band, power, rel_power, ts, board, session')
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(800)
  if (error) return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  return Response.json({ now: new Date().toISOString(), samples: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}
