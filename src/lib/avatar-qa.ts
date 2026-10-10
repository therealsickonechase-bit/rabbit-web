// What the avatar says when you ask it something, instead of clicking on an organ or on the brain. The answers are built from the body model
// (organs, nerve routes, genes, scenarios, physiology) and from the avatar's own current state. No AI service is involved. Pure functions, tested.
//
// The avatar speaks in the first person but it is a model: it says so when asked, every number it quotes is an illustrative model value (or a value
// from a connected bridge, which the page labels), and nothing it says is medical advice.

import type { Level } from './body-api.ts'
import { BODY_ROUTES, GENE_BODY, ORGANS, ORGAN_IDS, type OrganId } from './body.ts'
import { SCENARIO_INFO, SYSTEM_INFO, type Evidence, type ScenarioId } from './neuro.ts'
import type { Physio } from './body-physiology.ts'
import { identifiersFor } from './gene-ids.ts'
import { INTENTS, type Affect, type Intent } from './avatar-mind.ts'

export interface AvatarContext {
  affect: Affect
  emotion: string
  intent: Intent
  thought: string
  reasons: string[]
  hormones: { cortisol: Level; melatonin: Level; label: string }
  physio: Physio
  scenario: ScenarioId
  /** 'simulated twin' unless a bridge supplies real signals */
  source: 'simulated twin' | 'live signals'
  eeg: Record<'delta' | 'theta' | 'alpha' | 'beta' | 'gamma', number>
}

export interface Answer { text: string; topic: string; organ?: OrganId; evidence?: Evidence }

const SYNONYMS: Record<OrganId, string[]> = {
  eyes: ['eye', 'eyes', 'vision', 'see', 'sight', 'optic', 'visual', 'retina'],
  lungs: ['lung', 'lungs', 'breath', 'breathing', 'breathe', 'oxygen', 'airway'],
  heart: ['heart', 'pulse', 'heartbeat', 'cardiac', 'blood pressure'],
  diaphragm: ['diaphragm', 'phrenic'],
  esophagus: ['oesophagus', 'esophagus', 'swallow', 'swallowing', 'gullet'],
  liver: ['liver', 'bile', 'glucose'],
  gallbladder: ['gallbladder', 'gall bladder'],
  stomach: ['stomach', 'tummy', 'digest', 'digestion', 'hunger', 'nausea'],
  pancreas: ['pancreas', 'insulin'],
  spleen: ['spleen', 'immune', 'immunity'],
  adrenals: ['adrenal', 'adrenals', 'adrenaline', 'adrenal glands'],
  kidneys: ['kidney', 'kidneys', 'renal'],
  gut: ['gut', 'intestine', 'intestines', 'bowel', 'colon', 'enteric'],
  bladder: ['bladder', 'urine', 'pee', 'urinate'],
  muscle: ['muscle', 'muscles', 'arm', 'arms', 'leg', 'legs', 'strength', 'movement', 'walk', 'run'],
  spinalcord: ['spinal', 'spine', 'cord', 'nerves', 'nerve'],
}

const has = (q: string, words: string[]) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q))
const pct = (x: number) => `${Math.round(x * 100)}%`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** How hard the body is working, which raises heart and breathing above the model's resting numbers. */
const EXERTION: Record<Intent, number> = { rest: -0.1, stand: 0, look: 0, stretch: 0.05, stroll: 0.15, walk: 0.3, pace: 0.4, jog: 0.9, run: 1.5 }
export const heartNow = (c: AvatarContext) => Math.round(c.physio.heart.bpm * (1 + EXERTION[c.intent] * 0.45 + (c.affect.arousal - 0.5) * 0.2))
export const breathNow = (c: AvatarContext) => Math.round(c.physio.lungs.rpm * (1 + EXERTION[c.intent] * 0.9 + (c.affect.arousal - 0.5) * 0.2))

