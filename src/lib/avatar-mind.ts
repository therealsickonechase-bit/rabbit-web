// The avatar's "mind": a small, transparent simulation that turns hormone levels, the time of day and (optionally) EEG and heart signals into a mood,
// then lets the avatar choose by itself how to move: sit, stand, stroll, walk, pace, jog, run, stretch or look around.
//
// HONEST LIMITS. This is a rule-based model for teaching and visualisation. It does not read feelings or thoughts and the avatar is not conscious.
//   * Cortisol and melatonin shift arousal and tiredness in the textbook direction (evidence: established for sleep and stress physiology).
//   * Mapping EEG indices to arousal or mood is a rough heuristic (evidence: exploratory); frontal alpha asymmetry as a mood signal is contested.
//   * Everything here is deterministic given a seed, so the choices can be tested and explained: each decision comes with the reasons that produced it.

import type { Level } from './body-api.ts'

export const INTENTS = ['rest', 'stand', 'look', 'stroll', 'walk', 'pace', 'jog', 'run', 'stretch'] as const
export type Intent = (typeof INTENTS)[number]

export interface MindInputs {
  /** clock hour 0..24 */
  hour: number
  cortisol: Level
  melatonin: Level
  /** present only while real EEG is connected; null means the avatar is running on its own simulated twin */
  eeg: { engagement: number | null; thetaAlpha: number | null; asymmetry: number | null } | null
  heartBpm: number | null
  /** a real person sensed in the room by WiFi (RuView), if connected; presence and motion only, never identity */
  occupant?: { present: boolean | null; motion: number | null } | null
}

export interface Affect { arousal: number; valence: number; stress: number; fatigue: number; energy: number }

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

/** The mood the inputs point to, before the avatar's own smoothing and drift. Each term is a plain, inspectable rule. */
export function targetAffect(i: MindInputs): { affect: Affect; reasons: string[] } {
  const reasons: string[] = []
  const night = i.hour >= 22 || i.hour < 6
  const morning = i.hour >= 6 && i.hour < 10
  let arousal = 0.5, fatigue = 0.2, stress = 0.25, valence = 0.15

  if (i.cortisol === 'high') { arousal += 0.2; stress += 0.4; reasons.push('my cortisol is high') }
  else if (i.cortisol === 'low') { arousal -= 0.1; stress -= 0.15; reasons.push('my cortisol is low') }
  if (i.melatonin === 'high') { arousal -= 0.25; fatigue += 0.5; reasons.push('my melatonin is high, which makes me sleepy') }
  else if (i.melatonin === 'low' && night) { fatigue -= 0.05 }
  if (night) { arousal -= 0.15; fatigue += 0.25; reasons.push('it is night') }
  else if (morning) { arousal += 0.05; reasons.push('it is morning') }

  if (i.eeg) {
    if (i.eeg.engagement !== null) { arousal += clamp((i.eeg.engagement - 0.5) * 0.5, -0.25, 0.25); reasons.push('my EEG shows ' + (i.eeg.engagement > 0.7 ? 'high engagement' : i.eeg.engagement < 0.35 ? 'low engagement' : 'moderate engagement')) }
    if (i.eeg.thetaAlpha !== null) fatigue += clamp((i.eeg.thetaAlpha - 0.8) * 0.3, -0.1, 0.3)
    if (i.eeg.asymmetry !== null) valence += clamp(i.eeg.asymmetry * 0.5, -0.3, 0.3)
  }
  if (i.heartBpm !== null) arousal += clamp((i.heartBpm - 70) / 120, -0.15, 0.3)

  if (i.occupant) {
    if (i.occupant.present === true) { valence += 0.05; reasons.push(i.occupant.motion !== null && i.occupant.motion > 0.5 ? 'someone is moving about nearby' : 'someone is in the room with me') }
    if (i.occupant.motion !== null) arousal += clamp((i.occupant.motion - 0.25) * 0.35, -0.08, 0.2)
  }
  stress += Math.max(0, arousal - 0.7) * 0.5
  valence -= stress * 0.45
  fatigue = clamp(fatigue); stress = clamp(stress); arousal = clamp(arousal - fatigue * 0.25); valence = clamp(valence, -1, 1)
  const energy = clamp(1 - fatigue * 0.85 + (arousal - 0.5) * 0.3)
  return { affect: { arousal, valence, stress, fatigue, energy }, reasons }
}

