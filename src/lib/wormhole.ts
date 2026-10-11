// The EEG-hormone "wormhole": it finds moments YOU logged that resemble how you are right now. It is a similarity search over your own history, not a
// decoder: it cannot read a memory or a scene out of a brain, it only says "this state looks like that moment you recorded", and how sure it is.
// Everything here runs in the browser; the moments come from the local hub (ws://127.0.0.1:8766) and never leave this computer. Only approved words
// (never titles, notes or numbers) are used to describe a scene to an image model.
import { canonical, noDigits, sha256 } from './twin-net.ts'

export type Level3 = 'low' | 'typical' | 'high'
export const RATINGS = ['arousal', 'valence', 'stress', 'energy'] as const
export type Rating = (typeof RATINGS)[number]
export const HORMONES = ['cortisol', 'melatonin'] as const
export type Hormone = (typeof HORMONES)[number]

export interface Moment {
  id: string
  date: string
  time: string // HH:MM or ''
  title: string
  tags: string[]
  ratings: Partial<Record<Rating, number>> // 0..1
  hormones: Partial<Record<Hormone, Level3>>
  day: Record<string, Level3> // how that day's body metrics sat against the person's own usual
}

/** What is known about the present: every part is optional, and a missing part is simply not used in the match. */
export interface StateVector {
  ratings: Partial<Record<Rating, number>>
  minutes: number | null // minutes since midnight
  hormones: Partial<Record<Hormone, Level3>>
  day: Record<string, Level3>
  guidance: string[] // words the user typed or ticked: "forest", "calm"...
}

export const COMPONENTS = ['affect', 'time', 'day', 'tags', 'hormones'] as const
export type Component = (typeof COMPONENTS)[number]
export type Weights = Record<Component, number>
export const DEFAULT_WEIGHTS: Weights = { affect: 0.35, time: 0.1, day: 0.15, tags: 0.25, hormones: 0.15 }

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isLevel = (v: unknown): v is Level3 => v === 'low' || v === 'typical' || v === 'high'
const LEVEL_INDEX: Record<Level3, number> = { low: 0, typical: 1, high: 2 }
const WORD_RX = /^[a-z][a-z\- ]{0,23}$/

// ---- parsing the hub's `moments` message --------------------------------------------------------------------------------------------------
export function parseMoments(raw: unknown): { moments: Moment[]; approved: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.v !== 1 || m.type !== 'moments' || !Array.isArray(m.moments)) return null
  const moments: Moment[] = []
  for (const r of m.moments.slice(0, 400) as Record<string, unknown>[]) {
    if (!r || typeof r.id !== 'string' || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue
    const ratings: Moment['ratings'] = {}
    for (const k of RATINGS) { const v = (r.ratings as Record<string, unknown> | undefined)?.[k]; if (isNum(v)) ratings[k] = clamp(v) }
    const hormones: Moment['hormones'] = {}
    for (const k of HORMONES) { const v = (r.hormones as Record<string, unknown> | undefined)?.[k]; if (isLevel(v)) hormones[k] = v }
    const day: Moment['day'] = {}
    for (const [k, v] of Object.entries((r.day ?? {}) as Record<string, unknown>).slice(0, 24)) if (isLevel(v) && /^[a-z_]{1,32}$/.test(k)) day[k] = v
    moments.push({
      id: r.id.slice(0, 16), date: r.date, time: typeof r.time === 'string' && /^\d{2}:\d{2}$/.test(r.time) ? r.time : '',
      title: typeof r.title === 'string' ? r.title.slice(0, 120) : '',
      tags: (Array.isArray(r.tags) ? r.tags : []).filter((t): t is string => typeof t === 'string' && WORD_RX.test(t)).slice(0, 12),
      ratings, hormones, day,
    })
  }
  const approved = (Array.isArray(m.approved) ? m.approved : []).filter((t): t is string => typeof t === 'string' && WORD_RX.test(t)).slice(0, 500)
  return { moments, approved }
}

