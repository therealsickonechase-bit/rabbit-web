// What the body does under each chosen scenario: heart rate and rhythm, breathing, gut movement, hormone output, muscle
// strength and tone, and how strongly each nerve pathway is carrying signals. Pure functions of (scenario, time), tested.
//
// These are ILLUSTRATIVE textbook patterns for teaching, not predictions for any person. Where a scenario cycles (an epileptic
// seizure), time t in seconds picks the phase. Values are 1 = normal unless a unit is shown.

import type { Evidence, ScenarioId } from './neuro.ts'

export interface Physio {
  phase: 'baseline' | 'seizure onset' | 'seizure' | 'after the seizure'
  heart: { bpm: number; irregular: number; contractility: number }
  lungs: { rpm: number; depth: number; apnea: number; consolidation: number; spo2: number }
  diaphragm: number
  esophagus: number
  stomach: number
  gut: number
  adrenals: number
  kidneys: number
  bladder: { urgency: number; control: number }
  muscle: { strengthL: number; strengthR: number; tone: number; tremor: number; spasm: number }
  /** signal strength on each pathway, 1 = normal, above 1 = surge, 0 = nothing gets through */
  cord: { motorFromLeftBrain: number; motorFromRightBrain: number; sensoryL: number; sensoryR: number; autonomic: number; vagal: number; phrenic: number }
  visual: { leftBrain: number; rightBrain: number }
  /** set only while a live bridge supplies measured values; absent for the model's own illustrative numbers */
  live?: { heart: boolean; muscle: boolean; breathing: boolean; eeg: boolean; source: string }
}

export const BASE: Physio = {
  phase: 'baseline',
  heart: { bpm: 72, irregular: 0, contractility: 1 },
  lungs: { rpm: 14, depth: 1, apnea: 0, consolidation: 0, spo2: 98 },
  diaphragm: 1, esophagus: 1, stomach: 1, gut: 1, adrenals: 1, kidneys: 1,
  bladder: { urgency: 0.2, control: 1 },
  muscle: { strengthL: 1, strengthR: 1, tone: 1, tremor: 0, spasm: 0 },
  cord: { motorFromLeftBrain: 1, motorFromRightBrain: 1, sensoryL: 1, sensoryR: 1, autonomic: 1, vagal: 1, phrenic: 1 },
  visual: { leftBrain: 1, rightBrain: 1 },
}

const clone = (p: Physio): Physio => JSON.parse(JSON.stringify(p))
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Merge changes onto the baseline (shallow per group). */
function make(delta: { [K in keyof Physio]?: Partial<Physio[K]> } & { diaphragm?: number; esophagus?: number; stomach?: number; gut?: number; adrenals?: number; kidneys?: number }): Physio {
  const p = clone(BASE)
  for (const [k, v] of Object.entries(delta)) {
    const cur = (p as unknown as Record<string, unknown>)[k]
    if (typeof v === 'number' || typeof cur !== 'object') (p as unknown as Record<string, unknown>)[k] = v
    else Object.assign(cur as object, v)
  }
  return p
}

