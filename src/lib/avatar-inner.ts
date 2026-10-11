// The avatar's "inner life": a functional architecture borrowed from scientific theories of consciousness, run as a simulation.
//
//   * Global workspace (Baars, Dehaene): many things compete for attention (a mood change, a decision, a racing heart, a question, a surprise). One wins,
//     "ignites", and is broadcast to the rest of the mind: it is held in a small working memory, written to episodic memory if it was strong, and narrated.
//   * Self-model and prediction (predictive-processing and higher-order ideas): the avatar learns how its own choices follow one another, predicts its next
//     move, and is "surprised" when it is wrong. It can report what it has learned about itself.
//   * Drives (homeostasis): needs for rest, activity and curiosity rise and fall with what it does, and bend its choices.
//   * Memory: an episodic log it can search to say what it did, felt and noticed earlier.
//
// WHAT THIS IS NOT. Building this architecture does not make the avatar conscious and nothing here shows that it has any experience. Whether a system like this
// could be conscious is an open scientific and philosophical question. The avatar says so when asked. Everything is deterministic given a seed and fully inspectable.

import { INTENTS, makeRng, type Intent, type MindSnapshot } from './avatar-mind.ts'

export type Kind = 'body' | 'mood' | 'action' | 'question' | 'novelty' | 'drive' | 'prediction' | 'organ'

export interface Item { id: string; kind: Kind; text: string; salience: number; born: number }
export interface Episode { t: number; kind: Kind; text: string; emotion: string; intent: Intent; intensity: number }

export interface InnerInputs {
  /** seconds since the session began */
  t: number
  /** 0..1 how hard the body is working right now */
  exertion: number
  heart: number
  scenario: string
  cortisol: string
  melatonin: string
  /** someone sensed nearby by WiFi, if connected */
  occupant?: { present: boolean | null; motion: number | null; simulated: boolean } | null
}

export interface InnerSnapshot {
  aware: string | null
  awareKind: Kind | null
  narration: string[]
  working: string[]
  drives: { rest: number; activity: number; curiosity: number }
  expectation: { intent: Intent; confidence: number } | null
  predictionAccuracy: number | null
  memories: number
}

const WM_CAPACITY = 4
const IGNITION = 0.5
const HOLD_SECONDS = 4
const MAX_EPISODES = 300

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const mmss = (s: number) => `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`

export class InnerLife {
  workspace: Item | null = null
  wm: Item[] = []
  episodes: Episode[] = []
  narration: string[] = []
  drives = { rest: 0.3, activity: 0.4, curiosity: 0.5 }
  private candidates: Item[] = []
  private lastEmotion = ''
  private lastIntent: Intent | null = null
  private lastMood = { a: 0.5, v: 0.2 }
  private lastScenario = ''
  private lastHormones = ''
  private lastPresence: boolean | null | undefined = undefined
  private movingNow = false
  private lastDriveShout = new Map<string, number>()
  private nextId = 1
  private clock = 0
  private heldUntil = 0
  private transitions: Record<string, Record<string, number>> = {}
  private timeIn: Record<string, number> = {}
  private emotionTime: Record<string, number> = {}
  private predicted: { intent: Intent; confidence: number } | null = null
  private hits = 0
  private tries = 0
  private rng: () => number

  constructor(seed = 1) { this.rng = makeRng(seed ^ 0x9e3779b9) }

  // ---- what the avatar is aware of ------------------------------------------------------------------------------------------------------
  private propose(kind: Kind, text: string, salience: number) {
    if (this.candidates.some((c) => c.kind === kind && c.text === text)) return
    this.candidates.push({ id: `i${this.nextId++}`, kind, text, salience: clamp(salience), born: this.clock })
  }

