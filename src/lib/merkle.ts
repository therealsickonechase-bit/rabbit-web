// Bitcoin-style Merkle tree over a batch of hashes, with two protections Bitcoin's original design lacked:
//  - domain separation: leaves and inner nodes are hashed with different prefixes, so an inner node can never be
//    passed off as a leaf (second-preimage attack);
//  - an unpaired node is PROMOTED unchanged, never duplicated, so two different batches cannot share a root
//    (the CVE-2012-2459 problem).
// Only the root ever needs to be published (for example anchored on a public ledger); a short proof shows one
// entry belongs to it.

const enc = new TextEncoder()

async function sha256(...parts: Uint8Array[]) {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(len)
  let o = 0
  for (const p of parts) { buf.set(p, o); o += p.length }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
}

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))
const LEAF = new Uint8Array([0x00])
const NODE = new Uint8Array([0x01])

/** Hash of one entry (its own hash string, e.g. an audit entry hash). */
export const leafHash = async (entry: string) => hex(await sha256(LEAF, enc.encode(entry)))
const nodeHash = async (l: string, r: string) => hex(await sha256(NODE, unhex(l), unhex(r)))

/** All levels of the tree, level 0 = leaf hashes, last level = [root]. */
export async function buildLevels(entries: string[]) {
  if (!entries.length) throw new Error('A batch needs at least one entry.')
  let level = await Promise.all(entries.map(leafHash))
  const levels = [level]
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? await nodeHash(level[i], level[i + 1]) : level[i])
    levels.push(next)
    level = next
  }
  return levels
}

export const merkleRoot = async (entries: string[]) => { const l = await buildLevels(entries); return l[l.length - 1][0] }

export interface ProofStep { sibling: string; side: 'left' | 'right' }

/** The siblings from a leaf up to the root. */
export async function merkleProof(entries: string[], index: number): Promise<ProofStep[]> {
  if (index < 0 || index >= entries.length) throw new Error('index out of range')
  const levels = await buildLevels(entries)
  const proof: ProofStep[] = []
  let i = index
  for (let l = 0; l < levels.length - 1; l++) {
    const sib = i % 2 === 0 ? i + 1 : i - 1
    if (sib < levels[l].length) proof.push({ sibling: levels[l][sib], side: i % 2 === 0 ? 'right' : 'left' })
    i = Math.floor(i / 2)
  }
  return proof
}

/** True when `entry` combined with the proof gives `root`. */
export async function verifyProof(entry: string, proof: ProofStep[], root: string) {
  let h = await leafHash(entry)
  for (const s of proof) {
    if (!/^[0-9a-f]{64}$/.test(s.sibling)) return false
    h = s.side === 'left' ? await nodeHash(s.sibling, h) : await nodeHash(h, s.sibling)
  }
  return h === root
}

export const MIN_BATCH = 8
export const MAX_BATCH = 256
