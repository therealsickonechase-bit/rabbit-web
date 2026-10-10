import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ILLUSTRATION_STYLES, illustrationPrompt } from '@/lib/body-api'
import { ORGAN_IDS } from '@/lib/body'
import { SCENARIO_IDS, SYSTEM_IDS } from '@/lib/neuro'

// AI illustration of the chosen scenario, made with Cloudflare Workers AI (FLUX.1 schnell). Owner only.
// The prompt is built on the server from the model alone (scenario, pathway, organ, style), so no free text and no live EEG, ECG or
// EMG value is ever sent to the image model.

const MODEL = '@cf/black-forest-labs/flux-1-schnell'
const body = z.object({
  scenario: z.enum(SCENARIO_IDS as [string, ...string[]]),
  system: z.enum(['none', ...SYSTEM_IDS] as [string, ...string[]]).default('none'),
  organ: z.enum(ORGAN_IDS as [string, ...string[]]).nullable().default(null),
  style: z.enum(ILLUSTRATION_STYLES).default('textbook diagram'),
}).strict()

// Best-effort spend guard that needs no database: a minimum gap and an hourly cap per Worker instance.
const recent: number[] = []
const MIN_GAP_MS = 6000, HOURLY_CAP = 30

type Ai = { run(model: string, input: Record<string, unknown>): Promise<{ image?: string }> }
const no = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return no(401, 'sign in')
  const { data: isOwner } = await sb.rpc('is_owner')
  if (isOwner !== true) return no(403, 'owner only')

  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return no(400, 'scenario, system, organ and style must come from the lists in the page')
  const now = Date.now()
  while (recent.length && now - recent[0] > 3600_000) recent.shift()
  if (recent.length >= HOURLY_CAP) return no(429, 'Hourly illustration limit reached. Try again later.')
  if (recent.length && now - recent[recent.length - 1] < MIN_GAP_MS) return no(429, 'One illustration at a time: wait a few seconds.')

  const ai = env.AI as Ai | undefined
  if (!ai) return no(503, 'Image generation is not available on this server.')
  const { scenario, system, organ, style } = parsed.data
  const prompt = illustrationPrompt(scenario as never, system as never, organ, style)
  recent.push(now)
  try {
    const out = await ai.run(MODEL, { prompt, steps: 4 })
    if (!out?.image || out.image.length > 6_000_000) return no(502, 'The image model returned nothing usable.')
    return Response.json({ image: `data:image/jpeg;base64,${out.image}`, prompt, model: MODEL }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('illustration failed', e instanceof Error ? e.message : 'unknown')
    return no(502, 'The image model failed. Try again later.')
  }
}
