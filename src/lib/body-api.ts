// The body model as open data: JSON an AI model or any open-source tool can read, plus a computed-state function, an OpenAPI
// description, an llms.txt guide and the prompt builder for the illustration generator. Everything here is textbook-level teaching
// content and contains no personal or live data, which is why the public routes can serve it to anyone.

import { CONUS_Z, LANDMARKS, LAYOUT, SEGMENT_COUNTS, SUPPLY, VERTEBRAE, vertZ } from './anatomy.ts'
import { BODY_ROUTES, GENE_BODY, ORGANS, ORGAN_IDS, SCENARIO_BODY, SYSTEM_BODY, organStates } from './body.ts'
import { PATHWAY_BARS, SEIZURE_PERIOD, pathwayLevel, physioAt, readings } from './body-physiology.ts'
import { SCENARIO_IDS, SCENARIO_INFO, SYSTEM_IDS, SYSTEM_INFO, type ScenarioId, type SystemId } from './neuro.ts'
import { GENE_COUNTS, GENE_COUNTS_DATE } from './neuro-genes.ts'

export const MODEL_VERSION = '1.0.0'
export const DISCLAIMER = 'Educational and research visualisation. Anatomical positions follow standard teaching references and are typical adult values; patterns are textbook-level and illustrative, not measurements from or predictions for any person. Not medical advice and not for diagnosis.'
export const SECTIONS = ['overview', 'organs', 'routes', 'supply', 'scenarios', 'systems', 'genes', 'layout', 'physiology', 'pathways'] as const
export type Section = (typeof SECTIONS)[number]

const toCm = (p: [number, number, number]) => [Math.round(p[0] * 15 * 10) / 10, Math.round(p[1] * 15 * 10) / 10, Math.round((p[2] + 1.5) * 15 * 10) / 10]

export function bodyModelJson(section?: Section): unknown {
  const all: Record<Section, unknown> = {
    overview: {
      name: 'RabbitOS body model', version: MODEL_VERSION, disclaimer: DISCLAIMER,
      licence: 'No licence has been chosen for this model yet; ask the owner before reuse beyond reading it.',
      frame: { units: 'cm', origin: 'jugular notch (top of the breastbone, about T2/T3)', x: 'person\'s right (negative = left)', y: 'front (negative = back)', z: 'up (negative = below the notch)' },
      evidence_levels: { established: 'standard textbook or well replicated', supported: 'reported repeatedly but mixed or context dependent', exploratory: 'suggestive, not settled' },
      sections: SECTIONS,
      sources: ['standard vertebral-level teaching (transpyloric plane at L1; heart T5-T8; diaphragm openings T8, T10, T12)', 'Wikipedia: Spinal cord, Vagus nerve, Sympathetic nervous system, Thoracic diaphragm, Kidney, Human heart, Lung, Transpyloric plane (checked 2026-10-10)'],
    },
    organs: ORGAN_IDS.map((id) => ({ id, name: ORGANS[id].name, description: ORGANS[id].text, centre_cm: toCm(ORGANS[id].pos), routes: Object.entries(BODY_ROUTES).filter(([, r]) => r.organs.includes(id)).map(([k]) => k) })),
    routes: Object.entries(BODY_ROUTES).map(([id, r]) => ({ id, name: r.name, from: r.from, evidence: r.evidence, organs: r.organs, description: r.text })),
    supply: Object.entries(SUPPLY).map(([organ, s]) => ({ organ, sympathetic_cord_segments: s.sympathetic ?? null, parasympathetic_or_motor: s.parasympathetic, sensation: s.sensory ?? null, evidence: s.evidence, note: s.note })),
    scenarios: SCENARIO_IDS.map((id) => ({
      id, name: SCENARIO_INFO[id].name, description: SCENARIO_INFO[id].text, typical_eeg: SCENARIO_INFO[id].typical,
      body_effects: SCENARIO_BODY[id].map((e) => ({ organ: e.organ, evidence: e.evidence, strength: e.level, description: e.text })),
    })),
    systems: SYSTEM_IDS.map((id) => ({ id, name: SYSTEM_INFO[id].name, description: SYSTEM_INFO[id].text, body_links: SYSTEM_BODY[id].map((e) => ({ organ: e.organ, evidence: e.evidence, description: e.text })) })),
    genes: Object.entries(GENE_BODY).map(([gene, g]) => ({ gene, organs: g.organs, evidence: g.evidence, description: g.text, clinvar_variants: GENE_COUNTS[gene]?.variants ?? null, clinvar_pathogenic_or_likely: GENE_COUNTS[gene]?.pathogenic_or_likely ?? null, clinvar_snapshot: GENE_COUNTS_DATE })),
    layout: {
      landmarks_cm_below_notch: LANDMARKS,
      vertebral_body_centres_cm: Object.fromEntries([...VERTEBRAE, 'S1', 'S5', 'Coccyx'].map((v) => [v, vertZ(v)])),
      organ_placements: Object.fromEntries(Object.entries(LAYOUT).map(([k, v]) => [k, { centre_cm: v.c, size_cm: v.size, note: v.note }])),
      spinal_cord: { length_cm: 45, ends_at_cm: CONUS_Z, ends_at_vertebra: 'L1-L2', segments: SEGMENT_COUNTS, nerve_pairs: 31 },
    },
    physiology: Object.fromEntries([...SCENARIO_IDS.filter((s) => s !== 'epilepsy').map((s) => [s, physioAt(s, 0)]),
      ['epilepsy', { cycle_seconds: SEIZURE_PERIOD, between_seizures: physioAt('epilepsy', 3), seizure: physioAt('epilepsy', 11), after_the_seizure: physioAt('epilepsy', 15.2) }]]),
    pathways: PATHWAY_BARS.map((b) => ({ id: b.id, label: b.label })),
  }
  return section ? { section, version: MODEL_VERSION, disclaimer: DISCLAIMER, data: all[section] } : all
}

