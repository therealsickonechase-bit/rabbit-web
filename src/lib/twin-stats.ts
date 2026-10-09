// Small, pure calculations behind the Twin Atlas page (tested in tests/twin-stats.test.mjs).

export interface Point { x: number; y: number }

/** Ordinary least-squares line through the points, or null when there is nothing to fit. */
export function linearTrend(points: Point[]) {
  const n = points.length
  if (n < 3) return null
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, sxy = 0
  for (const p of points) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my) }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  return { slope, intercept, at: (x: number) => intercept + slope * x }
}

/** How far a z-score is from the reference: inside ±1 SD, ±2 SD, or outside. */
export function zBand(z: number | null | undefined) {
  if (z == null || Number.isNaN(z)) return 'unknown' as const
  const a = Math.abs(z)
  return a <= 1 ? ('within' as const) : a <= 2 ? ('watch' as const) : ('outside' as const)
}

/** Share of readings in each band. */
export function bandShares(zs: (number | null | undefined)[]) {
  const out = { within: 0, watch: 0, outside: 0, unknown: 0 }
  for (const z of zs) out[zBand(z)]++
  const known = out.within + out.watch + out.outside
  return { counts: out, known, pct: (k: 'within' | 'watch' | 'outside') => (known ? Math.round((out[k] / known) * 100) : 0) }
}

const CLASS_ORDER = ['Pathogenic', 'Likely pathogenic', 'Uncertain significance', 'Likely benign', 'Benign'] as const
export type VariantClass = (typeof CLASS_ORDER)[number] | 'Other'

export function variantClass(raw: unknown): VariantClass {
  const s = String(raw ?? '').trim().toLowerCase()
  return CLASS_ORDER.find((c) => c.toLowerCase() === s) ?? 'Other'
}
export const VARIANT_CLASSES: readonly VariantClass[] = [...CLASS_ORDER, 'Other']

/** "BRCA1, LOC111589215" -> "BRCA1": the first listed gene, upper-cased. */
export function primaryGene(raw: unknown) {
  const g = String(raw ?? '').split(',')[0].trim().toUpperCase()
  return g || 'UNKNOWN'
}

export interface VariantRow { id: string; title: string; meta: Record<string, unknown> | null }

/** Counts per gene per class, genes sorted by number of variants (largest first). */
export function groupVariants(rows: VariantRow[]) {
  const genes = new Map<string, Record<VariantClass, number>>()
  for (const r of rows) {
    const g = primaryGene(r.meta?.gene)
    const row = genes.get(g) ?? Object.fromEntries(VARIANT_CLASSES.map((c) => [c, 0])) as Record<VariantClass, number>
    row[variantClass(r.meta?.classification)]++
    genes.set(g, row)
  }
  const total = (c: Record<VariantClass, number>) => VARIANT_CLASSES.reduce((s, k) => s + c[k], 0)
  return [...genes.entries()].map(([gene, counts]) => ({ gene, counts, total: total(counts) })).sort((a, b) => b.total - a.total || a.gene.localeCompare(b.gene))
}

/** Variants the literature classes as disease-causing or probably so. */
export const isConcerning = (raw: unknown) => ['Pathogenic', 'Likely pathogenic'].includes(variantClass(raw))