function organNow(id: OrganId, c: AvatarContext): string {
  const p = c.physio
  switch (id) {
    case 'heart': return `Right now it beats about ${heartNow(c)} times a minute (${c.source === 'live signals' ? 'measured' : 'model value'}).`
    case 'lungs': return `I am breathing about ${breathNow(c)} breaths a minute with oxygen near ${p.lungs.spo2}%.`
    case 'diaphragm': return `It is moving at my breathing rate, about ${breathNow(c)} a minute.`
    case 'stomach': return `Its activity is ${p.stomach >= 0.9 ? 'normal' : p.stomach < 0.5 ? 'much slower than normal' : 'slower than normal'}${c.affect.stress > 0.55 ? '; stress is slowing digestion a little' : ''}.`
    case 'gut': return `Gut movement is ${p.gut >= 0.9 ? 'normal' : 'reduced'}${c.affect.stress > 0.55 ? ', and my stress is pushing it off balance' : ''}.`
    case 'adrenals': return `My cortisol is ${c.hormones.cortisol} (${c.hormones.label}), so they are ${c.hormones.cortisol === 'high' ? 'working hard' : c.hormones.cortisol === 'low' ? 'quiet' : 'at their usual output'}.`
    case 'muscle': return `Strength is ${Math.round(Math.min(p.muscle.strengthL, p.muscle.strengthR) * 100)}% to ${Math.round(Math.max(p.muscle.strengthL, p.muscle.strengthR) * 100)}% of normal across my two sides${p.muscle.tremor > 0.1 ? ', with some tremor' : ''}.`
    case 'bladder': return `Urgency is ${p.bladder.urgency > 0.6 ? 'high' : 'low'} and control is ${p.bladder.control >= 0.9 ? 'normal' : 'reduced'}.`
    case 'kidneys': return `Their output is ${p.kidneys >= 0.9 ? 'normal' : 'changed'} in this scenario.`
    case 'spinalcord': return `Signals on my autonomic pathway are at ${pct(p.cord.autonomic)} of normal and vagal signals at ${pct(p.cord.vagal)}.`
    case 'eyes': return `The visual pathway is carrying ${pct(Math.min(p.visual.leftBrain, p.visual.rightBrain))} of normal signal in the weaker hemisphere.`
    default: return ''
  }
}

function routesFor(id: OrganId): string {
  const routes = Object.values(BODY_ROUTES).filter((r) => r.organs.includes(id))
  if (!routes.length) return ''
  return ` The brain reaches it through ${routes.slice(0, 3).map((r) => `${r.name.toLowerCase()} (${r.evidence})`).join(', ')}.`
}

function describeOrgan(id: OrganId, c: AvatarContext): Answer {
  const o = ORGANS[id]
  const now = organNow(id, c)
  const worst = Object.values(BODY_ROUTES).filter((r) => r.organs.includes(id)).map((r) => r.evidence).includes('established') ? 'established' : 'supported'
  return { topic: `organ:${id}`, organ: id, evidence: worst as Evidence, text: `${o.name}: ${o.text}${routesFor(id)} ${now}`.trim() }
}

function eegLine(c: AvatarContext): string {
  const order = (['alpha', 'beta', 'theta', 'delta', 'gamma'] as const).slice().sort((a, b) => c.eeg[b] - c.eeg[a])
  return `${order.slice(0, 3).map((b) => `${b} ${pct(c.eeg[b])}`).join(', ')} of my EEG power`
}

