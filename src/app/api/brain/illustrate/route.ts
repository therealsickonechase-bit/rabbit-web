import { getAi } from '@/lib/runtime-env'
import { z } from 'zod'
import { ILLUSTRATION_STYLES, LEVELS, RHYTHMS, illustrationPrompt } from '@/lib/body-api'
import { ORGAN_IDS } from '@/lib/body'
import { SCENARIO_IDS, SYSTEM_IDS } from '@/lib/neuro'

// AI illustration of the chosen scenario, made with Cloudflare Workers AI (FLUX.1 schnell). Open to everyone, rate limited below.
// The prompt is built on the server from the model alone (scenario, pathway, organ, style) plus, only if you opt in, a few FIXED mood words
// (for example "slow and drifting"). No free text and no EEG, ECG, EMG or hormone number is ever sent to the image model.

const MODEL = '@cf/black-forest-labs/flux-1-schnell'
const body = z.object({
  scenario: z.enum(SCENARIO_IDS as [string, ...string[]]),
  system: z.enum(['none', ...SYSTEM_IDS] as [string, ...string[]]).default('none'),
  organ: z.enum(ORGAN_IDS as [string, ...string[]]).nullable().default(null),
  style: z.enum(ILLUSTRATION_STYLES).default('textbook diagram'),
  // optional, opt-in: only these fixed words, never numbers
  mood: z.object({ arousal: z.enum(LEVELS), rhythm: z.enum(RHYTHMS), cortisol: z.enum(LEVELS), melatonin: z.enum(LEVELS) }).partial().strict().nullable().default(null),
}).strict()

// Best-effort spend guard that needs no database: a minimum gap and an hourly cap per Worker instance.
const recent: number[] = []
const MIN_GAP_MS = 6000, HOURLY_CAP = 30
const MAX_BODY = 2_000

type Ai = { run(model: string, input: Record<string, unknown>): Promise<{ image?: string }> }
const no = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  const text = await request.text().catch(() => '')
  if (text.length > MAX_BODY) return no(413, 'too large')
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* rejected below */ }
  const parsed = body.safeParse(json)
  if (!parsed.success) return no(400, 'scenario, system, organ and style must come from the lists in the page')
  const now = Date.now()
  while (recent.length && now - recent[0] > 3600_000) recent.shift()
  if (recent.length >= HOURLY_CAP) return no(429, 'Hourly illustration limit reached. Try again later.')
  if (recent.length && now - recent[recent.length - 1] < MIN_GAP_MS) return no(429, 'One illustration at a time: wait a few seconds.')

  const ai = (await getAi()) as Ai | undefined
  if (!ai) return no(503, 'Image generation is not available on this server.')
  const { scenario, system, organ, style, mood } = parsed.data
  const prompt = illustrationPrompt(scenario as never, system as never, organ, style, mood)
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
