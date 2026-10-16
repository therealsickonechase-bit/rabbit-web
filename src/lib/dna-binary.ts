// DNA as binary, for the public chain: an exact, reversible A/C/G/T view of any bytes (a block hash), and a SHA-256 fingerprint of a nucleotide sequence.
// The same encoding as dna-chain/dna_binary_codec.py and research-agents/dna_fingerprint.py (a shared test vector keeps them identical):
//   A=00 C=01 G=10 T=11, four bases per byte. A fingerprint is SHA-256 of (length as 4 big-endian bytes) + the sequence packed at 2 bits per base, zero-padded to whole bytes.
// This is an encoding, not a biological claim, and it never reads a person's genome: the chain only ever carries hashes and these letters of a hash.
// No imports, so Node tests, Workers and browsers all run it (the fingerprint uses WebCrypto).

const BASES = ['A', 'C', 'G', 'T'] as const
const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }
export const MAX_BASES = 1_000_000

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim().toLowerCase()
  if (!h || h.length % 2 || /[^0-9a-f]/.test(h)) throw new Error('expected a hex string of whole bytes')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

export const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** Every byte becomes 4 bases, most significant bits first. */
export function encodeToDna(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += BASES[(b >> 6) & 3] + BASES[(b >> 4) & 3] + BASES[(b >> 2) & 3] + BASES[b & 3]
  return out
}

/** The exact inverse. Anything but A/C/G/T, or a length that is not a multiple of 4, is refused. */
export function decodeFromDna(strand: string): Uint8Array {
  const s = strand.trim().toUpperCase()
  if (/[^ACGT]/.test(s)) throw new Error('only A, C, G and T are valid')
  if (s.length % 4) throw new Error('the length must be a multiple of 4 (4 bases make one byte)')
  const out = new Uint8Array(s.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = (CODE[s[i * 4]] << 6) | (CODE[s[i * 4 + 1]] << 4) | (CODE[s[i * 4 + 2]] << 2) | CODE[s[i * 4 + 3]]
  return out
}

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' }
export const complementStrand = (s: string) => [...s.toUpperCase()].map((c) => COMPLEMENT[c] ?? '').join('')

export function gcContent(s: string): number {
  const u = s.toUpperCase()
  if (!u) return 0
  let gc = 0
  for (const c of u) if (c === 'G' || c === 'C') gc++
  return gc / u.length
}

export interface DnaView { dna: string; bases: number; gcContent: number; complement: string }

/** A hash shown as a strand: 64 hex characters (a SHA-256) give 128 bases. */
export function dnaView(hexHash: string): DnaView {
  const dna = encodeToDna(hexToBytes(hexHash))
  return { dna, bases: dna.length, gcContent: Math.round(gcContent(dna) * 10000) / 10000, complement: complementStrand(dna) }
}

/** The sequence at 2 bits per base, padded with zero bits on the right to whole bytes. */
export function packedBytes(seq: string): Uint8Array {
  const s = seq.trim().toUpperCase()
  if (s.length > MAX_BASES) throw new Error(`sequence longer than ${MAX_BASES} bases`)
  if (/[^ACGT]/.test(s)) throw new Error('only A, C, G and T are valid')
  const out = new Uint8Array(Math.ceil(s.length / 4))
  for (let i = 0; i < s.length; i++) out[i >> 2] |= CODE[s[i]] << (6 - 2 * (i & 3))
  return out
}

/** SHA-256 over the length and the packed sequence. Two sequences are the same exactly when their fingerprints match. */
export async function fingerprint(seq: string): Promise<string> {
  const s = seq.trim().toUpperCase()
  const packed = packedBytes(s)
  const data = new Uint8Array(4 + packed.length)
  new DataView(data.buffer).setUint32(0, s.length, false)
  data.set(packed, 4)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
}

export const sameSequence = async (a: string, b: string) => (await fingerprint(a)) === (await fingerprint(b))
