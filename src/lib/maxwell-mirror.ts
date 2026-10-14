// Maxwell mirror: pure logic for POST /api/ingest/maxwell-chain (relative imports so Node tests can load it).
//
// The owner's Maxwell chain is copied block by block onto the public chain ledger (table 'maxwell_chain', op 'insert',
// row_id = String(index)). This is a mirror, not consensus: we check shape, size, linkage and idempotency.
import { MAXWELL_ZERO, validateMaxwellBlock, type MaxwellBlock } from './maxwell-block.ts'

export const MAX_BLOCKS_PER_CALL = 50
export const MAX_BODY_BYTES = 256 * 1024

export type RejectCode = 'invalid' | 'conflict' | 'gap' | 'link' | 'duplicate'
export interface Rejection { index: number | null; code: RejectCode; reason: string }

export type ParsedBody = { ok: true; blocks: unknown[] } | { ok: false; status: number; error: string }

/** Raw request text -> the list of (still unvalidated) blocks. */
export function parseMirrorBody(text: string): ParsedBody {
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'body too large' }
  let json: unknown
  try { json = JSON.parse(text) } catch { return { ok: false, status: 400, error: 'invalid json' } }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, status: 400, error: 'body must be an object' }
  const keys = Object.keys(json)
  if (keys.length !== 1 || keys[0] !== 'blocks') return { ok: false, status: 400, error: 'body must be exactly {blocks: [...]}' }
  const blocks = (json as { blocks: unknown }).blocks
  if (!Array.isArray(blocks) || blocks.length < 1) return { ok: false, status: 400, error: 'blocks must be a non-empty list' }
  if (blocks.length > MAX_BLOCKS_PER_CALL) return { ok: false, status: 400, error: `at most ${MAX_BLOCKS_PER_CALL} blocks per call` }
  return { ok: true, blocks }
}

/** Indexes whose stored hash the plan needs: each block's own index and the one before it. */
export function neededIndexes(blocks: unknown[]): number[] {
  const s = new Set<number>()
  for (const b of blocks) {
    const i = (b as { index?: unknown } | null)?.index
    if (typeof i === 'number' && Number.isSafeInteger(i) && i >= 0) { s.add(i); if (i > 0) s.add(i - 1) }
  }
  return [...s].sort((a, b) => a - b)
}

export interface Plan { accepted: MaxwellBlock[]; skipped: number; rejected: Rejection[] }

/** Decides what to write. `mirrored` maps already-mirrored index -> hash. Nothing here writes; the caller writes `accepted`
 *  only when `rejected` is empty. A block whose index is mirrored with the same hash is skipped; with another hash it is a conflict. */
export function planMaxwellMirror(blocks: unknown[], mirrored: ReadonlyMap<number, string>): Plan {
  const rejected: Rejection[] = []
  const valid: MaxwellBlock[] = []
  for (const raw of blocks) {
    const v = validateMaxwellBlock(raw)
    if (v.ok) valid.push(v.block)
    else {
      const i = (raw as { index?: unknown } | null)?.index
      rejected.push({ index: typeof i === 'number' && Number.isSafeInteger(i) ? i : null, code: 'invalid', reason: v.reason })
    }
  }
  valid.sort((a, b) => a.index - b.index)
  const known = new Map(mirrored)
  const seen = new Set<number>()
  const accepted: MaxwellBlock[] = []
  let skipped = 0
  for (const b of valid) {
    if (seen.has(b.index)) { rejected.push({ index: b.index, code: 'duplicate', reason: 'index appears twice in this call' }); continue }
    seen.add(b.index)
    const have = known.get(b.index)
    if (have !== undefined) {
      if (have === b.hash) skipped += 1
      else rejected.push({ index: b.index, code: 'conflict', reason: 'index is already mirrored with a different hash; it is never overwritten' })
      continue
    }
    const expected = b.index === 0 ? MAXWELL_ZERO : known.get(b.index - 1)
    if (expected === undefined) { rejected.push({ index: b.index, code: 'gap', reason: `block ${b.index - 1} is not mirrored yet` }); continue }
    if (b.previous_hash !== expected) { rejected.push({ index: b.index, code: 'link', reason: 'previous_hash does not match the previous block' }); continue }
    accepted.push(b)
    known.set(b.index, b.hash)
  }
  return { accepted, skipped, rejected }
}

/** 409 when anything conflicts, 422 for linkage/gap/duplicate, 400 for malformed blocks, 200 otherwise. */
export function statusFor(plan: Plan): number {
  if (!plan.rejected.length) return 200
  if (plan.rejected.some((r) => r.code === 'conflict')) return 409
  if (plan.rejected.some((r) => r.code === 'gap' || r.code === 'link' || r.code === 'duplicate')) return 422
  return 400
}
