import { z } from 'zod'

// Rules for the agent task queue. Kept free of database code so they can be tested directly.

export const GENES = ['BRCA1', 'BRCA2', 'PARP1'] as const
export const MAX_OPEN_PER_USER = 5
export const MAX_PER_DAY = 20
export const MAX_PROPOSAL_RECORDS = 50

export const KINDS = ['research_topic', 'crispr_guides', 'brain_search'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_LABEL: Record<Kind, string> = {
  research_topic: 'Research a topic (trials, papers, preprints)',
  crispr_guides: 'Find CRISPR guide candidates for a gene',
  brain_search: 'Search brain / EEG literature',
}

/** Which record sources an agent may propose for each kind of task. */
export const ALLOWED_SOURCES: Record<Kind, readonly string[]> = {
  research_topic: ['pubmed', 'europepmc', 'trial'],
  crispr_guides: ['crispr_guide'],
  brain_search: ['brain_paper', 'brain_preprint'],
}

const phrase = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9 .,'()+\-/]+$/, 'Use letters, numbers and basic punctuation only.')

const paramSchemas = {
  research_topic: z.object({ topic: phrase, biomarker: phrase.optional() }).strict(),
  crispr_guides: z.object({ gene: z.enum(GENES), top: z.number().int().min(1).max(10).default(5) }).strict(),
  brain_search: z.object({ query: phrase }).strict(),
} satisfies Record<Kind, z.ZodType>

export function parseTaskParams(kind: string, raw: unknown) {
  if (!(KINDS as readonly string[]).includes(kind)) return { ok: false as const, error: 'Unknown task type.' }
  const r = paramSchemas[kind as Kind].safeParse(raw)
  return r.success ? { ok: true as const, kind: kind as Kind, params: r.data as Record<string, unknown> } : { ok: false as const, error: r.error.issues[0]?.message ?? 'Invalid input.' }
}

const httpUrl = z.string().max(500).refine((u) => /^https?:\/\//i.test(u), 'url must be http(s)')

export const proposalSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  records: z.array(z.object({
    id: z.string().min(1).max(200),
    source: z.string().min(1).max(40),
    title: z.string().min(1).max(500),
    url: httpUrl.nullish(),
    meta: z.record(z.string(), z.unknown()).default({}),
  })).max(MAX_PROPOSAL_RECORDS),
})
export type Proposal = z.infer<typeof proposalSchema>

/** A proposal is accepted only if every record is of a source allowed for that kind of task, with ids not colliding. */
export function checkProposal(kind: Kind, raw: unknown) {
  const p = proposalSchema.safeParse(raw)
  if (!p.success) return { ok: false as const, error: p.error.issues[0]?.message ?? 'Invalid proposal.' }
  const allowed = ALLOWED_SOURCES[kind]
  const bad = p.data.records.find((r) => !allowed.includes(r.source))
  if (bad) return { ok: false as const, error: `Source "${bad.source}" is not allowed for ${kind}.` }
  if (new Set(p.data.records.map((r) => r.id)).size !== p.data.records.length) return { ok: false as const, error: 'Duplicate record ids.' }
  return { ok: true as const, proposal: p.data }
}

export const agentRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), agent: z.object({ node_id: z.string().min(1).max(128) }), lease_seconds: z.number().int().min(30).max(3600).default(600) }),
  z.object({ action: z.literal('submit'), agent: z.object({ node_id: z.string().min(1).max(128) }), task_id: z.string().uuid(), result: z.unknown() }),
  z.object({ action: z.literal('fail'), agent: z.object({ node_id: z.string().min(1).max(128) }), task_id: z.string().uuid(), error: z.string().max(500) }),
])
