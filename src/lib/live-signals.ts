// Live signals from a local BrainFlow / OpenBCI bridge, and how they drive the body model. Pure functions, tested.
//
// The bridge (research-agents/local_bridge.py) runs on the wearer's own computer and streams small JSON frames over a local
// WebSocket. Nothing here is stored or uploaded: the browser reads the frames, shows them, and can save a session file on request.
// ECG-derived heart rate and EMG-derived muscle activity are MEASURED values and replace the model's illustrative numbers while the
// bridge is connected. EEG-derived indices are estimates for context, never a diagnosis.

import { BANDS, canonicalChannel, type Band } from './brain.ts'
import type { Physio } from './body-physiology.ts'

export interface LiveFrame {
  v: 1
  /** milliseconds since the epoch. The page replaces the bridge's value with the time the frame ARRIVED, so a wrong clock cannot make live data look stale */
  t: number
  /** the bridge's own timestamp, kept for the saved session */
  t_bridge?: number
  /** e.g. "brainflow:cyton", "brainflow:synthetic", "simulator" */
  source: string
  /** relative power share (0..1) per band for each EEG channel, keyed by 10-20 name */
  eeg?: Record<string, Partial<Record<Band, number>>>
  ecg?: { bpm: number; /** gaps between recent heartbeats, ms */ rr_ms?: number[]; quality?: number }
  /** RMS muscle activity in microvolts per channel label (for example "left_forearm") */
  emg?: Record<string, number>
  resp?: { rpm: number }
}

const MAX_CHANNELS = 64, MAX_RR = 120, MAX_AGE_MS = 5000
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)

/** Validate untrusted JSON from the socket. Returns null for anything that is not a well-formed frame. */
export function parseLiveFrame(raw: unknown): LiveFrame | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  const t = num(o.t, 1e12, 4e12)
  if (t === null || typeof o.source !== 'string' || o.source.length > 40 || !/^[\w:.\- ]+$/.test(o.source)) return null
  const out: LiveFrame = { v: 1, t, source: o.source }

  if (o.eeg !== undefined) {
    if (!o.eeg || typeof o.eeg !== 'object') return null
    const entries = Object.entries(o.eeg as Record<string, unknown>)
    if (entries.length > MAX_CHANNELS) return null
    const eeg: NonNullable<LiveFrame['eeg']> = {}
    for (const [name, bands] of entries) {
      const ch = canonicalChannel(name)
      if (!ch || !bands || typeof bands !== 'object') continue
      const row: Partial<Record<Band, number>> = {}
      for (const b of BANDS) { const v = num((bands as Record<string, unknown>)[b], 0, 1); if (v !== null) row[b] = v }
      if (Object.keys(row).length) eeg[ch] = row
    }
    out.eeg = eeg
  }
  if (o.ecg !== undefined) {
    const e = o.ecg as Record<string, unknown> | null
    const bpm = e ? num(e.bpm, 25, 240) : null
    if (bpm === null) return null
    const rr = Array.isArray(e!.rr_ms) ? (e!.rr_ms as unknown[]).slice(-MAX_RR).map((x) => num(x, 250, 2400)).filter((x): x is number => x !== null) : undefined
    out.ecg = { bpm, ...(rr ? { rr_ms: rr } : {}), ...(num(e!.quality, 0, 1) !== null ? { quality: e!.quality as number } : {}) }
  }
  if (o.emg !== undefined) {
    if (!o.emg || typeof o.emg !== 'object') return null
    const entries = Object.entries(o.emg as Record<string, unknown>)
    if (entries.length > MAX_CHANNELS) return null
    const emg: Record<string, number> = {}
    for (const [k, v] of entries) { const x = num(v, 0, 5000); if (x !== null && /^[\w\- ]{1,32}$/.test(k)) emg[k] = x }
    out.emg = emg
  }
  if (o.resp !== undefined) {
    const r = o.resp as Record<string, unknown> | null
    const rpm = r ? num(r.rpm, 0, 60) : null
    if (rpm === null) return null
    out.resp = { rpm }
  }
  return out
}

export const isFresh = (f: LiveFrame | null, now = Date.now()): f is LiveFrame => !!f && Math.abs(now - f.t) < MAX_AGE_MS

