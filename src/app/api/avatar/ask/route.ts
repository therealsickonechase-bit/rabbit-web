import { z } from 'zod'
import { AVATAR_ASK_LIMITS, buildAvatarSystem, cleanQuestion } from '@/lib/avatar-qa'
import { INTENTS } from '@/lib/avatar-mind'
import { SCENARIO_IDS } from '@/lib/neuro'
import { askQwen, QwenError, QWEN_MODEL } from '@/lib/qwen'

const body = z.object({
  provider: z.literal('qwen'),
  consent: z.literal(true),
  question: z.string().max(AVATAR_ASK_LIMITS.question),
  state: z.object({
    emotion: z.string().max(24), intent: z.enum(INTENTS), scenario: z.enum(SCENARIO_IDS),
    source: z.enum(['simulated twin', 'live signals']),
    cortisol: z.enum(['low', 'typical', 'high']), melatonin: z.enum(['low', 'typical', 'high']),
  }).strict(),
  history: z.array(z.object({ role: z.enum(['you', 'avatar']), text: z.string().max(AVATAR_ASK_LIMITS.question * 3) }).strict()).max(AVATAR_ASK_LIMITS.history).default([]),
}).strict()

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return no(415, 'Send a JSON request.')
  const reader = request.body?.getReader()
  if (!reader) return no(400, 'The request body is missing.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 65536) { await reader.cancel(); return no(413, 'The request is too large.') }
      chunks.push(value)
    }
  } catch {
    console.error('Avatar request body could not be read')
    return no(400, 'The request body could not be read.')
  }
  const raw = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length }
  let input: unknown
  try { input = JSON.parse(new TextDecoder().decode(raw)) } catch { return no(400, 'Send valid JSON.') }
  const parsed = body.safeParse(input)
  if (!parsed.success) return no(400, 'Approve hosted Qwen and send a valid avatar question.')
  const q = cleanQuestion(parsed.data.question)
  if (!q.ok) return no(400, q.error)
  const s = parsed.data.state
  const system = buildAvatarSystem(s)
  const chat = parsed.data.history.map((h) => `${h.role === 'you' ? 'Person' : 'Avatar'}: ${h.text}`).join('\n')
  const prompt = `${chat ? `Conversation so far:\n${chat}\n\n` : ''}Person: ${q.question}\nAvatar:`
  try {
    const text = await askQwen(prompt, system, 400)
    return Response.json({ answer: text.slice(0, 1500), model: QWEN_MODEL }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(JSON.stringify({
      event: 'avatar_qwen_failed', type: e instanceof Error ? e.name : 'Error',
      transport: e instanceof Error && /fetch|connect|network|certificate|socket/i.test(e.message),
      signal: e instanceof Error && /signal|abort/i.test(e.message),
      missingFunction: e instanceof Error && /not a function/i.test(e.message),
      frames: e instanceof Error ? e.stack?.split('\n').slice(1, 4) : [],
    }))
    return no(e instanceof QwenError ? e.status : 502, e instanceof QwenError ? e.message : 'Hosted Qwen could not answer. No other provider was contacted.')
  }
}