/** Steady patterns. The left hemisphere's motor tract serves the RIGHT side of the body and vice versa. */
const STATIC: Record<Exclude<ScenarioId, 'epilepsy'>, Physio> = {
  healthy: BASE,
  stroke: make({
    // left-hemisphere stroke; how much weakness appears depends on whether motor fibres are in the damaged tissue, so it is shown as partial
    heart: { bpm: 88, irregular: 0.35, contractility: 1 },
    lungs: { rpm: 18, depth: 0.9, apnea: 0, consolidation: 0.6, spo2: 94 },
    esophagus: 0.5, stomach: 0.8, gut: 0.8, adrenals: 1.3,
    bladder: { urgency: 0.6, control: 0.5 },
    muscle: { strengthL: 1, strengthR: 0.55, tone: 1.2, tremor: 0, spasm: 0 },
    cord: { motorFromLeftBrain: 0.45, motorFromRightBrain: 1, sensoryL: 1, sensoryR: 0.7, autonomic: 1.1, vagal: 0.85, phrenic: 1 },
  }),
  tbi: make({
    heart: { bpm: 128, irregular: 0.2, contractility: 1.35 },
    lungs: { rpm: 26, depth: 0.8, apnea: 0, consolidation: 0, spo2: 95 },
    diaphragm: 1, esophagus: 0.6, stomach: 0.4, gut: 0.45, adrenals: 2.0, kidneys: 0.7,
    bladder: { urgency: 0.7, control: 0.5 },
    muscle: { strengthL: 0.7, strengthR: 0.7, tone: 1.7, tremor: 0.35, spasm: 0.3 },
    cord: { motorFromLeftBrain: 0.7, motorFromRightBrain: 0.7, sensoryL: 0.8, sensoryR: 0.8, autonomic: 1.7, vagal: 0.7, phrenic: 1 },
  }),
  occipital: make({
    // the damaged tissue is at the back of the right hemisphere: the LEFT half of the visual field is lost in both eyes; the body is unaffected
    visual: { leftBrain: 1, rightBrain: 0.05 },
  }),
  alz: make({
    heart: { bpm: 74, irregular: 0.12, contractility: 1 },
    lungs: { rpm: 15, depth: 0.95, apnea: 0, consolidation: 0, spo2: 96 },
    esophagus: 0.8, stomach: 0.8, gut: 0.7, adrenals: 1.3,
    bladder: { urgency: 0.5, control: 0.6 },
    muscle: { strengthL: 0.85, strengthR: 0.85, tone: 1.1, tremor: 0.1, spasm: 0 },
    cord: { motorFromLeftBrain: 0.9, motorFromRightBrain: 0.9, sensoryL: 1, sensoryR: 1, autonomic: 0.9, vagal: 0.85, phrenic: 1 },
  }),
}

export const SEIZURE_PERIOD = 18
const ICTAL = make({
  heart: { bpm: 150, irregular: 0.25, contractility: 1.3 },
  lungs: { rpm: 5, depth: 0.2, apnea: 0.85, consolidation: 0, spo2: 82 },
  diaphragm: 0.25, esophagus: 0.2, stomach: 0.3, gut: 0.25, adrenals: 2.6, kidneys: 0.8,
  bladder: { urgency: 1, control: 0 },
  muscle: { strengthL: 1, strengthR: 1, tone: 2.2, tremor: 0.6, spasm: 1 },
  cord: { motorFromLeftBrain: 1.5, motorFromRightBrain: 1.5, sensoryL: 0.6, sensoryR: 0.6, autonomic: 2, vagal: 0.5, phrenic: 0.3 },
})
const POST = make({
  heart: { bpm: 98, irregular: 0.1, contractility: 1 },
  lungs: { rpm: 9, depth: 1.4, apnea: 0.1, consolidation: 0, spo2: 92 },
  diaphragm: 1, esophagus: 0.6, stomach: 0.6, gut: 0.5, adrenals: 1.8, kidneys: 0.9,
  bladder: { urgency: 0.4, control: 0.4 },
  muscle: { strengthL: 0.55, strengthR: 0.55, tone: 0.5, tremor: 0.15, spasm: 0 },
  cord: { motorFromLeftBrain: 0.6, motorFromRightBrain: 0.6, sensoryL: 0.8, sensoryR: 0.8, autonomic: 1.4, vagal: 1.1, phrenic: 0.9 },
})

function blend(a: Physio, b: Physio, k: number): Physio {
  const out = clone(a)
  const walk = (x: Record<string, unknown>, y: Record<string, unknown>, o: Record<string, unknown>) => {
    for (const key of Object.keys(x)) {
      if (typeof x[key] === 'number') o[key] = lerp(x[key] as number, y[key] as number, k)
      else if (typeof x[key] === 'object') walk(x[key] as Record<string, unknown>, y[key] as Record<string, unknown>, o[key] as Record<string, unknown>)
    }
  }
  walk(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>, out as unknown as Record<string, unknown>)
  return out
}

