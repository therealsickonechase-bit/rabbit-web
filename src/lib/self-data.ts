// Frames from the local self-data hub (research-agents: python -m selfdata serve, ws://127.0.0.1:8766) and what the page does with them.
// The hub keeps your own data on your computer; this page only receives summary values and fixed words, validates them, draws them, and turns the WORDS
// (never numbers, lab names or dates) into a prompt for an image model. Pure functions, tested.

export const HUB_URL = 'ws://127.0.0.1:8766'

export const DIMENSIONS = [
  { key: 'sleep', label: 'Sleep', hue: 235 },
  { key: 'recovery', label: 'Recovery (HRV)', hue: 160 },
  { key: 'cardio', label: 'Heart (resting rate)', hue: 350 },
  { key: 'activity', label: 'Activity', hue: 35 },
  { key: 'stress', label: 'Stress load (derived)', hue: 15 },
  { key: 'metabolic', label: 'Metabolic (labs)', hue: 52 },
  { key: 'device', label: 'Device time (PC)', hue: 285 },
  { key: 'research', label: 'Research focus', hue: 190 },
] as const
export type DimKey = (typeof DIMENSIONS)[number]['key']

export const LEVEL_WORDS = ['far below usual', 'below usual', 'near usual', 'above usual', 'far above usual', 'unknown'] as const
export const FLOW_WORDS = ['quiet', 'steady', 'busy', 'heavy'] as const
export const TREND_WORDS = ['rising', 'falling', 'steady'] as const
export type LevelWord = (typeof LEVEL_WORDS)[number]

export interface SelfDim { key: DimKey; label: string; unit: string; value: number | null; trend: -1 | 0 | 1; raw: number | string | null; n: number }
export interface SelfFrame {
  t: number
  dims: SelfDim[]
  inBps: number
  outBps: number
  connections: number
  events: { dir: 'in' | 'out'; label: string; bytes: number }[]
  words: { levels: Record<DimKey, LevelWord>; network: { inbound: string; outbound: string } | null }
  synthetic: boolean
  story: string[]
  labs: { in_range: number; high: number; low: number }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const KEYS = new Set<string>(DIMENSIONS.map((d) => d.key))
const levelOf = (v: number | null, n: number): LevelWord => (v === null || n === 0 ? 'unknown' : v < 0.18 ? 'far below usual' : v < 0.38 ? 'below usual' : v < 0.62 ? 'near usual' : v < 0.82 ? 'above usual' : 'far above usual')
const flowWord = (bps: number) => (bps < 20_000 ? 'quiet' : bps < 400_000 ? 'steady' : bps < 3_000_000 ? 'busy' : 'heavy')

/** Validate one message from the hub. Anything unexpected is dropped; the words are recomputed here from the numbers, never trusted from the message. */
export function parseSelfFrame(raw: unknown): SelfFrame | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.v !== 1 || m.type !== 'selfdata' || !isNum(m.t)) return null
  const prof = m.profile as { dims?: unknown; synthetic?: unknown; story?: unknown; labs?: { flags?: Record<string, unknown> } } | undefined
  if (!prof || !Array.isArray(prof.dims) || prof.dims.length > 16) return null
  const dims: SelfDim[] = []
  for (const d of prof.dims as Record<string, unknown>[]) {
    if (!d || typeof d.key !== 'string' || !KEYS.has(d.key)) continue
    const meta = DIMENSIONS.find((x) => x.key === d.key)!
    const n = isNum(d.n) ? Math.max(0, Math.min(1e6, d.n)) : 0
    const value = isNum(d.value) ? Math.max(0, Math.min(1, d.value)) : null
    const trend = d.trend === 1 || d.trend === -1 ? d.trend : 0
    const raw = isNum(d.raw) ? d.raw : typeof d.raw === 'string' ? d.raw.slice(0, 60) : null
    dims.push({ key: meta.key, label: meta.label, unit: typeof d.unit === 'string' ? d.unit.slice(0, 12) : '', value: n ? value : null, trend, raw, n })
  }
  const fl = (m.flows ?? {}) as { pc?: { in_bps?: unknown; out_bps?: unknown; connections?: unknown }; events?: unknown }
  const inBps = isNum(fl.pc?.in_bps) ? Math.max(0, fl.pc!.in_bps as number) : 0
  const outBps = isNum(fl.pc?.out_bps) ? Math.max(0, fl.pc!.out_bps as number) : 0
  const events = (Array.isArray(fl.events) ? fl.events : []).slice(-10).flatMap((e: Record<string, unknown>) =>
    e && (e.dir === 'in' || e.dir === 'out') && typeof e.label === 'string' ? [{ dir: e.dir as 'in' | 'out', label: e.label.slice(0, 48), bytes: isNum(e.bytes) ? e.bytes : 0 }] : [])
  const levels = Object.fromEntries(DIMENSIONS.map((d) => { const f = dims.find((x) => x.key === d.key); return [d.key, f ? levelOf(f.value, f.n) : 'unknown'] })) as Record<DimKey, LevelWord>
  const flags = prof.labs?.flags ?? {}
  const c = (k: string) => (isNum(flags[k]) ? (flags[k] as number) : 0)
  return {
    t: m.t, dims, inBps, outBps, connections: isNum(fl.pc?.connections) ? (fl.pc!.connections as number) : -1, events,
    words: { levels, network: fl.pc ? { inbound: flowWord(inBps), outbound: flowWord(outBps) } : null },
    synthetic: prof.synthetic === true,
    story: (Array.isArray(prof.story) ? prof.story : []).slice(0, 4).filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 160)),
    labs: { in_range: c('in_range'), high: c('high'), low: c('low') },
  }
}

