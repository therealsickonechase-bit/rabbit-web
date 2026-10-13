import { z } from 'zod'

export const WORKSPACE_STORAGE_KEY = 'rabbitos.account-free.v1'

const message = z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(12000) }).strict()
const item = z.object({
  id: z.string().max(80), text: z.string().min(1).max(4000),
  kind: z.enum(['note', 'collection', 'task']), done: z.boolean(),
}).strict()
export const workspaceSchema = z.object({
  name: z.string().max(80),
  messages: z.array(message).max(100),
  items: z.array(item).max(100),
}).strict()
export type LocalWorkspace = z.infer<typeof workspaceSchema>
export const emptyWorkspace = (): LocalWorkspace => ({ name: 'My workspace', messages: [], items: [] })

export function readWorkspace(raw: string | null): LocalWorkspace {
  if (raw === null) return emptyWorkspace()
  if (raw.length > 2000000) throw new Error('The saved workspace is too large. Export or clear it in Settings.')
  return workspaceSchema.parse(JSON.parse(raw))
}

export const feedSchema = z.object({
  counts: z.record(z.string(), z.number().nonnegative()),
  chain: z.object({
    audit_head_seq: z.number().nullable(),
    audit_head_hash: z.string().nullable(),
    audit_head_time: z.string().nullable(),
  }),
  recent: z.array(z.object({
    id: z.string(), source: z.string(), title: z.string(),
    url: z.string().nullable(), first_seen_at: z.string(),
  })).max(20),
})
export type PublicFeed = z.infer<typeof feedSchema>

export function publicLink(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch { return null }
}

export function researchContext(feed: PublicFeed | null, question: string) {
  if (!feed) return ''
  const words = question.toLowerCase().split(/\W+/).filter((word) => word.length > 2)
  return feed.recent
    .map((record) => ({ record, score: words.filter((word) => record.title.toLowerCase().includes(word)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ record }, index) => `[${index + 1}] ${record.title.slice(0, 400)} (${record.source}): ${publicLink(record.url) ?? 'no public link'}`)
    .join('\n')
}