/** The physiology at time t seconds for a scenario. Only epilepsy changes with time (a repeating seizure cycle). */
export function physioAt(scenario: ScenarioId, t: number): Physio {
  if (scenario !== 'epilepsy') return STATIC[scenario]
  const u = ((t % SEIZURE_PERIOD) + SEIZURE_PERIOD) % SEIZURE_PERIOD
  const ictal = smooth(7, 8.2, u) * (1 - smooth(13, 14, u)), post = smooth(13.6, 15, u) * (1 - smooth(16.8, 18, u))
  const interictal = make({ heart: { bpm: 74, irregular: 0, contractility: 1 } })
  let p = blend(interictal, ICTAL, ictal)
  p = blend(p, POST, post)
  p.phase = ictal > 0.5 ? 'seizure' : ictal > 0.05 ? 'seizure onset' : post > 0.2 ? 'after the seizure' : u > 6 && u < 7.4 ? 'seizure onset' : 'baseline'
  return p
}

// ---- pathways ---------------------------------------------------------------------------------------------------
/** Signal strength on a pathway id from body-nerves.ts. */
export function pathwayLevel(p: Physio, id: string): number {
  const side = id.endsWith('.-1') ? -1 : 1
  if (id.startsWith('corticospinal')) return side === -1 ? p.cord.motorFromLeftBrain : p.cord.motorFromRightBrain
  if (id.startsWith('sensory')) return side === -1 ? p.cord.sensoryL : p.cord.sensoryR
  if (id.startsWith('autonomic') || id.startsWith('sympathetic')) return p.cord.autonomic
  if (id.startsWith('vagus')) return p.cord.vagal
  if (id.startsWith('phrenic')) return p.cord.phrenic
  if (id.startsWith('sacral')) return p.bladder.control
  if (id.startsWith('visual')) return side === -1 ? p.visual.leftBrain : p.visual.rightBrain
  if (id.startsWith('limb')) {
    // a limb nerve carries what the motor tract of the OPPOSITE brain delivers
    return side === -1 ? p.cord.motorFromRightBrain : p.cord.motorFromLeftBrain
  }
  return 1
}

// ---- readable summaries -------------------------------------------------------------------------------------------
export interface Reading { label: string; value: string; note: string; evidence: Evidence; flag: 'normal' | 'raised' | 'lowered' | 'abnormal'; /** true when the value is measured by a connected bridge rather than modelled */ measured?: boolean }
const flag = (v: number, lo: number, hi: number): Reading['flag'] => (v < lo ? 'lowered' : v > hi ? 'raised' : 'normal')

