export const QWEN_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'
export const QWEN_ENDPOINT = 'https://rabbitsoftware-qwen.rabbitsoftware-gateway.workers.dev/v1/chat/completions'

export class QwenError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'QwenError'
    this.status = status
  }
}

export async function askQwen(prompt: string, system: string, maxTokens = 700) {
  const response = await fetch(QWEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.rabbitsoftware.io' },
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: maxTokens, temperature: 0.2,
    }),
  })
  const data: { error?: string; choices?: { message?: { content?: string } }[] } = await response.json()
  if (!response.ok) throw new QwenError(response.status, data.error || `Hosted Qwen returned HTTP ${response.status}.`)
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new QwenError(502, 'Hosted Qwen returned no answer.')
  return text.trim()
}
