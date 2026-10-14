import { createAdminClient } from '@/lib/supabase/admin'

// Latest EEG band samples for the 3D brain. Open to everyone (no login); read through the server with an explicit column list.
export async function GET() {
  const sb = createAdminClient()
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
