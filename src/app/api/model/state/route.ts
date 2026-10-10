import { bodyStateJson, parseStateQuery } from '@/lib/body-api'

// Computed from the model alone (a pure function of scenario, pathway and time), so it is public and cacheable.
const OPEN = { 'Access-Control-Allow-Origin': '*' }

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const parsed = parseStateQuery({ scenario: q.get('scenario'), system: q.get('system'), t: q.get('t') })
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: OPEN })
  return Response.json(bodyStateJson(parsed.system, parsed.scenario, parsed.t), { headers: { ...OPEN, 'Cache-Control': 'public, max-age=60, s-maxage=300' } })
}