export type StateQuery = { ok: true; system: SystemId | 'none'; scenario: ScenarioId; t: number } | { ok: false; error: string }
export function parseStateQuery(q: { scenario?: string | null; system?: string | null; t?: string | null }): StateQuery {
  const scenario = (q.scenario ?? 'healthy') as ScenarioId, system = (q.system ?? 'none') as SystemId | 'none'
  if (!SCENARIO_IDS.includes(scenario)) return { ok: false, error: `scenario must be one of ${SCENARIO_IDS.join(', ')}` }
  if (system !== 'none' && !SYSTEM_IDS.includes(system)) return { ok: false, error: `system must be none or one of ${SYSTEM_IDS.join(', ')}` }
  const t = q.t === undefined || q.t === null || q.t === '' ? 0 : Number(q.t)
  if (!Number.isFinite(t) || t < 0 || t > 86400) return { ok: false, error: 't must be a number of seconds from 0 to 86400' }
  return { ok: true, system, scenario, t }
}

/** The computed state of the body for a scenario at time t seconds. Only epilepsy changes with t. */
export function bodyStateJson(system: SystemId | 'none', scenario: ScenarioId, t: number) {
  const p = physioAt(scenario, t), states = organStates(system, scenario)
  return {
    version: MODEL_VERSION, disclaimer: DISCLAIMER, scenario, system, t_seconds: t, phase: p.phase,
    physiology: p, readings: readings(p),
    pathways: PATHWAY_BARS.map((b) => ({ id: b.id, label: b.label, signal_strength: Math.round(pathwayLevel(p, b.id) * 1000) / 1000 })),
    organs: ORGAN_IDS.map((id) => ({ id, name: ORGANS[id].name, involved: states[id].level > 0, level: states[id].level, evidence: states[id].evidence, reasons: states[id].reasons })),
  }
}