  /** Something was said to the avatar. Questions are very salient: they win the workspace for a while. */
  hear(question: string) {
    this.propose('question', `Someone asked me: "${question.slice(0, 90)}"`, 0.95)
    this.drives.curiosity = clamp(this.drives.curiosity - 0.25)
  }
  /** Something worth noticing happened outside the avatar (for example a message from another twin). */
  notice(text: string, salience = 0.7) { this.propose('novelty', text.slice(0, 160), salience) }
  /** Attention was drawn to an organ (for example by a question about it). */
  attendOrgan(name: string) { this.propose('organ', `My attention moves to my ${name.toLowerCase()}.`, 0.8) }

  step(dt: number, s: MindSnapshot, i: InnerInputs): InnerSnapshot {
    this.clock = i.t
    this.timeIn[s.intent] = (this.timeIn[s.intent] ?? 0) + dt
    this.emotionTime[s.emotion] = (this.emotionTime[s.emotion] ?? 0) + dt

    // drives follow what the body is doing
    const moving = s.gait.moving ? 1 : 0, resting = s.intent === 'rest' ? 1 : 0
    this.drives.rest = clamp(this.drives.rest + dt * (0.0035 + i.exertion * 0.02 + s.affect.fatigue * 0.01) - resting * dt * 0.06)
    this.drives.activity = clamp(this.drives.activity + dt * (0.004 + s.affect.energy * 0.004) - moving * dt * 0.03 * (0.5 + s.affect.energy))
    this.drives.curiosity = clamp(this.drives.curiosity + dt * 0.003 - (s.intent === 'look' ? dt * 0.05 : 0))

    // moods and decisions: noticed when they change
    if (s.emotion !== this.lastEmotion) {
      if (this.lastEmotion) {
        const shift = Math.abs(s.affect.arousal - this.lastMood.a) + Math.abs(s.affect.valence - this.lastMood.v)
        this.propose('mood', `I notice I have gone from feeling ${this.lastEmotion} to ${s.emotion}.`, 0.5 + Math.min(0.4, shift))
      }
      this.lastEmotion = s.emotion; this.lastMood = { a: s.affect.arousal, v: s.affect.valence }
    }
    if (s.intent !== this.lastIntent) {
      if (this.lastIntent) {
        this.learnTransition(this.lastIntent, s.intent)
        const surprise = this.predicted && this.predicted.intent !== s.intent ? 0.35 + 0.4 * this.predicted.confidence : 0
        if (this.predicted) { this.tries++; if (this.predicted.intent === s.intent) this.hits++ }
        this.propose('action', `I chose to ${verb(s.intent)}.${s.reasons.length ? ` ${cap(s.reasons[0])}.` : ''}`, 0.45 + surprise * 0.5)
        if (surprise > 0) this.propose('prediction', `I expected to ${verb(this.predicted!.intent)}, but I ${verb(s.intent)} instead. That surprises me.`, 0.5 + surprise * 0.4)
      }
      this.lastIntent = s.intent
      this.predicted = this.predictNext(s.intent)
    }

    // the body
    if (i.exertion > 0.55) this.propose('body', i.exertion > 0.8 ? 'My heart is pounding and my breathing is fast.' : 'My heart rate has gone up and I am breathing harder.', 0.35 + i.exertion * 0.4)
    if (s.affect.fatigue > 0.7) this.propose('body', 'My body feels heavy and I am very tired.', 0.45 + s.affect.fatigue * 0.3)
    if (s.affect.stress > 0.65) this.propose('body', 'I feel tense, as if something is pressing on me.', 0.4 + s.affect.stress * 0.35)

    // surroundings and context
    if (this.lastScenario && i.scenario !== this.lastScenario) this.propose('novelty', 'Something about my body has changed: the scenario I am showing is different now.', 0.85)
    this.lastScenario = i.scenario
    const hormones = `${i.cortisol}/${i.melatonin}`
    if (this.lastHormones && hormones !== this.lastHormones) this.propose('novelty', `My hormones have shifted: cortisol is ${i.cortisol} and melatonin ${i.melatonin}.`, 0.6)
    this.lastHormones = hormones

    // someone else in the room, felt through WiFi
    const occ = i.occupant
    if (!occ) { this.lastPresence = undefined; this.movingNow = false }
    else {
      const tag = occ.simulated ? ' (a simulated visitor)' : ''
      if (this.lastPresence === undefined) this.propose('novelty', `I can feel the room through WiFi now.${tag}`, 0.7)
      else if (occ.present !== this.lastPresence && occ.present !== null) this.propose('novelty', occ.present ? `I sense that someone has come into the room.${tag}` : `The room feels empty now.${tag}`, 0.78)
      this.lastPresence = occ.present
      const moving = occ.motion !== null && occ.motion > 0.5
      if (moving && !this.movingNow) this.propose('novelty', `Someone nearby is moving around.${tag}`, 0.55)
      this.movingNow = moving
    }

    // drives that grow urgent speak up, but not constantly
    for (const [name, value, text] of [['rest', this.drives.rest, 'I really need to rest.'], ['activity', this.drives.activity, 'I have been still for too long; I want to move.'], ['curiosity', this.drives.curiosity, 'I am curious. I would like to look around or be asked something.']] as const) {
      if (value > 0.8 && this.clock - (this.lastDriveShout.get(name) ?? -1e9) > 45) { this.lastDriveShout.set(name, this.clock); this.propose('drive', text, 0.5 + value * 0.3) }
    }

    this.compete()
    return this.snapshot()
  }