/** One word for the mood, from arousal and valence (a simple circumplex mapping). */
export function emotionWord(a: Affect): string {
  if (a.fatigue > 0.65) return a.valence >= 0 ? 'sleepy' : 'drained'
  if (a.arousal > 0.65) return a.valence > 0.25 ? 'excited' : a.valence < -0.15 ? (a.stress > 0.6 ? 'anxious' : 'tense') : 'alert'
  if (a.arousal < 0.35) return a.valence > 0.2 ? 'relaxed' : a.valence < -0.15 ? 'low' : 'calm'
  return a.valence > 0.25 ? 'content' : a.valence < -0.2 ? 'uneasy' : 'neutral'
}

/** How strongly each intent appeals, from the mood. Higher is more attractive; `current` gets a small bonus (habit) and long stays get dull. */
export function intentScores(a: Affect, current: Intent, secondsInCurrent: number): Record<Intent, number> {
  const bored = Math.min(0.3, Math.max(0, secondsInCurrent - 15) * 0.012)
  const s: Record<Intent, number> = {
    rest: a.fatigue * 1.3 + (1 - a.arousal) * 0.35,
    stand: 0.3 + (1 - Math.abs(a.arousal - 0.4)) * 0.15,
    look: 0.2 + a.arousal * 0.25 + Math.max(0, a.valence) * 0.2,
    stroll: 0.35 + a.energy * 0.25 + Math.max(0, a.valence) * 0.1 - a.stress * 0.1,
    walk: a.energy * 0.55 + a.arousal * 0.25,
    pace: a.stress * a.arousal * 1.3,
    jog: a.energy * a.arousal * 0.9 + Math.max(0, a.valence) * 0.15 - a.fatigue * 0.3,
    run: a.energy * Math.max(0, a.arousal - 0.5) * 2.6 + Math.max(0, a.valence) * 0.15 + a.stress * 0.15 - a.fatigue * 0.6,
    stretch: a.fatigue > 0.25 && a.fatigue < 0.6 ? 0.45 : 0.1,
  }
  s[current] += 0.15
  s[current] -= bored
  return s
}

/** mulberry32: small seeded random numbers, so a given seed always behaves the same way. */
export function makeRng(seed: number) {
  let t = seed >>> 0
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296 }
}

/** Pick by softmax with a low temperature, so the best-scoring intent usually wins but not always (the avatar is not a lookup table). */
export function pickIntent(scores: Record<Intent, number>, rng: () => number, temperature = 0.12): Intent {
  const max = Math.max(...INTENTS.map((k) => scores[k]))
  const w = INTENTS.map((k) => Math.exp((scores[k] - max) / temperature))
  const total = w.reduce((x, y) => x + y, 0)
  let r = rng() * total
  for (let i = 0; i < INTENTS.length; i++) { r -= w[i]; if (r <= 0) return INTENTS[i] }
  return 'stand'
}

export interface Gait {
  /** metres per second at the chosen speed */
  speed: number
  /** full gait cycles per second (two steps) */
  cycle: number
  /** 0..1 arm swing */
  swing: number
  /** forward lean in radians */
  lean: number
  /** slouch: 0 upright .. 1 slumped, with the head dropped */
  slump: number
  moving: boolean
}

const BASE_GAIT: Record<Intent, { speed: number; cycle: number; swing: number; lean: number }> = {
  rest: { speed: 0, cycle: 0, swing: 0, lean: 0 }, stand: { speed: 0, cycle: 0, swing: 0, lean: 0 }, look: { speed: 0, cycle: 0, swing: 0, lean: 0 }, stretch: { speed: 0, cycle: 0, swing: 0, lean: 0 },
  stroll: { speed: 0.85, cycle: 0.65, swing: 0.55, lean: 0.02 }, walk: { speed: 1.3, cycle: 0.9, swing: 0.8, lean: 0.04 }, pace: { speed: 1.55, cycle: 1.0, swing: 0.7, lean: 0.06 },
  jog: { speed: 2.6, cycle: 1.35, swing: 1.0, lean: 0.14 }, run: { speed: 4.2, cycle: 1.6, swing: 1.25, lean: 0.24 },
}

export function gaitFor(intent: Intent, a: Affect): Gait {
  const g = BASE_GAIT[intent]
  const k = 0.8 + 0.4 * a.energy                      // tired avatars move slower, energetic ones faster
  const slump = clamp(a.fatigue * 0.6 + Math.max(0, -a.valence) * 0.5)
  return { speed: g.speed * k, cycle: g.cycle * (0.9 + 0.2 * a.energy), swing: g.swing * (0.7 + 0.5 * a.arousal), lean: g.lean + slump * 0.08, slump, moving: g.speed > 0 }
}

