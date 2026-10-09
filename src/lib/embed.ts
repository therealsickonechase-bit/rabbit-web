// Text -> vector helpers for semantic search. The AI call is injected so everything here can be tested offline.

export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'
export const DIMS = 768
export const BATCH = 25

export interface AiLike { run(model: string, input: { text: string[] }): Promise<unknown> }

const META_KEYS = ['gene', 'journal', 'classification', 'status', 'topic', 'query']

/** The text that represents a record: its title plus a few short descriptive fields. */
export function recordText(r: { title: string; source: string; meta?: Record<string, unknown> | null }) {
  const extras = META_KEYS.map((k) => r.meta?.[k]).filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length < 80)
  return [r.title, ...extras].join('. ').slice(0, 1000)
}

function asVectors(out: unknown, expected: number): number[][] {
  const data = (out as { data?: unknown }).data
  if (!Array.isArray(data) || data.length !== expected) throw new Error('unexpected embedding response')
  return data.map((v) => {
    if (!Array.isArray(v) || v.length !== DIMS || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw new Error('bad embedding vector')
    return v as number[]
  })
}

export async function embedTexts(ai: AiLike, texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH)
    out.push(...asVectors(await ai.run(EMBED_MODEL, { text: chunk }), chunk.length))
  }
  return out
}

/** pgvector text form, e.g. "[0.1,0.2]". */
export const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`