// ---- turning live signals into a state ----------------------------------------------------------------------------------------------------
/** A deliberately crude reading of relative EEG band shares into arousal and relaxation. It is a rough indicator, not a measurement of any emotion. */
export function affectFromBands(b: { delta: number; theta: number; alpha: number; beta: number; gamma: number }): Partial<Record<Rating, number>> {
  const fast = Math.max(0, b.beta) + Math.max(0, b.gamma), slow = Math.max(0, b.alpha) + Math.max(0, b.theta)
  const total = fast + slow
  if (total <= 0) return {}
  return { arousal: clamp(fast / total) }
}

export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()
const momentMinutes = (t: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null)

// ---- similarity ---------------------------------------------------------------------------------------------------------------------------
export type ComponentScores = Partial<Record<Component, number>>

export function componentScores(s: StateVector, m: Moment): ComponentScores {
  const out: ComponentScores = {}
  const shared = RATINGS.filter((k) => isNum(s.ratings[k]) && isNum(m.ratings[k]))
  if (shared.length) out.affect = 1 - shared.reduce((a, k) => a + Math.abs(s.ratings[k]! - m.ratings[k]!), 0) / shared.length
  const mm = momentMinutes(m.time)
  if (s.minutes !== null && mm !== null) { const d = Math.abs(s.minutes - mm); out.time = 1 - Math.min(d, 1440 - d) / 720 }
  const days = Object.keys(s.day).filter((k) => k in m.day)
  if (days.length) out.day = days.reduce((a, k) => a + 1 - Math.abs(LEVEL_INDEX[s.day[k]] - LEVEL_INDEX[m.day[k]]) / 2, 0) / days.length
  if (s.guidance.length) out.tags = s.guidance.filter((w) => m.tags.includes(w)).length / s.guidance.length
  const hs = HORMONES.filter((k) => s.hormones[k] && m.hormones[k])
  if (hs.length) out.hormones = hs.reduce((a, k) => a + 1 - Math.abs(LEVEL_INDEX[s.hormones[k]!] - LEVEL_INDEX[m.hormones[k]!]) / 2, 0) / hs.length
  return out
}

export interface Match { moment: Moment; score: number; coverage: number; components: ComponentScores; boost: number }