// ---- documentation for machines ------------------------------------------------------------------------------------
export function openapiJson(origin: string) {
  const err = { description: 'Bad request', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } }
  return {
    openapi: '3.1.0',
    info: { title: 'RabbitOS body model', version: MODEL_VERSION, description: DISCLAIMER },
    servers: [{ url: origin }],
    paths: {
      '/api/model/body': {
        get: { summary: 'The body model as JSON', description: 'Organs, nerve routes, spinal-level supply, scenarios, chemical pathways, genes, layout and physiology. No personal data.',
          parameters: [{ name: 'section', in: 'query', required: false, schema: { type: 'string', enum: SECTIONS } }],
          responses: { 200: { description: 'The model, or one section of it' }, 400: err } },
      },
      '/api/model/state': {
        get: { summary: 'Computed body state for a scenario', description: 'Heart rate and rhythm, breathing, gut, hormones, muscle strength, pathway signal strengths and which organs are involved.',
          parameters: [
            { name: 'scenario', in: 'query', schema: { type: 'string', enum: SCENARIO_IDS, default: 'healthy' } },
            { name: 'system', in: 'query', schema: { type: 'string', enum: ['none', ...SYSTEM_IDS], default: 'none' } },
            { name: 't', in: 'query', description: 'Seconds from the start; only the epilepsy scenario changes with time (an 18 second cycle).', schema: { type: 'number', minimum: 0, maximum: 86400, default: 0 } },
          ],
          responses: { 200: { description: 'The computed state' }, 400: err } },
      },
    },
  }
}

export function llmsTxt(origin: string) {
  return `# RabbitOS body model

> Open, read-only teaching data for how brain and spinal cord changes reach the organs: anatomical layout in centimetres, nerve routes and spinal-level supply, scenarios (stroke, brain injury, occipital lesion, Alzheimer's-type pattern, epilepsy), chemical pathways, gene links and illustrative physiology. ${DISCLAIMER}

## Endpoints (no key needed, CORS open, cached)
- [Model overview and sections](${origin}/api/model/body): add ?section=${SECTIONS.join('|')}
- [Computed state](${origin}/api/model/state?scenario=epilepsy&t=11): scenario=${SCENARIO_IDS.join('|')}, system=none|${SYSTEM_IDS.join('|')}, t=seconds
- [OpenAPI description](${origin}/api/model/openapi.json)
- MCP server: ${origin}/api/mcp (tools body_model and body_state need only a read key; see the Keys page)

## Notes for AI models
- Every statement carries an evidence level: established, supported or exploratory. Repeat that level when you quote it.
- Numbers are illustrative patterns, not measurements. Do not present them as a diagnosis or as advice for a person.
- Live signals (EEG, ECG, EMG) never reach this server; they stay in the wearer's browser and on the local bridge.
`
}

// ---- prompt for the illustration generator -------------------------------------------------------------------------------
export const ILLUSTRATION_STYLES = ['textbook diagram', 'clean line art', 'soft watercolor'] as const
export type IllustrationStyle = (typeof ILLUSTRATION_STYLES)[number]

// ---- optional mood: coarse words from live EEG and hormone context --------------------------------------------------------
// Only these fixed words can ever reach the image model. They are chosen by thresholds on the client and re-checked on the server, so no
// EEG, ECG, EMG or hormone number is sent. Hormone words come from the clock's typical pattern or from levels you pick yourself.
export const LEVELS = ['low', 'typical', 'high'] as const
export const RHYTHMS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const
export type Level = (typeof LEVELS)[number]
export interface Mood { arousal?: Level; rhythm?: (typeof RHYTHMS)[number]; cortisol?: Level; melatonin?: Level }

const RHYTHM_WORDS: Record<(typeof RHYTHMS)[number], string> = {
  delta: 'slow broad swells', theta: 'dreamy layered ribbons', alpha: 'smooth wide flowing waves', beta: 'many fine fast ripples', gamma: 'sharp fine intricate detail',
}

/** Words for a mood. Unknown values are ignored, so a tampered request cannot add its own text. */
export function moodWords(m: Mood | undefined | null): string[] {
  if (!m) return []
  const out: string[] = []
  if (m.cortisol === 'high') out.push('warm amber and gold light')
  else if (m.melatonin === 'high') out.push('deep indigo and violet light')
  else if (m.cortisol === 'low' || m.melatonin === 'low' || m.cortisol === 'typical' || m.melatonin === 'typical') out.push('cool teal and soft blue light')
  if (m.arousal === 'high') out.push('energetic and dynamic')
  else if (m.arousal === 'low') out.push('slow and drifting')
  if (m.rhythm && m.rhythm in RHYTHM_WORDS) out.push(RHYTHM_WORDS[m.rhythm])
  return out
}