/** The numbers shown on the vitals panel for the current moment. */
export function readings(p: Physio): Reading[] {
  const rhythm = p.heart.irregular > 0.3 ? 'irregular' : p.heart.irregular > 0.1 ? 'slightly irregular' : 'regular'
  const motor = Math.min(p.cord.motorFromLeftBrain, p.cord.motorFromRightBrain)
  return [
    { label: 'Heart rate', value: `${Math.round(p.heart.bpm)} beats/min, ${rhythm}`, note: p.live?.heart ? 'Measured from your ECG channel. Resting adult range is 60-100.' : 'Resting adult range is 60-100.', evidence: 'established', flag: flag(p.heart.bpm, 60, 100), measured: !!p.live?.heart },
    { label: 'Breathing', value: p.lungs.apnea > 0.5 ? 'paused (apnea)' : `${Math.round(p.lungs.rpm)} breaths/min`, note: 'Resting adult range is 12-20.', evidence: 'established', flag: p.lungs.apnea > 0.5 ? 'abnormal' : flag(p.lungs.rpm, 12, 20), measured: !!p.live?.breathing },
    { label: 'Blood oxygen (illustrative)', value: `${Math.round(p.lungs.spo2)}%`, note: 'Usually 95-100% at rest.', evidence: 'supported', flag: flag(p.lungs.spo2, 95, 101) },
    { label: 'Diaphragm drive (phrenic nerve)', value: `${Math.round(p.cord.phrenic * 100)}%`, note: 'Carried by C3-C5.', evidence: 'established', flag: flag(p.cord.phrenic, 0.9, 1.2) },
    { label: 'Swallowing', value: `${Math.round(p.esophagus * 100)}% of normal`, note: 'Vagus and brain stem coordinate each swallow.', evidence: 'established', flag: flag(p.esophagus, 0.9, 2) },
    { label: 'Gut movement', value: `${Math.round(p.gut * 100)}% of normal`, note: 'Parasympathetic input speeds it, sympathetic slows it.', evidence: 'established', flag: flag(p.gut, 0.8, 1.3) },
    { label: 'Adrenal output', value: `${Math.round(p.adrenals * 100)}% of normal`, note: 'Cortisol, adrenaline and norepinephrine.', evidence: 'established', flag: flag(p.adrenals, 0.8, 1.3) },
    { label: 'Kidney blood flow', value: `${Math.round(p.kidneys * 100)}% of normal`, note: 'Sympathetic nerves narrow renal vessels.', evidence: 'supported', flag: flag(p.kidneys, 0.85, 1.2) },
    { label: 'Bladder control', value: `${Math.round(p.bladder.control * 100)}%`, note: 'Pontine and sacral pathways hold or release urine.', evidence: 'established', flag: flag(p.bladder.control, 0.85, 2) },
    { label: 'Muscle strength (left / right)', value: `${Math.round(p.muscle.strengthL * 100)}% / ${Math.round(p.muscle.strengthR * 100)}%`, note: 'Share of normal force.', evidence: 'established', flag: flag(Math.min(p.muscle.strengthL, p.muscle.strengthR), 0.85, 2) },
    { label: 'Muscle tone', value: p.muscle.spasm > 0.5 ? 'convulsing' : `${p.muscle.tone.toFixed(1)} x normal`, note: p.live?.muscle ? 'Measured from your EMG channels, relative to your resting baseline.' : 'Raised tone means stiffness (spasticity).', evidence: 'established', flag: flag(p.muscle.tone, 0.7, 1.3), measured: !!p.live?.muscle },
    { label: 'Motor pathways through the cord', value: `${Math.round(motor * 100)}% of normal`, note: 'Corticospinal tracts from each hemisphere.', evidence: 'established', flag: flag(motor, 0.9, 1.2) },
    { label: 'Sympathetic outflow (T1-L2)', value: `${Math.round(p.cord.autonomic * 100)}% of normal`, note: 'Fight-or-flight output to organs.', evidence: 'established', flag: flag(p.cord.autonomic, 0.8, 1.25) },
    { label: 'Vagus nerve tone', value: `${Math.round(p.cord.vagal * 100)}% of normal`, note: 'Rest-and-digest output and organ feedback.', evidence: 'established', flag: flag(p.cord.vagal, 0.85, 1.2) },
  ]
}

/** The pathways summarised as bars on the panel. */
export const PATHWAY_BARS: { id: string; label: string }[] = [
  { id: 'corticospinal.-1', label: 'Left brain to right body (motor, corticospinal)' },
  { id: 'corticospinal.1', label: 'Right brain to left body (motor, corticospinal)' },
  { id: 'sensory.-1', label: 'Left body to brain (touch and position, dorsal column)' },
  { id: 'sensory.1', label: 'Right body to brain (touch and position, dorsal column)' },
  { id: 'autonomic.1', label: 'Sympathetic outflow (hypothalamus to T1-L2)' },
  { id: 'vagus.1', label: 'Vagus nerves (rest and digest)' },
  { id: 'phrenic.1', label: 'Phrenic nerves to the diaphragm (C3-C5)' },
  { id: 'visual.-1', label: 'Visual pathway to the left occipital lobe (right visual field)' },
  { id: 'visual.1', label: 'Visual pathway to the right occipital lobe (left visual field)' },
]