export function match(s: StateVector, moments: Moment[], weights: Weights = DEFAULT_WEIGHTS, boosts: Record<string, number> = {}, limit = 5): Match[] {
  const totalW = COMPONENTS.reduce((a, c) => a + weights[c], 0)
  const out: Match[] = []
  for (const m of moments) {
    const comps = componentScores(s, m)
    let w = 0, acc = 0
    for (const c of COMPONENTS) { const v = comps[c]; if (v !== undefined) { w += weights[c]; acc += weights[c] * v } }
    if (!w) continue
    const boost = boosts[m.id] ?? 0
    out.push({ moment: m, score: clamp(acc / w + boost), coverage: w / totalW, components: comps, boost })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ---- how sure is it ---------------------------------------------------------------------------------------------------------------------
export type ReconstructionState = 'none' | 'weak' | 'plausible' | 'strong'
export interface Confidence { value: number; state: ReconstructionState; why: string }

/** value = 0.5 x best score + 0.25 x coverage (how much of the state could be compared) + 0.25 x margin over the runner-up, scaled down when few moments exist.
 *  Under 30% of the weights comparable caps it at "weak": a match on one clue is not a match. */
export function confidence(matches: Match[], candidates: number): Confidence {
  if (!matches.length || candidates === 0) return { value: 0, state: 'none', why: 'no logged moment could be compared with this state' }
  const [a, b] = matches
  const margin = b ? clamp((a.score - b.score) / 0.2) : 0.5
  const value = clamp((0.5 * a.score + 0.25 * a.coverage + 0.25 * margin) * Math.min(1, candidates / 10))
  let state: ReconstructionState = value < 0.3 ? 'none' : value < 0.5 ? 'weak' : value < 0.7 ? 'plausible' : 'strong'
  let why = `best match ${Math.round(a.score * 100)}%, ${Math.round(a.coverage * 100)}% of the state comparable, ${b ? `${Math.round((a.score - b.score) * 100)} points ahead of the next` : 'no runner-up'}, ${candidates} moments logged`
  if (a.coverage < 0.3 && state !== 'none') { state = 'weak'; why += '; too little of the state was comparable to say more' }
  return { value, state, why }
}

// ---- learning from feedback --------------------------------------------------------------------------------------------------------------
export interface Refinement { weights: Weights; boosts: Record<string, number> }

/** A thumbs up makes the components that agreed with that moment count a little more, and the moment a little more likely; a thumbs down does the reverse. */
export function refine(prev: Refinement, m: Match, good: boolean): Refinement {
  const sign = good ? 1 : -1
  const w = { ...prev.weights }
  for (const c of COMPONENTS) { const v = m.components[c]; if (v !== undefined) w[c] = clamp(w[c] * (1 + sign * (v - 0.5) * 0.4), 0.02, 1) }
  const total = COMPONENTS.reduce((a, c) => a + w[c], 0)
  for (const c of COMPONENTS) w[c] /= total
  return { weights: w, boosts: { ...prev.boosts, [m.moment.id]: clamp((prev.boosts[m.moment.id] ?? 0) + sign * 0.05, -0.2, 0.2) } }
}

// ---- the scene handed on to agents and image models -----------------------------------------------------------------------------------
export interface SceneState {
  words: string[] // approved words only
  mood: string
  confidence: Confidence
  momentId: string | null // an id, never a title
}

export function moodWord(r: Partial<Record<Rating, number>>): string {
  const a = r.arousal, v = r.valence
  if (a === undefined && v === undefined) return 'calm'
  const hiA = (a ?? 0.5) >= 0.55, hiV = (v ?? 0.5) >= 0.5
  return hiA ? (hiV ? 'energetic' : 'tense') : hiV ? 'calm' : 'tired'
}

export function buildScene(s: StateVector, matches: Match[], conf: Confidence, approved: string[]): SceneState {
  const ok = new Set(approved)
  const best = conf.state === 'none' || conf.state === 'weak' ? null : matches[0]?.moment ?? null
  const merged = [...(best?.tags ?? []), ...s.guidance]
  const mood = moodWord({ ...best?.ratings, ...s.ratings })
  const words = [...new Set([...merged, mood])].filter((w) => ok.has(w)).slice(0, 8)
  return { words, mood: ok.has(mood) ? mood : '', confidence: conf, momentId: best?.id ?? null }
}

/** The words-only prompt for an image model. */
export function scenePrompt(scene: SceneState): string | null {
  if (!scene.words.length) return null
  const p = `A soft painterly scene suggesting ${scene.words.join(', ')}. Gentle light, no people's faces, no text.`
  return noDigits(p) ? p : null
}

// ---- provenance --------------------------------------------------------------------------------------------------------------------------
export type ProvenanceKind = 'query' | 'feedback' | 'scene' | 'render'
export interface ProvenanceEntry { seq: number; ts: number; kind: ProvenanceKind; detail: string; prev: string; hash: string }

/** A hash-chained record of what the wormhole did and why (ids, counts and words; never titles or notes). Editing any entry breaks every hash after it. */
export class ProvenanceLog {
  entries: ProvenanceEntry[] = []
  async append(kind: ProvenanceKind, detail: string, ts = Date.now()): Promise<ProvenanceEntry> {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : '0'.repeat(64)
    const body = { seq: this.entries.length, ts, kind, detail: detail.slice(0, 300), prev }
    const e = { ...body, hash: await sha256(canonical(body)) }
    this.entries.push(e)
    return e
  }
  async verify(): Promise<number | null> {
    let prev = '0'.repeat(64)
    for (let i = 0; i < this.entries.length; i++) {
      const { hash, ...body } = this.entries[i]
      if (body.prev !== prev || body.seq !== i || (await sha256(canonical(body))) !== hash) return i
      prev = hash
    }
    return null
  }
}