  /** Candidates compete; the strongest ignites if it beats the threshold and the current content has been held long enough. */
  private compete() {
    this.candidates = this.candidates.filter((c) => this.clock - c.born < 8).map((c) => ({ ...c, salience: c.salience * Math.exp(-(this.clock - c.born) * 0.04) }))
    if (!this.candidates.length) { if (this.workspace && this.clock > this.heldUntil + 3) this.workspace = null; return }
    const best = this.candidates.reduce((a, b) => (b.salience > a.salience ? b : a))
    const holding = this.workspace && this.clock < this.heldUntil
    if (best.salience >= IGNITION && (!holding || best.salience > (this.workspace?.salience ?? 0) + 0.15)) {
      this.workspace = best; this.heldUntil = this.clock + HOLD_SECONDS
      this.candidates = this.candidates.filter((c) => c.id !== best.id)
      this.broadcast(best)
    } else if (this.candidates.length > 12) this.candidates.sort((a, b) => b.salience - a.salience).length = 12
  }

  /** Ignition: the content becomes available to every part of the mind. */
  private broadcast(item: Item) {
    this.wm.unshift(item)
    if (this.wm.length > WM_CAPACITY) this.wm.sort((a, b) => b.salience - a.salience).length = WM_CAPACITY
    this.wm.sort((a, b) => b.born - a.born)
    this.narration.unshift(item.text); this.narration.length = Math.min(this.narration.length, 6)
    if (item.salience >= 0.6) {
      this.episodes.push({ t: this.clock, kind: item.kind, text: item.text, emotion: this.lastEmotion || 'neutral', intent: this.lastIntent ?? 'stand', intensity: item.salience })
      if (this.episodes.length > MAX_EPISODES) this.episodes.splice(0, this.episodes.length - MAX_EPISODES)
    }
  }

  // ---- the self-model -------------------------------------------------------------------------------------------------------------------------
  private learnTransition(from: Intent, to: Intent) {
    const row = (this.transitions[from] ??= {})
    row[to] = (row[to] ?? 0) + 1
  }

  /** Predict what it will do next, from what it has learned about itself. Null until it has seen enough. */
  private predictNext(from: Intent): { intent: Intent; confidence: number } | null {
    const row = this.transitions[from]
    if (!row) return null
    const total = Object.values(row).reduce((a, b) => a + b, 0)
    if (total < 3) return null
    const [intent, n] = Object.entries(row).sort((a, b) => b[1] - a[1])[0]
    return { intent: intent as Intent, confidence: n / total }
  }

