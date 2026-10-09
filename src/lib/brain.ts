// Geometry and linking logic for the 3D brain view. Pure functions, tested in tests/brain.test.mjs.
//
// What is real here: electrode names (international 10-20 system), the five EEG bands, and band powers coming
// from the BrainFlow bridge. What is schematic: electrode positions (approximate points on a sphere) and the
// head shape. Links between research, chemistry and genes are CO-MENTIONS in stored record titles, not claims
// of cause.

export const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const
export type Band = (typeof BANDS)[number]

export const BAND_HZ: Record<Band, string> = { delta: '1–4 Hz', theta: '4–8 Hz', alpha: '8–13 Hz', beta: '13–30 Hz', gamma: '30–45 Hz' }

export type Region = 'frontal' | 'central' | 'temporal' | 'parietal' | 'occipital'

/** polar angle from Cz (theta) and azimuth from the nose, positive to the right (phi), both in degrees. */
const POLAR: Record<string, [number, number]> = {
  Fp1: [72, -18], Fp2: [72, 18], Fpz: [72, 0],
  F7: [72, -54], F5: [60, -48], F3: [50, -45], F1: [42, -22], Fz: [36, 0], F2: [42, 22], F4: [50, 45], F6: [60, 48], F8: [72, 54],
  T7: [72, -90], C3: [36, -90], Cz: [0, 0], C4: [36, 90], T8: [72, 90],
  P7: [72, -126], P3: [50, -135], Pz: [36, 180], P4: [50, 135], P8: [72, 126],
  PO7: [72, -144], PO8: [72, 144],
  O1: [72, -162], Oz: [72, 180], O2: [72, 162],
}
const ALIAS: Record<string, string> = { T3: 'T7', T4: 'T8', T5: 'P7', T6: 'P8' }

export function canonicalChannel(name: string) {
  const n = name.trim()
  const key = Object.keys(POLAR).find((k) => k.toLowerCase() === n.toLowerCase())
  if (key) return key
  const a = Object.keys(ALIAS).find((k) => k.toLowerCase() === n.toLowerCase())
  return a ? ALIAS[a] : null
}

/** Unit-sphere position: x to the right, y toward the nose, z up. Null for channels not on the 10-20 map. */
export function electrodePosition(name: string) {
  const c = canonicalChannel(name)
  if (!c) return null
  const [t, p] = POLAR[c].map((d) => (d * Math.PI) / 180)
  return { name: c, x: Math.sin(t) * Math.sin(p), y: Math.sin(t) * Math.cos(p), z: Math.cos(t) }
}

export function regionOf(name: string): Region | null {
  const c = canonicalChannel(name)
  if (!c) return null
  if (c.startsWith('Fp') || c.startsWith('F')) return 'frontal'
  if (c.startsWith('C')) return 'central'
  if (c.startsWith('T')) return 'temporal'
  if (c.startsWith('PO') || c.startsWith('O')) return 'occipital'
  if (c.startsWith('P')) return 'parietal'
  return null
}

export interface EegSample { channel: string; band: string; power: number; rel_power: number | null; ts: string }

/** Newest sample per channel+band, with the channel normalised to its 10-20 name. */
export function latestByChannel(samples: EegSample[]) {
  const out = new Map<string, Partial<Record<Band, { power: number; rel: number | null; ts: string }>>>()
  for (const s of samples) {
    const ch = canonicalChannel(s.channel)
    if (!ch || !(BANDS as readonly string[]).includes(s.band)) continue
    const cur = out.get(ch) ?? {}
    const prev = cur[s.band as Band]
    if (!prev || s.ts > prev.ts) cur[s.band as Band] = { power: s.power, rel: s.rel_power, ts: s.ts }
    out.set(ch, cur)
  }
  return out
}

/** The band with the largest relative power, or null when nothing is known. */
export function dominantBand(b: Partial<Record<Band, { power: number; rel: number | null }>>): Band | null {
  let best: Band | null = null
  let bestV = -1
  for (const band of BANDS) {
    const e = b[band]
    if (!e) continue
    const v = e.rel ?? e.power
    if (v > bestV) { bestV = v; best = band }
  }
  return best
}

// ---- Co-mention links between research, chemistry, genes and brain terms ---------------------------------

export interface LinkRecord { id: string; source: string; title: string; meta?: Record<string, unknown> | null }
export interface Term { kind: 'chemical' | 'band' | 'region' | 'gene'; name: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const word = (s: string) => new RegExp(`(^|[^a-z0-9])${escape(s)}([^a-z0-9]|$)`, 'i')
const EEG_CONTEXT = /\b(eeg|electroenceph\w*|brain|cortical|cortex|neural|neuro\w*|oscillation\w*|rhythm\w*)\b/i

/** Terms found in one record. Bands and regions must appear alongside a brain/EEG word to avoid unrelated "alpha" etc. */
const GREEK: Record<string, string> = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', θ: 'theta' }
const spellGreek = (s: string) => s.replace(/[αβγδθ]/g, (c) => ` ${GREEK[c]} `)

export function termsIn(rec: LinkRecord, vocab: { chemicals: string[]; genes: string[] }): Term[] {
  const text = spellGreek(rec.title)
  const found: Term[] = []
  for (const c of vocab.chemicals) if (word(c).test(text)) found.push({ kind: 'chemical', name: c.toLowerCase() })
  for (const g of vocab.genes) if (new RegExp(`(^|[^A-Za-z0-9])${escape(g)}([^A-Za-z0-9]|$)`).test(text) || String(rec.meta?.gene ?? '').toUpperCase().split(/[,\s]+/).includes(g.toUpperCase())) found.push({ kind: 'gene', name: g.toUpperCase() })
  if (EEG_CONTEXT.test(text)) {
    for (const b of BANDS) if (word(b).test(text)) found.push({ kind: 'band', name: b })
    for (const r of ['frontal', 'central', 'temporal', 'parietal', 'occipital'] as Region[]) if (word(r).test(text)) found.push({ kind: 'region', name: r })
  }
  return found
}

export interface LinkGraph {
  /** term -> record ids that mention it */
  mentions: Map<string, string[]>
  /** pairs of different-kind terms mentioned in the same record */
  edges: { a: Term; b: Term; records: string[] }[]
}

const key = (t: Term) => `${t.kind}:${t.name}`

export function buildLinks(records: LinkRecord[], vocab: { chemicals: string[]; genes: string[] }): LinkGraph {
  const mentions = new Map<string, string[]>()
  const pairs = new Map<string, { a: Term; b: Term; records: string[] }>()
  for (const r of records) {
    const terms = termsIn(r, vocab)
    for (const t of terms) mentions.set(key(t), [...(mentions.get(key(t)) ?? []), r.id])
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        if (terms[i].kind === terms[j].kind) continue
        const [a, b] = key(terms[i]) < key(terms[j]) ? [terms[i], terms[j]] : [terms[j], terms[i]]
        const k = `${key(a)}|${key(b)}`
        const cur = pairs.get(k) ?? { a, b, records: [] }
        cur.records.push(r.id)
        pairs.set(k, cur)
      }
    }
  }
  return { mentions, edges: [...pairs.values()].sort((x, y) => y.records.length - x.records.length) }
}
