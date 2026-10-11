import { SECTIONS, bodyModelJson, type Section } from '@/lib/body-api'

// Open, read-only teaching data: the same for everyone, no accounts, no live data. Safe to cache and to call from any origin.
const OPEN = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' }

export async function GET(request: Request) {
  const section = new URL(request.url).searchParams.get('section')
  if (section !== null && !(SECTIONS as readonly string[]).includes(section)) {
    return Response.json({ error: `section must be one of ${SECTIONS.join(', ')}` }, { status: 400, headers: OPEN })
  }
  return Response.json(bodyModelJson((section as Section | null) ?? undefined), { headers: OPEN })
}
