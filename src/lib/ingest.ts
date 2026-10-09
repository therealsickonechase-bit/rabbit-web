import { z } from 'zod'

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const nodeId = z.string().min(1).max(128)

const topicRef = z.object({
  topic: z.string().min(1),
  biomarker: z.string().min(1).nullish(),
})

export const ingestSchema = z.object({
  agent: z.object({
    node_id: nodeId,
    kind: z.enum(['research', 'ai_participant', 'network_node']),
    twin_id: z.string().uuid().nullish(),
  }),
  topics: z
    .array(
      topicRef.extend({
        parent: topicRef.nullish(),
        status: z.enum(['queued', 'explored', 'dropped']).default('queued'),
      })
    )
    .max(500)
    .default([]),
  runs: z
    .array(
      z.object({
        cycle: z.number().int().nonnegative(),
        topic: topicRef.nullish(),
        new_ids_found: z.number().int().nonnegative().default(0),
        summary: z.string().nullish(),
      })
    )
    .max(100)
    .default([]),
  records: z
    .array(
      z.object({
        id: z.string().min(1),
        source: z.string().min(1),
        title: z.string().min(1),
        url: z.string().nullish(),
        topic: topicRef.nullish(),
        cycle: z.number().int().nonnegative().nullish(),
        meta: z.record(z.string(), z.unknown()).default({}),
        // Already stored, but its title/url/meta changed: overwrite those three fields only.
        refresh: z.boolean().default(false),
      })
    )
    .max(1000)
    .default([]),
  summaries: z
    .array(
      z.object({
        topic: topicRef.nullish(),
        model: z.string().min(1),
        ai_interpretation: z.string().min(1),
        disclaimer: z.string().min(1),
        source_counts: z.record(z.string(), z.unknown()).default({}),
        input_hash: hex64,
      })
    )
    .max(50)
    .default([]),
  blocks: z
    .array(
      z.object({
        block_id: z.string().min(1),
        chain: z.string().min(1).default('network'),
        height: z.number().int().nonnegative().nullish(),
        payload: z.unknown().nullish(),
        source: z.string().min(1),
        das_score: z.number().nullish(),
        hash: z.string().min(1),
        prev_hash: z.string().nullish(),
        mined_at: z.string().datetime({ offset: true }),
      })
    )
    .max(1000)
    .default([]),
  scores: z
    .array(
      z.object({
        mos: z.number().min(1).max(5).nullish(),
        balance: z.number().nullish(),
        ts: z.string().datetime({ offset: true }),
      })
    )
    .max(100)
    .default([]),
  audit: z
    .array(
      z.object({
        seq: z.number().int().nonnegative(),
        ts: z.string().datetime({ offset: true }),
        module: z.string().min(1),
        action: z.string().min(1),
        node_id: nodeId.nullish(),
        details: z.record(z.string(), z.unknown()).default({}),
        prev_hash: hex64,
        hash: hex64,
        code_file: z.string().nullish(),
        code_sha256: z.string().nullish(),
      })
    )
    .max(1000)
    .default([]),
  // Band powers per EEG channel from a BrainFlow/OpenBCI bridge (never raw waveforms).
  eeg: z
    .array(
      z.object({
        session: z.string().min(1).max(64),
        ts: z.string().datetime({ offset: true }),
        channel: z.string().min(1).max(16),
        band: z.enum(['delta', 'theta', 'alpha', 'beta', 'gamma']),
        power: z.number().min(0).finite(),
        rel_power: z.number().min(0).max(1).nullish(),
        board: z.string().min(1).max(40).default('unknown'),
      })
    )
    .max(500)
    .default([]),
})

export type IngestPayload = z.infer<typeof ingestSchema>

export const GENESIS_HASH = '0'.repeat(64)
export const MAX_SKEW_MS = 5 * 60 * 1000

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Signature = hex HMAC-SHA256(secret, `${timestampMs}.${rawBody}`). */
export async function verifySignature(secret: string, timestamp: string, body: string, signature: string) {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false
  const sig = hexToBytes(signature)
  if (!sig) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${timestamp}.${body}`))
}

/** Checks entries are consecutive and hash-linked. Returns an error message or null. */
export function checkAuditLinks(entries: IngestPayload['audit']) {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].seq !== sorted[i - 1].seq + 1) return `audit gap before seq ${sorted[i].seq}`
    if (sorted[i].prev_hash !== sorted[i - 1].hash) return `audit chain broken at seq ${sorted[i].seq}`
  }
  return null
}
