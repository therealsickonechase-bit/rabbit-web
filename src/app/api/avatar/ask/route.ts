import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/secrets'
import { summarize } from '@/lib/summarize'
import { AVATAR_ASK_LIMITS, buildAvatarSystem, cleanQuestion } from '@/lib/avatar-qa'
import { INTENTS } from '@/lib/avatar-mind'
import { SCENARIO_IDS } from '@/lib/neuro'

// Optional free conversation with the avatar, answered by Claude with the SIGNED-IN PERSON'S OWN Anthropic key (the one saved in Settings).
// What is sent to Anthropic: the question the person typed, the last few lines of this chat, and the avatar's state as WORDS (mood, activity, hormone levels,
// scenario). No EEG, heart or hormone numbers and nothing from the person's data portrait ever goes in. The built-in answers (no AI service) do not use this route.

const body = z.object({
  question: z.string(),
  state: z.object({
    emotion: z.string().max(24), intent: z.enum(INTENTS), scenario: z.enum(SCENARIO_IDS as [string, ...string[]]),
    source: z.enum(['simulated twin', 'live signals']), cortisol: z.enum(['low', 'typical', 'high']), melatonin: z.enum(['low', 'typical', 'high']),
  }).strict(),
  history: z.array(z.object({ role: z.enum(['you', 'avatar']), text: z.string().max(AVATAR_ASK_LIMITS.question * 3) }).strict()).max(AVATAR_ASK_LIMITS.history).default([]),
}).strict()

// best-effort spend guard that needs no database: an hourly cap per person per Worker instance (their own key pays, this just stops runaway loops)
const hits = new Map<string, number[]>()
const HOURLY_CAP = 30

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user || !user.email_confirmed_at) return no(401, 'Sign in first.')

  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return no(400, 'That request was not understood.')
  const q = cleanQuestion(parsed.data.question)
  if (!q.ok) return no(400, q.error)

  const now = Date.now(), list = (hits.get(user.id) ?? []).filter((t) => now - t < 3600_000)
  if (list.length >= HOURLY_CAP) return no(429, 'Hourly limit for avatar conversations reached. Try again later.')

  const { data: settings } = await createAdminClient().from('user_settings').select('anthropic_key_enc').eq('user_id', user.id).maybeSingle()
  if (!settings?.anthropic_key_enc) return no(409, 'Add your Anthropic key in Settings to chat freely. The built-in answers still work.')

  list.push(now); hits.set(user.id, list)
  const s = parsed.data.state
  const system = buildAvatarSystem({ emotion: s.emotion, intent: s.intent, scenario: s.scenario as never, source: s.source, cortisol: s.cortisol, melatonin: s.melatonin })
  const chat = parsed.data.history.map((h) => `${h.role === 'you' ? 'Person' : 'Avatar'}: ${h.text}`).join('\n')
  const prompt = `${chat ? `Conversation so far:\n${chat}\n\n` : ''}Person: ${q.question}\nAvatar:`

  try {
    const text = await summarize(await decryptSecret(settings.anthropic_key_enc), prompt, system, 400)
    return Response.json({ answer: text.trim().slice(0, 1500) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    if (/credit balance/i.test(m)) return no(402, 'Your Anthropic account has no credits.')
    if (/Anthropic API 40[13]/.test(m)) return no(401, 'Anthropic rejected your saved key. Replace it in Settings.')
    if (/Anthropic API 429/.test(m)) return no(429, 'Anthropic is rate limiting this key. Wait a minute.')
    return no(502, 'The answer could not be generated. Try the built-in answers.')
  }
}