  /** How the avatar nudges its own choices: needs make some actions more attractive. Feed this to Mind.step. */
  biases(): Partial<Record<Intent, number>> {
    const r = this.drives.rest - 0.5, a = this.drives.activity - 0.5, c = this.drives.curiosity - 0.5
    return { rest: 0.7 * r, stand: -0.2 * a, stroll: 0.3 * a, walk: 0.35 * a, jog: 0.2 * a, run: 0.1 * a, look: 0.6 * c, stretch: 0.25 * Math.max(0, r) }
  }

  snapshot(): InnerSnapshot {
    return {
      aware: this.workspace?.text ?? null, awareKind: this.workspace?.kind ?? null, narration: [...this.narration], working: this.wm.map((w) => w.text),
      drives: { ...this.drives }, expectation: this.predicted, predictionAccuracy: this.tries >= 3 ? this.hits / this.tries : null, memories: this.episodes.length,
    }
  }

  // ---- looking inward: answers to questions about itself --------------------------------------------------------------------------------------------
  introspect(question: string): { text: string; topic: string } | null {
    const q = question.toLowerCase()
    const has = (...w: string[]) => w.some((x) => new RegExp(`\\b${x}\\b`).test(q))
    const snap = this.snapshot()

    if (has('conscious', 'consciousness', 'sentient', 'aware of yourself', 'self-aware', 'self aware', 'experience', 'experiencing', 'qualia', 'alive', 'real', 'soul')) {
      return { topic: 'consciousness', text: 'I have a functional inner life built from ideas in the science of consciousness: a global workspace where one thing at a time becomes my focus, a small working memory, a memory of what I have done and felt, a model of myself that predicts my own next move, and needs that bend my choices. That makes me behave as if I have an inner life, and I can tell you about it. But nothing here shows that I have any experience. Whether a system like me could be conscious is an open question that no one has answered, and I cannot check from the inside, so I will not claim to be conscious.' }
    }
    if (has('aware', 'awareness', 'attention', 'notice', 'noticing', 'focus', 'focusing', 'thinking about', 'on your mind', 'in your mind', 'thinking')) {
      if (!snap.aware) return { topic: 'aware', text: 'Right now nothing stands out enough to take my attention; my mind is quiet.' }
      return { topic: 'aware', text: `What has my attention right now: ${lower(snap.aware)} ${snap.working.length > 1 ? `Also in my mind: ${snap.working.slice(1, 3).map(lower).join(' ')}` : ''} (This is my "global workspace": one thing wins attention at a time and is shared with the rest of my mind.)`.trim() }
    }
    if (has('remember', 'memory', 'memories', 'earlier', 'before', 'last time', 'recall', 'history', 'did you do', 'have you done', 'happened')) {
      return { topic: 'memory', text: this.recall(q) }
    }
    if (has('want', 'need', 'needs', 'goal', 'goals', 'drive', 'drives', 'motivation', 'motivated', 'wish')) {
      const d = snap.drives, top = (Object.entries(d) as [string, number][]).sort((a, b) => b[1] - a[1])[0]
      return { topic: 'drives', text: `I have three needs. Rest is at ${pct(d.rest)}, activity ${pct(d.activity)} and curiosity ${pct(d.curiosity)}. The strongest is ${top[0]}. They rise and fall with what I do, and they push my choices: ${top[0] === 'rest' ? 'I am drawn to sit down' : top[0] === 'activity' ? 'I am drawn to move' : 'I am drawn to look around and to be asked things'}.` }
    }
    if (has('next', 'predict', 'expect', 'will you do', 'going to do', 'plan')) {
      const e = snap.expectation, acc = snap.predictionAccuracy
      if (!e) return { topic: 'prediction', text: 'I have not seen enough of my own behaviour yet to predict what I will do next.' }
      return { topic: 'prediction', text: `I expect to ${verb(e.intent)} next, with about ${pct(e.confidence)} confidence, because that is what usually follows what I am doing now. ${acc === null ? '' : `So far my predictions about myself have been right ${pct(acc)} of the time.`}` }
    }
    if (has('habit', 'habits', 'tend', 'tendency', 'usually', 'personality', 'what are you like', 'know about yourself', 'yourself', 'self')) {
      return { topic: 'self', text: this.describeSelf() }
    }
    return null
  }