export const isFreshSelf = (f: SelfFrame | null, now = Date.now()) => !!f && now - f.t < 5000

/** The text sent to the image model: fixed words only, built from the validated frame. */
export function buildPrompt(f: SelfFrame, style: 'art' | 'portrait'): string {
  const parts = DIMENSIONS.map((d) => f.words.levels[d.key]).map((w, i) => (w === 'unknown' ? '' : `${DIMENSIONS[i].key} ${w}`)).filter(Boolean)
  const flow = f.words.network ? `; streams of light flowing in from the left (${f.words.network.inbound}) and out to the right (${f.words.network.outbound})` : ''
  const lead = style === 'art' ? 'an abstract luminous artwork' : 'an abstract data portrait of a human figure made of petals of light'
  return `${lead}, one glowing petal per body system, ${parts.join(', ')}${flow}, dark background, no text, no letters`
}

/** Petal geometry shared by the canvas renderer and tests: angle, length 0..1 and wobble per dimension. */
export function petals(f: SelfFrame) {
  return f.dims.map((d, i) => ({ key: d.key, hue: DIMENSIONS.find((x) => x.key === d.key)!.hue, angle: (i / Math.max(1, f.dims.length)) * Math.PI * 2 - Math.PI / 2, length: d.value === null ? 0.12 : 0.18 + 0.82 * d.value, known: d.value !== null, trend: d.trend }))
}

/** Draw the art for a frame onto a 2D context (any size). t is seconds, used only for gentle motion. */
export function drawArt(ctx: CanvasRenderingContext2D, w: number, h: number, f: SelfFrame | null, t: number) {
  ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, w, h)
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38
  if (!f) { ctx.fillStyle = '#6b7a72'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Waiting for the self-data hub', cx, cy); return }
  const speed = (bps: number) => Math.min(1, Math.log10(1 + bps) / 7)
  const stream = (dir: 1 | -1, bps: number, hue: number) => {
    const n = 8 + Math.round(speed(bps) * 60)
    for (let i = 0; i < n; i++) {
      const ph = (i / n + t * (0.05 + speed(bps) * 0.5)) % 1
      const y = cy + Math.sin(i * 12.9898) * R * 0.95
      const x = dir === 1 ? w * ph : w * (1 - ph)
      ctx.fillStyle = `hsla(${hue},85%,62%,${0.2 + 0.5 * (1 - Math.abs(ph - 0.5) * 2)})`
      ctx.beginPath(); ctx.arc(x, y, 1.5 + speed(bps) * 2, 0, 7); ctx.fill()
    }
  }
  stream(1, f.inBps, 205); stream(-1, f.outBps, 38)
  for (const p of petals(f)) {
    const L = R * p.length * (1 + 0.02 * Math.sin(t * 1.5 + p.angle))
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(p.angle)
    const g = ctx.createLinearGradient(0, 0, L, 0)
    g.addColorStop(0, `hsla(${p.hue},80%,50%,${p.known ? 0.55 : 0.12})`); g.addColorStop(1, `hsla(${p.hue},85%,62%,${p.known ? 0.15 : 0.04})`)
    ctx.fillStyle = g; ctx.strokeStyle = `hsla(${p.hue},85%,65%,${p.known ? 0.8 : 0.25})`
    ctx.beginPath(); ctx.moveTo(R * 0.12, 0); ctx.bezierCurveTo(R * 0.25, -L * 0.32, L * 0.8, -L * 0.28, L, 0); ctx.bezierCurveTo(L * 0.8, L * 0.28, R * 0.25, L * 0.32, R * 0.12, 0)
    ctx.fill(); ctx.stroke()
    if (p.trend) { ctx.fillStyle = '#fff'; ctx.beginPath(); const s = p.trend > 0 ? -1 : 1; ctx.moveTo(L + 6, 0); ctx.lineTo(L - 4, 5 * s); ctx.lineTo(L - 4, -5 * s); ctx.fill() }
    ctx.restore()
  }
  ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.07, 0, 7); ctx.fill()
  if (f.synthetic) { ctx.fillStyle = '#ebbe78'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('SYNTHETIC DEMO DATA', 12, h - 12) }
}

// ---- owner-only sync -------------------------------------------------------------------------------------------------------------------------------
/** The only thing that can be saved to the owner's account: coarse per-dimension summaries and lab flag COUNTS. Built from the validated frame. */
export interface SelfSummary { day: string; dims: { key: DimKey; level: LevelWord; value: number | null; trend: -1 | 0 | 1; n: number }[]; lab_flags: { in_range: number; high: number; low: number }; synthetic: boolean }

export function summaryFrom(f: SelfFrame, day: string): SelfSummary {
  return {
    day,
    dims: f.dims.map((d) => ({ key: d.key, level: f.words.levels[d.key], value: d.value === null ? null : Math.round(d.value * 1000) / 1000, trend: d.trend, n: Math.round(d.n) })),
    lab_flags: { ...f.labs },
    synthetic: f.synthetic,
  }
}
