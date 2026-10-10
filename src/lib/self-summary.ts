import { z } from 'zod'
import { DIMENSIONS, LEVEL_WORDS } from './self-data.ts'

// Server-side check of what the owner may save. Strict: unknown keys are rejected, so a raw lab value, name or note cannot ride along.
const keys = DIMENSIONS.map((d) => d.key) as [string, ...string[]]
const count = z.number().int().min(0).max(1000)

export const summarySchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')), 'bad date'),
  dims: z.array(z.strictObject({
    key: z.enum(keys), level: z.enum(LEVEL_WORDS), value: z.number().min(0).max(1).nullable(), trend: z.union([z.literal(-1), z.literal(0), z.literal(1)]), n: z.number().int().min(0).max(1_000_000),
  })).max(DIMENSIONS.length),
  lab_flags: z.strictObject({ in_range: count, high: count, low: count }),
  synthetic: z.boolean(),
})