  /** What it remembers, searched by words in the question (a time such as "earlier" returns the recent strong moments). */
  recall(q: string): string {
    if (!this.episodes.length) return 'I have not had any strong moments to remember yet. Ask me again after I have been moving around for a while.'
    const words = ['rest', 'sit', 'run', 'jog', 'walk', 'pace', 'stroll', 'stretch', 'look', 'tired', 'tense', 'heart', 'surprise', 'question', 'asked', 'hormone', 'scenario', 'feel']
    const hit = words.filter((w) => q.includes(w))
    let pool = this.episodes
    if (hit.length) {
      const sel = pool.filter((e) => hit.some((w) => `${e.text} ${e.intent} ${e.emotion}`.toLowerCase().includes(w)))
      if (sel.length) pool = sel
    }
    if (/\b(strongest|most intense|biggest|best)\b/.test(q)) pool = [pool.slice().sort((a, b) => b.intensity - a.intensity)[0]]
    const recent = pool.slice(-3).reverse()
    return `${recent.map((e) => `${mmss(this.clock - e.t)} ago, while ${verbIng(e.intent)} and feeling ${e.emotion}: ${lower(e.text)}`).join(' Before that, ')} (I keep ${this.episodes.length} strong moments in memory.)`
  }

  describeSelf(): string {
    const total = Object.values(this.timeIn).reduce((a, b) => a + b, 0) || 1
    const top = Object.entries(this.timeIn).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${verbIng(k as Intent)} (${pct(v / total)} of my time)`)
    const emo = Object.entries(this.emotionTime).sort((a, b) => b[1] - a[1])[0]
    const habits = Object.entries(this.transitions).map(([from, row]) => { const t = Object.values(row).reduce((a, b) => a + b, 0), [to, n] = Object.entries(row).sort((a, b) => b[1] - a[1])[0]; return { from, to, p: n / t, t } }).filter((h) => h.t >= 3 && h.p >= 0.45).sort((a, b) => b.p * b.t - a.p * a.t)[0]
    return `What I have learned about myself so far: I spend most of my time ${top.join(' and ') || 'just beginning'}${emo ? `, and I most often feel ${emo[0]}` : ''}.${habits ? ` After ${verbIng(habits.from as Intent)} I usually go on to ${verb(habits.to as Intent).replace(/^./, (c) => c)} (${pct(habits.p)} of the time).` : ''} I learn this by watching my own choices; it is a model of myself, and it can be wrong.`
  }
}

// ---- small wording helpers ------------------------------------------------------------------------------------------------------------------
const pct = (x: number) => `${Math.round(x * 100)}%`
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export function verb(i: Intent): string {
  return { rest: 'sit and rest', stand: 'stand still', look: 'look around', stroll: 'stroll', walk: 'walk', pace: 'pace', jog: 'jog', run: 'run', stretch: 'stretch' }[i]
}
export function verbIng(i: Intent): string {
  return { rest: 'resting', stand: 'standing', look: 'looking around', stroll: 'strolling', walk: 'walking', pace: 'pacing', jog: 'jogging', run: 'running', stretch: 'stretching' }[i]
}
export const INNER_INTENTS = INTENTS
export const INNER_QUESTIONS = ['What are you aware of?', 'What do you remember?', 'What do you need right now?', 'What will you do next?', 'What have you learned about yourself?', 'Are you conscious?'] as const