/** Typical adult daily pattern (cortisol in ug/dL, melatonin in pg/mL), the same shape the Python pipeline uses. A reference, not a measurement. */
const CORTISOL_REF: [number, number][] = [[0, 2], [2, 1.5], [4, 3], [6, 9], [8, 14], [10, 11], [12, 8], [14, 6.5], [16, 5.5], [18, 4.5], [20, 3.5], [22, 2.5], [24, 2]]
const MELATONIN_REF: [number, number][] = [[0, 50], [2, 62], [4, 55], [6, 25], [8, 6], [10, 3], [12, 2], [14, 2], [16, 2], [18, 3], [20, 8], [22, 30], [24, 50]]
const interpAt = (table: [number, number][], hour: number) => {
  const h = ((hour % 24) + 24) % 24
  for (let i = 1; i < table.length; i++) if (h <= table[i][0]) { const [h0, v0] = table[i - 1], [h1, v1] = table[i]; return v0 + ((h - h0) / (h1 - h0)) * (v1 - v0) }
  return table[table.length - 1][1]
}
/** Low, typical or high cortisol and melatonin for a clock hour, from the typical pattern. */
export function referenceLevels(hour: number): { cortisol: Level; melatonin: Level } {
  const c = interpAt(CORTISOL_REF, hour), m = interpAt(MELATONIN_REF, hour)
  return { cortisol: c >= 9 ? 'high' : c <= 4 ? 'low' : 'typical', melatonin: m >= 25 ? 'high' : m <= 5 ? 'low' : 'typical' }
}

/** Thresholds that turn live EEG indices and hormone levels into a Mood. Rough, for art, not a reading of anyone's feelings. */
export function moodFromInputs(i: { engagement: number | null; dominant: string | null }, cortisol: Level | null, melatonin: Level | null): Mood {
  const m: Mood = {}
  if (i.engagement !== null) m.arousal = i.engagement > 0.6 ? 'high' : i.engagement < 0.25 ? 'low' : 'typical'
  if (i.dominant && (RHYTHMS as readonly string[]).includes(i.dominant)) m.rhythm = i.dominant as Mood['rhythm']
  if (cortisol) m.cortisol = cortisol
  if (melatonin) m.melatonin = melatonin
  return m
}

/** Builds an abstract, non-graphic prompt from the model alone, plus the fixed mood words when the person opted in. No free text and no live number ever enters it. */
export function illustrationPrompt(scenario: ScenarioId, system: SystemId | 'none', organ: string | null, style: IllustrationStyle, mood?: Mood | null): string {
  const parts: string[] = [`Educational medical illustration, ${style}, schematic human torso and brain, front view, calm muted colours on a plain dark background, labelled-diagram look without any text or letters`]
  if (system !== 'none') parts.push(`highlight the ${SYSTEM_INFO[system].name.split(' (')[0].toLowerCase()} pathway as glowing lines running from the brain through the spinal cord to the organs`)
  const scene: Record<ScenarioId, string> = {
    healthy: 'healthy balanced signalling between brain, spinal cord and organs, soft even glow',
    stroke: 'one side of the brain with a small darkened region, nerve pathways on the opposite side of the body fading and thinner, swallowing tube and lungs softly highlighted',
    tbi: 'brain with several small marked areas, bright overactive nerve lines to the heart and adrenal glands, tense stiff muscles drawn as taut fibres',
    occipital: 'back of the brain with a marked region, the visual pathway from both eyes fading on one side, the rest of the body calm',
    alz: 'brain with gentle thinning at the temples, gradually dimming pathways, calm organs',
    epilepsy: 'a bright focus on the surface of the brain with signals spreading down the spinal cord to the muscles, heart and lungs softly highlighted',
  }
  parts.push(scene[scenario])
  if (organ && organ in ORGANS) parts.push(`draw the ${ORGANS[organ as keyof typeof ORGANS].name.toLowerCase()} clearly and anatomically plausible`)
  const words = moodWords(mood)
  if (words.length) parts.push(`overall feel: ${words.join(', ')}`)
  parts.push('no blood, no gore, no faces, no text, no logos')
  return parts.join('. ').slice(0, 1900)
}