/** First person, plain words: why this intent, from the reasons that fed the mood. */
export function thoughtFor(intent: Intent, a: Affect, reasons: string[]): string {
  const feel = emotionWord(a)
  const because = reasons.length ? ` Because ${reasons.slice(0, 2).join(' and ')}.` : ''
  const lines: Record<Intent, string> = {
    rest: `I feel ${feel}, so I want to sit and rest for a while.`,
    stand: `I feel ${feel}. I will just stand here and take it in.`,
    look: `I feel ${feel} and curious, so I will look around.`,
    stroll: `I feel ${feel}. A slow stroll sounds right.`,
    walk: `I feel ${feel} with some energy, so I will walk.`,
    pace: `I feel ${feel} and restless, so I will pace.`,
    jog: `I feel ${feel} and full of energy, so I will jog.`,
    run: `I feel ${feel} and wound up, so I am going to run.`,
    stretch: `I feel ${feel}. My body wants a stretch.`,
  }
  return lines[intent] + because
}

/** A synthetic EEG for the avatar's own twin: relative band shares that follow its mood in the textbook direction. Illustrative, not measured. */
export function ownEeg(a: Affect): Record<'delta' | 'theta' | 'alpha' | 'beta' | 'gamma', number> {
  const raw = {
    delta: 0.05 + a.fatigue * a.fatigue * 0.35,
    theta: 0.1 + a.fatigue * 0.25,
    alpha: 0.15 + (1 - a.arousal) * 0.45 * (1 - a.stress * 0.5),
    beta: 0.1 + a.arousal * 0.4 + a.stress * 0.15,
    gamma: 0.02 + Math.max(0, a.arousal - 0.5) * 0.15,
  }
  const sum = Object.values(raw).reduce((x, y) => x + y, 0)
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / sum])) as ReturnType<typeof ownEeg>
}

export interface MindSnapshot { affect: Affect; emotion: string; intent: Intent; thought: string; reasons: string[]; eeg: ReturnType<typeof ownEeg>; gait: Gait; simulated: boolean }

/** The running mind. Call step() every frame with the elapsed seconds and the current inputs. */
export class Mind {
  affect: Affect = { arousal: 0.5, valence: 0.15, stress: 0.25, fatigue: 0.2, energy: 0.8 }
  intent: Intent = 'stand'
  private since = 0
  private nextDecision = 3
  private clock = 0
  private drift = { arousal: 0, valence: 0, fatigue: 0 }
  private reasons: string[] = []
  private thought = ''
  private simulated = true
  private rng: () => number

  constructor(seed = 1) { this.rng = makeRng(seed); this.thought = 'I am just waking up to the room.' }

  /** `bias` nudges the appeal of each intent (the avatar's own needs feed it); optional. */
  step(dt: number, inputs: MindInputs, bias?: Partial<Record<Intent, number>>): MindSnapshot {
    this.clock += dt; this.since += dt
    const { affect: target, reasons } = targetAffect(inputs)
    this.reasons = reasons; this.simulated = inputs.eeg === null
    // the avatar's own slow ups and downs (an Ornstein-Uhlenbeck drift), larger when it has no live signals and must supply its own variation
    const amp = this.simulated ? 0.18 : 0.06
    for (const k of ['arousal', 'valence', 'fatigue'] as const) this.drift[k] += (-this.drift[k] * 0.05 + (this.rng() - 0.5) * 0.12) * Math.min(dt, 0.5) * 3
    const goal: Affect = {
      arousal: clamp(target.arousal + this.drift.arousal * amp * 5), valence: clamp(target.valence + this.drift.valence * amp * 5, -1, 1),
      fatigue: clamp(target.fatigue + this.drift.fatigue * amp * 3), stress: target.stress, energy: target.energy,
    }
    const k = 1 - Math.exp(-dt / 6)                   // smoothing over about six seconds: moods do not jump
    for (const key of ['arousal', 'valence', 'stress', 'fatigue', 'energy'] as const) this.affect[key] += (goal[key] - this.affect[key]) * k
    if (this.clock >= this.nextDecision) {
      const scores = intentScores(this.affect, this.intent, this.since)
      if (bias) for (const k of INTENTS) scores[k] += bias[k] ?? 0
      const next = pickIntent(scores, this.rng)
      if (next !== this.intent) { this.intent = next; this.since = 0 }
      this.thought = thoughtFor(this.intent, this.affect, this.reasons)
      this.nextDecision = this.clock + 5 + this.rng() * 9
    }
    return this.snapshot()
  }

  snapshot(): MindSnapshot {
    return { affect: { ...this.affect }, emotion: emotionWord(this.affect), intent: this.intent, thought: this.thought, reasons: this.reasons, eeg: ownEeg(this.affect), gait: gaitFor(this.intent, this.affect), simulated: this.simulated }
  }
}
