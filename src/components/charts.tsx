// Dependency-free SVG charts. Colours come from the page's CSS variables so light/dark both work.

import type { VariantClass } from '@/lib/twin-stats'

export interface ZPoint { t: number; z: number }
export interface Trend { slope: number; intercept: number }

/** Readings as z-scores against their stored baseline, with ±1 and ±2 SD bands, a straight-line trend and its projection. */
export function ZChart({ points, trend, projectMs }: { points: ZPoint[]; trend: Trend | null; projectMs: number }) {
  const W = 720, H = 240, L = 40, R = 12, T = 12, B = 28
  if (!points.length) return <p className="text-sm text-muted">No readings yet.</p>
  const t0 = points[0].t
  const t1 = points[points.length - 1].t + projectMs
  const lim = Math.max(3, Math.ceil(Math.max(...points.map((p) => Math.abs(p.z)))))
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R)
  const y = (z: number) => T + ((lim - z) / (2 * lim)) * (H - T - B)
  const endObserved = points[points.length - 1].t
  const clamp = (z: number) => Math.max(-lim, Math.min(lim, z))
  const at = (t: number) => y(clamp(trend ? trend.intercept + (trend.slope * (t - t0)) / 3600000 : 0))
  const line = (a: number, b: number) => trend && `${x(a)},${at(a)} ${x(b)},${at(b)}`
  const hours = Math.max(1, Math.round((t1 - t0) / 3600000))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label={`Readings against baseline over ${hours} hours, with trend and projection`}>
      <rect x={L} y={y(2)} width={W - L - R} height={y(-2) - y(2)} className="fill-warn/10" />
      <rect x={L} y={y(1)} width={W - L - R} height={y(-1) - y(1)} className="fill-ok/15" />
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="stroke-ok" strokeWidth="1" />
      {[-lim, -2, -1, 0, 1, 2, lim].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <g key={v}>
          <text x={L - 6} y={y(v) + 3} textAnchor="end" className="fill-muted" fontSize="10">{v > 0 ? `+${v}` : v}</text>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth="0.5" />
        </g>
      ))}
      <line x1={x(endObserved)} x2={x(endObserved)} y1={T} y2={H - B} className="stroke-muted" strokeDasharray="3 3" strokeWidth="1" />
      <text x={x(endObserved) + 4} y={T + 10} className="fill-muted" fontSize="10">now →  projection</text>
      {points.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(Math.max(-lim, Math.min(lim, p.z)))} r="2.5" className={Math.abs(p.z) <= 1 ? 'fill-ok' : Math.abs(p.z) <= 2 ? 'fill-warn' : 'fill-bad'} />
      ))}
      {trend && <polyline points={line(t0, endObserved)!} className="stroke-info" fill="none" strokeWidth="2" />}
      {trend && projectMs > 0 && <polyline points={line(endObserved, t1)!} className="stroke-info" fill="none" strokeWidth="2" strokeDasharray="6 4" />}
      <text x={W - R} y={H - 8} textAnchor="end" className="fill-muted" fontSize="10">{hours} h window (z-score: 0 = at baseline)</text>
    </svg>
  )
}

const CLASS_FILL: Record<VariantClass, string> = {
  Pathogenic: 'fill-bad',
  'Likely pathogenic': 'fill-warn',
  'Uncertain significance': 'fill-info',
  'Likely benign': 'fill-ok/60',
  Benign: 'fill-ok',
  Other: 'fill-muted',
}
export const classSwatch: Record<VariantClass, string> = {
  Pathogenic: 'bg-bad', 'Likely pathogenic': 'bg-warn', 'Uncertain significance': 'bg-info', 'Likely benign': 'bg-ok/60', Benign: 'bg-ok', Other: 'bg-muted',
}

/** One horizontal stacked bar per gene, split by ClinVar classification. */
export function VariantBars({ genes, order }: { genes: { gene: string; counts: Record<VariantClass, number>; total: number }[]; order: readonly VariantClass[] }) {
  if (!genes.length) return <p className="text-sm text-muted">No variant records yet.</p>
  const max = Math.max(...genes.map((g) => g.total))
  const rowH = 28, W = 720, L = 90, R = 40
  return (
    <svg viewBox={`0 0 ${W} ${genes.length * rowH + 6}`} className="w-full h-auto" role="img" aria-label="Variant classifications per gene">
      {genes.map((g, i) => {
        let x = L
        const unit = (W - L - R) / max
        return (
          <g key={g.gene} transform={`translate(0 ${i * rowH + 4})`}>
            <text x={L - 8} y="15" textAnchor="end" className="fill-fg" fontSize="12" fontWeight="600">{g.gene}</text>
            {order.map((c) => {
              const w = g.counts[c] * unit
              if (!w) return null
              const rect = <rect key={c} x={x} y="2" width={w} height="18" className={CLASS_FILL[c]}><title>{`${g.gene}: ${g.counts[c]} ${c}`}</title></rect>
              x += w
              return rect
            })}
            <text x={x + 6} y="15" className="fill-muted" fontSize="11">{g.total}</text>
          </g>
        )
      })}
    </svg>
  )
}