// ---- heart rhythm ------------------------------------------------------------------------------------------------
/** Beat-to-beat irregularity 0..1 from the gaps between beats: RMSSD relative to the mean gap, with a resting healthy range mapped to 0. */
export function rrIrregularity(rr: number[] | undefined): number {
  if (!rr || rr.length < 5) return 0
  const mean = rr.reduce((a, b) => a + b, 0) / rr.length
  let s = 0
  for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2
  const rmssd = Math.sqrt(s / (rr.length - 1)), rel = rmssd / mean
  // healthy resting variability is roughly 3-12% of the beat gap; erratic rhythms such as atrial fibrillation are far higher
  return Math.min(1, Math.max(0, (rel - 0.12) / 0.2))
}

// ---- EEG indices -------------------------------------------------------------------------------------------------
export interface EegIndices {
  /** theta power over alpha power, averaged over all channels (higher with drowsiness or slowing) */
  thetaAlpha: number | null
  /** beta / (alpha + theta), the engagement index (higher when attention is engaged) */
  engagement: number | null
  /** ln(right alpha) - ln(left alpha) at F4 and F3; positive means more alpha on the right (less right-frontal activity) */
  frontalAsymmetry: number | null
  dominant: Band | null
  channels: number
}
export function eegIndices(f: LiveFrame | null): EegIndices {
  const out: EegIndices = { thetaAlpha: null, engagement: null, frontalAsymmetry: null, dominant: null, channels: 0 }
  if (!f?.eeg) return out
  const mean: Record<Band, number> = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 }
  let n = 0
  for (const bands of Object.values(f.eeg)) {
    if (!BANDS.every((b) => typeof bands[b] === 'number')) continue
    for (const b of BANDS) mean[b] += bands[b]!
    n++
  }
  out.channels = n
  if (n === 0) return out
  for (const b of BANDS) mean[b] /= n
  if (mean.alpha > 0) out.thetaAlpha = mean.theta / mean.alpha
  if (mean.alpha + mean.theta > 0) out.engagement = mean.beta / (mean.alpha + mean.theta)
  out.dominant = BANDS.reduce((best, b) => (mean[b] > mean[best] ? b : best), 'delta' as Band)
  const l = f.eeg.F3?.alpha, r = f.eeg.F4?.alpha
  if (l && r && l > 0 && r > 0) out.frontalAsymmetry = Math.log(r) - Math.log(l)
  return out
}

// ---- driving the body model ---------------------------------------------------------------------------------------
export interface Baseline { emg: Record<string, number> }
const emptyBaseline = (): Baseline => ({ emg: {} })

/** Average resting EMG over some frames, per channel, to compare later activity against. */
export function calibrateEmg(frames: LiveFrame[]): Baseline {
  const b = emptyBaseline(), count: Record<string, number> = {}
  for (const f of frames) for (const [k, v] of Object.entries(f.emg ?? {})) { b.emg[k] = (b.emg[k] ?? 0) + v; count[k] = (count[k] ?? 0) + 1 }
  for (const k of Object.keys(b.emg)) b.emg[k] /= count[k]
  return b
}

/** How active the muscles are relative to rest, 1 = at rest. Uses the strongest channel so a single working muscle shows. */
export function emgRatio(f: LiveFrame, base: Baseline): number | null {
  let best: number | null = null
  for (const [k, v] of Object.entries(f.emg ?? {})) {
    const ref = base.emg[k]
    if (!ref || ref <= 0) continue
    const r = v / ref
    best = best === null ? r : Math.max(best, r)
  }
  return best
}

/** The model's physiology with measured values swapped in. Returns a new object; the model's own numbers are never modified. */
export function applyLive(p: Physio, f: LiveFrame | null, base: Baseline, now = Date.now()): Physio {
  if (!isFresh(f, now)) return p
  const out: Physio = JSON.parse(JSON.stringify(p))
  const measured = { heart: false, muscle: false, breathing: false, eeg: !!f.eeg && Object.keys(f.eeg).length > 0, source: f.source }
  if (f.ecg) {
    out.heart.bpm = f.ecg.bpm; out.heart.irregular = rrIrregularity(f.ecg.rr_ms)
    measured.heart = true
  }
  if (f.resp) { out.lungs.rpm = f.resp.rpm; out.lungs.apnea = f.resp.rpm < 2 ? 0.9 : 0; measured.breathing = true }
  const ratio = emgRatio(f, base)
  if (ratio !== null) {
    out.muscle.tone = Math.min(2.4, Math.max(0.5, ratio))
    out.muscle.tremor = ratio > 2 ? Math.min(0.6, (ratio - 2) * 0.15) : 0
    out.muscle.spasm = ratio > 6 ? Math.min(1, (ratio - 6) / 6) : 0
    measured.muscle = true
  }
  out.live = measured
  return out
}