/** Answer a question from the model and the avatar's state. Always returns something useful, never invents data. */
export function answer(question: string, c: AvatarContext): Answer {
  const q = question.trim().toLowerCase()
  if (!q) return { topic: 'empty', text: 'Ask me anything about my body, my mind or how I feel. For example: "How do you feel?", "Why are you running?" or "How is your heart?"' }

  if (has(q, ['conscious', 'alive', 'real', 'sentient', 'do you think', 'are you a person', 'who are you', 'what are you'])) {
    return { topic: 'nature', text: `I am a simulation of a body and mind, built from a textbook model and my twin's hormone, EEG and heart signals. I make my own choices from rules, and I can tell you why, but I am not conscious and I do not truly feel. ${cap(c.thought)}` }
  }
  if (has(q, ['hello', 'hi', 'hey', 'good morning', 'good evening'])) {
    return { topic: 'greeting', text: `Hello. I feel ${c.emotion} right now and I am ${describeIntent(c.intent)}. Ask me about my body, my mind or why I do what I do.` }
  }
  if (has(q, ['how do you feel', 'how are you', 'your mood', 'your emotion', 'emotions', 'feeling', 'feelings'])) {
    return { topic: 'feel', text: `I feel ${c.emotion}. My arousal is ${pct(c.affect.arousal)}, my energy ${pct(c.affect.energy)}, my stress ${pct(c.affect.stress)} and my tiredness ${pct(c.affect.fatigue)}.${c.reasons.length ? ` That comes from the fact that ${c.reasons.slice(0, 3).join(', and ')}.` : ''} These come from a simple model, not a reading of real feelings.` }
  }
  if (has(q, ['why are you', 'what are you doing', 'why do you', 'where are you going', 'what are you thinking', 'your thoughts', 'thinking', 'decide', 'decision', 'choice'])) {
    return { topic: 'why', text: `${c.thought} I pick what to do from my mood: tiredness pulls me toward rest, energy and arousal toward faster movement, stress toward pacing. Each choice has a bit of chance in it, so I do not always do the same thing.` }
  }
  if (has(q, ['eeg', 'brain wave', 'brainwave', 'alpha', 'beta', 'theta', 'delta', 'gamma', 'brain activity'])) {
    return { topic: 'eeg', evidence: 'exploratory', text: `My EEG shows ${eegLine(c)}. ${c.source === 'simulated twin' ? 'It is synthetic: generated from my mood (more alpha when calm, more beta when aroused, more theta and delta when tired), not recorded from anyone.' : 'It comes from the signals connected to this page.'} Mapping EEG to mood is a rough idea, not a reliable reading.` }
  }
  if (has(q, ['cortisol', 'melatonin', 'hormone', 'hormones', 'stress hormone'])) {
    return { topic: 'hormones', evidence: 'established', text: `My cortisol is ${c.hormones.cortisol} and my melatonin ${c.hormones.melatonin} (${c.hormones.label}). Cortisol raises alertness and stress; melatonin makes me sleepy. ${c.hormones.melatonin === 'high' ? 'That is why I feel drowsy.' : c.hormones.cortisol === 'high' ? 'That is why I feel keyed up.' : 'Both are in a usual range, so they are not pushing me much.'}` }
  }
  if (has(q, ['gene', 'genes', 'dna', 'slc6a4', 'serotonin transporter', 'genetic'])) {
    const g = GENE_BODY.SLC6A4, ids = identifiersFor('SLC6A4')
    return { topic: 'gene', evidence: g.evidence, text: `${g.text}${ids ? ` My model uses SLC6A4 (NCBI Gene ${ids.ncbi_gene_id}, ${ids.cytoband}). ${ids.summary.split('. ')[0]}.` : ''}` }
  }
  if (has(q, ['nervous system', 'vagus', 'sympathetic', 'parasympathetic', 'fight or flight', 'brain stem', 'brainstem'])) {
    const r = has(q, ['vagus']) ? BODY_ROUTES.vagus : has(q, ['sympathetic', 'fight or flight']) ? BODY_ROUTES.sympathetic : BODY_ROUTES.motor
    return { topic: 'nerves', evidence: r.evidence, text: `${r.name}: ${r.text} It starts in the ${r.from}.` }
  }
  for (const [key, info] of Object.entries(SYSTEM_INFO)) {
    if (has(q, [info.name.toLowerCase(), key.toLowerCase()])) return { topic: `system:${key}`, text: `${info.name}: ${info.text}` }
  }
  if (has(q, ['stroke', 'brain injury', 'tbi', 'concussion', 'alzheimer', 'epilepsy', 'seizure', 'healthy', 'scenario'])) {
    const s = SCENARIO_INFO[c.scenario]
    return { topic: 'scenario', text: `I am currently showing the "${s.name}" scenario. ${s.text} Typical EEG: ${s.typical}.` }
  }
  if (has(q, ['heart rate', 'pulse', 'heartbeat', 'bpm'])) return { ...describeOrgan('heart', c), topic: 'heart-rate' }
  if (has(q, ['breathing rate', 'breaths'])) return { ...describeOrgan('lungs', c), topic: 'breath' }
  for (const id of ORGAN_IDS) if (has(q, SYNONYMS[id])) return describeOrgan(id, c)
  if (has(q, ['brain', 'mind', 'head', 'neuron', 'cortex', 'hippocampus', 'amygdala'])) {
    return { topic: 'mind', text: `My mind here is the model behind my choices: hormones and time of day set my arousal and tiredness, EEG-style signals nudge them, and from that I choose how to move. ${cap(c.thought)}` }
  }
  if (has(q, ['help', 'what can', 'what do you know', 'ask'])) {
    return { topic: 'help', text: 'You can ask about how I feel, why I am doing what I am doing, my EEG, my hormones, my heart or breathing, any organ (liver, kidneys, stomach, gut, lungs, spinal cord, muscles and so on), the nervous system, the SLC6A4 gene, or the scenario I am showing.' }
  }
  return { topic: 'unknown', text: `I do not have an answer to that in my body model. Try asking about how I feel, why I am ${describeIntent(c.intent)}, or an organ such as the heart, liver or gut.` }
}

export function describeIntent(i: Intent): string {
  return { rest: 'resting', stand: 'standing', look: 'looking around', stroll: 'strolling', walk: 'walking', pace: 'pacing', jog: 'jogging', run: 'running', stretch: 'stretching' }[i]
}

export const SUGGESTED_QUESTIONS = ['How do you feel?', 'Why are you moving like that?', 'How is your heart?', 'What does your liver do?', 'What is your EEG showing?', 'Tell me about your cortisol.', 'Are you conscious?'] as const

// ---- optional free conversation with Claude (the person's own key): only fixed words about the avatar's state are sent -----------------------------------------------------------

export const AVATAR_ASK_LIMITS = { question: 400, history: 6 } as const

/** The system prompt for the optional Claude conversation. Built from words only: no EEG, hormone or heart numbers and no personal data. */
export function buildAvatarSystem(c: Pick<AvatarContext, 'emotion' | 'intent' | 'scenario' | 'source'> & { cortisol: Level; melatonin: Level }): string {
  return [
    'You are the voice of a simulated human avatar in a teaching and research visualisation (RabbitOS). You speak in the first person, in plain, warm, concise language (at most 4 sentences).',
    `Your current state, in words: you feel ${c.emotion}; you are ${describeIntent(c.intent)}; cortisol is ${c.cortisol}; melatonin is ${c.melatonin}; the body scenario shown is "${SCENARIO_INFO[c.scenario].name}"; your signals come from a ${c.source}.`,
    'Rules: you are a model, not a person: never claim to be conscious or to truly feel, and say so if asked. Give general textbook anatomy, physiology and neuroscience only. Never give medical advice, diagnosis, treatment or dosing: say a clinician should be asked. Do not invent measurements or numbers about the user. If asked for something outside biology and this visualisation, politely decline.',
  ].join('\n')
}

/** Check that a conversation request is well-formed before it reaches the server route. Returns the cleaned question or an error. */
export function cleanQuestion(q: unknown): { ok: true; question: string } | { ok: false; error: string } {
  if (typeof q !== 'string') return { ok: false, error: 'Type a question first.' }
  const t = q.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
  if (t.length < 2) return { ok: false, error: 'Type a question first.' }
  if (t.length > AVATAR_ASK_LIMITS.question) return { ok: false, error: `Keep it under ${AVATAR_ASK_LIMITS.question} characters.` }
  return { ok: true, question: t }
}

export const AVATAR_INTENTS = INTENTS

/** Where an organ sits on the avatar, in metres in the avatar's own frame (+X = the avatar's left, +Y up, +Z in front). Converted from the body model's centimetres below the jugular notch. */
export function organSpot(id: OrganId): [number, number, number] {
  if (id === 'eyes') return [0, 1.675, 0.1]
  if (id === 'muscle') return [0.12, 0.72, 0.03]
  const [px, py, pz] = ORGANS[id].pos
  return [-(px * 15) / 100, 1.43 + ((pz + 1.5) * 15) / 100, (py * 15) / 100]
}
