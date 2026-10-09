// Textbook knowledge behind the brain pathways and the chemistry / DNA map. Pure data and small functions.
//
// Every link carries an evidence level:
//   established  standard textbook or well replicated
//   supported    reported repeatedly, but mixed or context dependent
//   exploratory  suggestive, not settled
// This is education and research context, not medical advice. An EEG alone cannot diagnose a condition.

import { GENE_COUNTS } from './neuro-genes.ts'

export type Evidence = 'established' | 'supported' | 'exploratory'
export type SystemId = 'dopamine' | 'serotonin' | 'norepinephrine' | 'acetylcholine' | 'thalamocortical' | 'hpa'
export type ScenarioId = 'healthy' | 'stroke' | 'tbi' | 'occipital' | 'alz' | 'epilepsy'
export type NodeKind = 'gene' | 'system' | 'eeg' | 'cond'

export const SYSTEM_IDS: SystemId[] = ['dopamine', 'serotonin', 'norepinephrine', 'acetylcholine', 'thalamocortical', 'hpa']
export const SCENARIO_IDS: ScenarioId[] = ['healthy', 'stroke', 'tbi', 'occipital', 'alz', 'epilepsy']

export const SYSTEM_INFO: Record<SystemId, { name: string; color: string; text: string }> = {
  dopamine: { name: 'Dopamine', color: '#f59f00', text: "Three main routes: nigrostriatal (substantia nigra to striatum, movement), mesolimbic (ventral tegmental area to nucleus accumbens, reward and motivation) and mesocortical (to prefrontal cortex, planning and attention). Loss of nigrostriatal neurons causes Parkinson's disease." },
  serotonin: { name: 'Serotonin', color: '#7048e8', text: 'Raphe nuclei in the brainstem send fibres to nearly the whole forebrain: thalamus, hippocampus, amygdala and cortex. It shapes mood, sleep and appetite, and many antidepressants act on it.' },
  norepinephrine: { name: 'Norepinephrine', color: '#e03131', text: 'The locus coeruleus in the pons projects very widely. It raises arousal and attention and drives part of the stress response; firing is high when awake and alert and nearly silent in REM sleep.' },
  acetylcholine: { name: 'Acetylcholine', color: '#1c7ed6', text: "The nucleus basalis feeds the neocortex and the medial septum feeds the hippocampus. It supports attention and memory, and these cholinergic neurons are lost early in Alzheimer's disease." },
  thalamocortical: { name: 'Thalamocortical loops (glutamate and GABA)', color: '#d6336c', text: 'The thalamus and cortex talk in loops. Excitatory (glutamate) fibres carry signals up and down, and the thalamic reticular nucleus applies inhibitory (GABA) control. These loops set the rhythm of the alpha wave and sleep spindles, and the synchronised activity of cortical pyramidal cells is what a scalp electrode picks up.' },
  hpa: { name: 'Stress axis (HPA, cortisol)', color: '#868e96', text: 'The hypothalamus signals the pituitary, which signals the adrenal glands (outside the brain) to release cortisol. Cortisol feeds back on the hippocampus, prefrontal cortex and hypothalamus through glucocorticoid receptors.' },
}
/** Which gene "system" labels belong to each drawn pathway. */
export const SYSTEM_GENE_KEYS: Record<SystemId, string[]> = {
  dopamine: ['dopamine', 'monoamines'], serotonin: ['serotonin', 'monoamines'], norepinephrine: ['norepinephrine', 'monoamines'],
  acetylcholine: ['acetylcholine'], thalamocortical: ['GABA', 'glutamate'], hpa: ['cortisol'],
}
/** Graph box that each drawn pathway stands for. */
export const GRAPH_SYSTEM_OF: Record<string, SystemId> = { dopamine: 'dopamine', serotonin: 'serotonin', norepinephrine: 'norepinephrine', acetylcholine: 'acetylcholine', GABA: 'thalamocortical', glutamate: 'thalamocortical', cortisol: 'hpa' }

export const SCENARIO_INFO: Record<ScenarioId, { name: string; text: string; systems: string[]; genes: string[]; typical: string }> = {
  healthy: { name: 'Healthy baseline', text: 'Typical resting pattern: alpha strongest at the back of the head, with smaller shares of delta, theta, beta and gamma.', systems: [], genes: [], typical: 'Alpha strongest at the back.' },
  stroke: { name: 'Stroke: left temporal lesion', text: 'A blocked or burst vessel damages a patch of tissue. EEG typically shows focal slowing (more delta and theta) and less fast activity over the damaged area, while distant areas look more normal. Fibres that pass through the lesion are interrupted. Brain imaging, not EEG, is what shows the lesion itself.', systems: ['glutamate (excitotoxicity after loss of blood flow)', 'acetylcholine and serotonin fibres crossing the area'], genes: [], typical: 'More delta and theta, less alpha and beta, over the lesion.' },
  tbi: { name: 'Traumatic brain injury (diffuse, frontal and temporal)', text: 'Frontal and temporal poles are bruised most often, and shearing can injure long fibres everywhere. EEG often shows more theta and delta, less alpha and a slower dominant rhythm, in proportion to severity. Dopamine, acetylcholine and norepinephrine systems are commonly affected.', systems: ['dopamine', 'acetylcholine', 'norepinephrine', 'serotonin'], genes: [], typical: 'More theta and delta everywhere, less alpha.' },
  occipital: { name: 'Occipital lesion', text: 'Damage at the back of the brain disrupts the visual pathway. EEG shows the normal posterior alpha rhythm reduced or lost over the damaged side, with slow delta activity there.', systems: ['thalamocortical loops (alpha rhythm)'], genes: [], typical: 'Posterior alpha reduced or lost, delta increased.' },
  alz: { name: "Alzheimer's-type pattern (illustrative)", text: "Cholinergic neurons of the basal forebrain are lost early, and the cortex thins in temporal and parietal areas. EEG typically shows slowing: more delta and theta, less alpha and beta, most clearly at the back. This pattern is not specific to Alzheimer's disease.", systems: ['acetylcholine', 'glutamate (NMDA receptors)'], genes: ['APP', 'PSEN1', 'APOE'], typical: 'More delta and theta, less alpha and beta, most at the back.' },
  epilepsy: { name: 'Epileptic focus (right frontal)', text: 'An irritable patch of cortex fires in bursts. EEG shows brief spikes and sharp waves at the focus, often followed by a slow wave, rather than a lasting change in band power. Weak GABA inhibition or excess glutamate excitation can lower the threshold.', systems: ['GABA', 'glutamate'], genes: ['SCN1A', 'GABRG2', 'GABRA1', 'GRIN2A'], typical: 'Brief spikes and sharp waves at the focus.' },
}

export interface Lesion { p: [number, number, number]; r: number; focus?: boolean }
export interface ScenarioGeom { lesions: Lesion[]; impair: Partial<Record<SystemId, number>>; atrophy: boolean }
/** Where the damage is drawn, and how much each pathway is weakened across the brain (1 = normal). */
export const SCENARIOS: Record<ScenarioId, ScenarioGeom> = {
  healthy: { lesions: [], impair: {}, atrophy: false },
  stroke: { lesions: [{ p: [-0.72, 0.02, -0.12], r: 0.24 }], impair: {}, atrophy: false },
  tbi: { lesions: [{ p: [0.35, 0.9, 0.05], r: 0.15 }, { p: [-0.6, 0.5, -0.2], r: 0.15 }, { p: [0.72, -0.1, -0.25], r: 0.13 }], impair: { dopamine: 0.6, acetylcholine: 0.55, norepinephrine: 0.7, serotonin: 0.8 }, atrophy: false },
  occipital: { lesions: [{ p: [0.3, -0.85, 0.12], r: 0.24 }], impair: {}, atrophy: false },
  alz: { lesions: [], impair: { acetylcholine: 0.35 }, atrophy: true },
  epilepsy: { lesions: [{ p: [0.45, 0.7, 0.3], r: 0.14, focus: true }], impair: {}, atrophy: false },
}

// ---- pathways in 3D (x right, y front, z up; midline structures have x = 0) -------------------------------------
export const NUC: Record<string, [number, number, number]> = {
  SN: [0.14, -0.30, -0.26], VTA: [0, -0.26, -0.30], striatum: [0.30, 0.22, 0.02], NAcc: [0.16, 0.48, -0.14], PFC: [0.34, 0.82, 0.18], raphe: [0, -0.44, -0.46], LC: [0.08, -0.52, -0.42],
  thalamus: [0.14, -0.06, 0], hipp: [0.50, -0.38, -0.22], amyg: [0.42, 0.10, -0.30], NB: [0.16, 0.30, -0.28], septum: [0, 0.30, -0.10], hyp: [0, 0.16, -0.30], pit: [0, 0.26, -0.44],
  FC: [0.45, 0.75, 0.35], PC: [0.45, -0.15, 0.58], OC: [0.35, -0.80, 0.18], TC: [0.78, 0, -0.15], RT: [0.26, -0.02, 0.12], adrenal: [0, 0.22, -0.92],
}
export const NUC_NAME: Record<string, string> = {
  SN: 'substantia nigra', VTA: 'ventral tegmental area', striatum: 'striatum', NAcc: 'nucleus accumbens', PFC: 'prefrontal cortex', raphe: 'raphe nuclei', LC: 'locus coeruleus', thalamus: 'thalamus', hipp: 'hippocampus',
  amyg: 'amygdala', NB: 'nucleus basalis', septum: 'medial septum', hyp: 'hypothalamus', pit: 'pituitary', FC: 'frontal cortex', PC: 'parietal cortex', OC: 'occipital cortex', TC: 'temporal cortex',
  RT: 'thalamic reticular nucleus', adrenal: 'adrenal glands (outside the brain)',
}
export const MIDLINE = new Set(['VTA', 'raphe', 'septum', 'hyp', 'pit', 'adrenal'])
export interface RouteDef { a: string; b: string; label?: string; color: string; soft?: boolean }
export const SYSTEM_ROUTES: Record<SystemId, { bidirectional?: boolean; routes: RouteDef[] }> = {
  dopamine: { routes: [{ a: 'SN', b: 'striatum', label: 'nigrostriatal (movement)', color: '#f59f00' }, { a: 'VTA', b: 'NAcc', label: 'mesolimbic (reward)', color: '#f59f00' }, { a: 'VTA', b: 'PFC', label: 'mesocortical (planning, attention)', color: '#f59f00' }] },
  serotonin: { routes: ['thalamus', 'hipp', 'amyg', 'FC', 'PC', 'OC', 'TC'].map((b) => ({ a: 'raphe', b, color: '#7048e8' })) },
  norepinephrine: { routes: ['thalamus', 'hipp', 'FC', 'PC', 'OC', 'TC'].map((b) => ({ a: 'LC', b, color: '#e03131' })) },
  acetylcholine: { routes: [{ a: 'NB', b: 'FC', label: 'basal forebrain to cortex (attention, memory)', color: '#1c7ed6' }, { a: 'NB', b: 'TC', color: '#1c7ed6' }, { a: 'NB', b: 'amyg', color: '#1c7ed6' }, { a: 'septum', b: 'hipp', label: 'septum to hippocampus (memory)', color: '#1c7ed6' }] },
  thalamocortical: { bidirectional: true, routes: [...['FC', 'PC', 'OC', 'TC'].map((b, i) => ({ a: 'thalamus', b, label: i === 0 ? 'glutamate loops' : undefined, color: '#d6336c' })), { a: 'RT', b: 'thalamus', label: 'GABA inhibition', color: '#2f9e44' }] },
  hpa: { routes: [{ a: 'hyp', b: 'pit', label: 'hypothalamus to pituitary', color: '#868e96' }, { a: 'pit', b: 'adrenal', label: 'pituitary to adrenal glands (cortisol)', color: '#868e96' }, { a: 'hipp', b: 'hyp', color: '#868e96', soft: true }, { a: 'PFC', b: 'hyp', color: '#868e96', soft: true }] },
}

/** Index of the first sampled point that lies inside a lesion (ignoring the first few, which sit in the source nucleus), or -1. */
export function firstCut(points: [number, number, number][], lesions: Lesion[], skip = 3): number {
  for (let i = skip; i < points.length; i++) for (const l of lesions) {
    const d = Math.hypot(points[i][0] - l.p[0], points[i][1] - l.p[1], points[i][2] - l.p[2])
    if (d < l.r) return i
  }
  return -1
}

// ---- links: [from, to, evidence, why] --------------------------------------------------------------------------
export type Edge = [string, string, Evidence, string]
const BASE_EDGES: Edge[] = [
  ['GABA', 'beta', 'established', 'Drugs that strengthen GABA-A receptors, such as benzodiazepines, increase beta power.'],
  ['glutamate', 'gamma', 'established', 'Blocking NMDA glutamate receptors (for example with ketamine) increases gamma power in human recordings.'],
  ['acetylcholine', 'theta', 'established', 'Loss of cholinergic input is linked to EEG slowing (more theta and delta); cholinergic drugs shift it back.'],
  ['acetylcholine', 'alpha', 'established', 'Cholinergic loss is linked to lower alpha power and a slower alpha frequency.'],
  ['norepinephrine', 'alpha', 'supported', 'Locus coeruleus arousal desynchronises the EEG: alpha falls as vigilance rises.'],
  ['norepinephrine', 'beta', 'supported', 'Arousal and noradrenergic drive go with more fast (beta) activity.'],
  ['serotonin', 'alpha', 'supported', '5-HT2A agonists such as psilocybin reduce alpha power in studies.'],
  ['dopamine', 'beta', 'supported', "Dopaminergic drugs and Parkinson's disease change beta activity; findings vary by recording site."],
  ['dopamine', 'theta', 'exploratory', 'Frontal theta has been linked to dopamine in some tasks; results are mixed.'],
  ['cortisol', 'alpha', 'exploratory', 'Stress hormones have been related to frontal alpha asymmetry; evidence is inconsistent.'],
  ['melatonin', 'delta', 'exploratory', 'Melatonin shifts sleep timing, which changes the share of slow-wave activity; the direct effect on EEG is modest.'],
  ['stroke', 'delta', 'established', 'Focal slowing over a stroke: more delta, and also theta, over the lesion.'],
  ['stroke', 'theta', 'established', 'Focal slowing over a stroke: more theta over the lesion.'],
  ['tbi', 'theta', 'established', 'After traumatic brain injury EEG often shows more theta and delta in proportion to severity.'],
  ['tbi', 'delta', 'established', 'Slow activity increases after traumatic brain injury.'],
  ['tbi', 'alpha', 'established', 'Alpha power and the dominant frequency fall after traumatic brain injury.'],
  ['alzheimer', 'delta', 'established', "Alzheimer's disease shows slowing: more delta and theta."],
  ['alzheimer', 'theta', 'established', "Alzheimer's disease shows slowing: more theta."],
  ['alzheimer', 'alpha', 'established', 'Alpha and beta power are reduced, mostly at the back of the head.'],
  ['epilepsy', 'spikes', 'established', 'Epilepsy is recognised on EEG by spikes, sharp waves and spike-and-wave bursts.'],
  ['stroke', 'glutamate', 'established', 'Loss of blood flow releases excess glutamate that injures neurons (excitotoxicity).'],
  ['tbi', 'glutamate', 'supported', 'Injury triggers a glutamate surge that adds to the damage.'],
  ['tbi', 'dopamine', 'supported', 'Dopamine signalling is commonly disturbed after traumatic brain injury.'],
  ['tbi', 'acetylcholine', 'supported', 'Cholinergic function is commonly reduced after traumatic brain injury.'],
  ['epilepsy', 'GABA', 'established', 'Weak GABA inhibition lowers the seizure threshold.'],
  ['epilepsy', 'glutamate', 'established', 'Excess glutamate excitation lowers the seizure threshold.'],
  ['alzheimer', 'acetylcholine', 'established', 'Early loss of basal forebrain cholinergic neurons; the main symptomatic drugs raise acetylcholine.'],
  ['alzheimer', 'glutamate', 'established', "NMDA glutamate receptors are a drug target (memantine) in Alzheimer's disease."],
  ['SCN1A', 'epilepsy', 'established', 'SCN1A variants cause Dravet syndrome and other epilepsies.'],
  ['GABRG2', 'epilepsy', 'established', 'GABRG2 variants cause genetic epilepsy syndromes.'],
  ['GABRA1', 'epilepsy', 'established', 'GABRA1 variants are linked to genetic epilepsies.'],
  ['GRIN2A', 'epilepsy', 'established', 'GRIN2A variants cause an epilepsy-aphasia spectrum disorder.'],
  ['APP', 'alzheimer', 'established', "APP variants cause early-onset familial Alzheimer's disease."],
  ['PSEN1', 'alzheimer', 'established', "PSEN1 variants are the commonest cause of early-onset familial Alzheimer's disease."],
  ['APOE', 'alzheimer', 'established', "The APOE e4 form raises the risk of late-onset Alzheimer's disease."],
]
export const GENE_SYSTEMS: Record<string, string[]> = { monoamines: ['dopamine', 'serotonin', 'norepinephrine'], dopamine: ['dopamine'], serotonin: ['serotonin'], norepinephrine: ['norepinephrine'], acetylcholine: ['acetylcholine'], GABA: ['GABA'], glutamate: ['glutamate'], cortisol: ['cortisol'], melatonin: ['melatonin'] }
const GENE_TIER: Record<string, Evidence> = { FKBP5: 'supported', BDNF: 'exploratory' }

export function buildEdges(genes = GENE_COUNTS): Edge[] {
  const edges = [...BASE_EDGES]
  for (const [g, c] of Object.entries(genes)) {
    if (c.system === 'plasticity') edges.push([g, 'glutamate', 'exploratory', 'BDNF supports synapse growth and plasticity; its link to any one chemical system is indirect.'])
    for (const s of GENE_SYSTEMS[c.system] ?? []) edges.push([g, s, GENE_TIER[g] ?? 'established', c.role.charAt(0).toUpperCase() + c.role.slice(1) + '.'])
  }
  return edges
}
export const EDGES = buildEdges()

export const NODE_LABEL: Record<string, string> = {
  dopamine: 'Dopamine', serotonin: 'Serotonin', norepinephrine: 'Norepinephrine', acetylcholine: 'Acetylcholine', GABA: 'GABA', glutamate: 'Glutamate', cortisol: 'Cortisol (stress axis)', melatonin: 'Melatonin',
  delta: 'Delta 1–4 Hz', theta: 'Theta 4–8 Hz', alpha: 'Alpha 8–13 Hz', beta: 'Beta 13–30 Hz', gamma: 'Gamma 30–45 Hz', spikes: 'Spikes / spike-wave',
  stroke: 'Stroke', tbi: 'Brain injury', epilepsy: 'Epilepsy', alzheimer: "Alzheimer's disease",
}
export const BAND_TEXT: Record<string, string> = {
  delta: 'Slow waves, dominant in deep sleep. In an awake adult, focal or diffuse delta suggests dysfunction.',
  theta: 'Drowsiness and memory tasks. Excess theta in an awake adult can point to slowing from injury or disease.',
  alpha: 'The relaxed, eyes-closed rhythm, strongest at the back of the head and produced by thalamocortical loops.',
  beta: 'Alert, active thinking and motor planning; increased by sedatives such as benzodiazepines.',
  gamma: 'Fast activity linked to local processing; also picks up muscle noise, so it is hard to read at the scalp.',
  spikes: 'Brief sharp transients. Recognised by their shape, not by a band power.',
}
export const TIER_TEXT: Record<Evidence, string> = {
  established: 'Established: standard textbook or well replicated',
  supported: 'Supported: reported repeatedly, but mixed or context dependent',
  exploratory: 'Exploratory: suggestive, not settled',
}

// ---- layout of the connection map ------------------------------------------------------------------------------
export const GENE_IDS = Object.keys(GENE_COUNTS)
export const SYSTEM_NODE_IDS = ['dopamine', 'serotonin', 'norepinephrine', 'acetylcholine', 'GABA', 'glutamate', 'cortisol', 'melatonin']
export const EEG_IDS = ['delta', 'theta', 'alpha', 'beta', 'gamma', 'spikes']
export const COND_IDS = ['stroke', 'tbi', 'epilepsy', 'alzheimer']
export const MAP_HEIGHT = 640
const TOP = 52
export interface MapNode { id: string; kind: NodeKind; x: number; y: number; label: string }
export const MAP_COLUMNS: { ids: string[]; x: number; kind: NodeKind; title: string }[] = [
  { ids: GENE_IDS, x: 84, kind: 'gene', title: 'DNA: genes' }, { ids: SYSTEM_NODE_IDS, x: 330, kind: 'system', title: 'Chemical systems' },
  { ids: EEG_IDS, x: 585, kind: 'eeg', title: 'EEG pattern' }, { ids: COND_IDS, x: 810, kind: 'cond', title: 'Damage and disease' },
]
export function mapNodes(): Record<string, MapNode> {
  const out: Record<string, MapNode> = {}
  for (const col of MAP_COLUMNS) {
    const gap = (MAP_HEIGHT - TOP - 24) / col.ids.length
    col.ids.forEach((id, i) => { out[id] = { id, kind: col.kind, x: col.x, y: TOP + gap * (i + 0.5), label: NODE_LABEL[id] ?? id } })
  }
  return out
}
const COLUMN_OF: Record<NodeKind, number> = { gene: 0, system: 1, eeg: 2, cond: 3 }
export function edgePath(nodes: Record<string, MapNode>, a: string, b: string): string {
  const A = nodes[a], B = nodes[b]; if (!A || !B) return ''
  const [L, R] = COLUMN_OF[A.kind] <= COLUMN_OF[B.kind] ? [A, B] : [B, A]
  const span = Math.abs(R.x - L.x), jump = Math.abs(COLUMN_OF[A.kind] - COLUMN_OF[B.kind]) > 1
  const lift = jump ? -70 - Math.abs(R.y - L.y) * 0.12 : 0
  const x1 = L.x + 38, x2 = R.x - 38, c = Math.min(span * 0.4, 120)
  return `M${x1},${L.y} C${x1 + c},${L.y + lift} ${x2 - c},${R.y + lift} ${x2},${R.y}`
}
export const connectedEdges = (edges: Edge[], id: string) => edges.filter((e) => e[0] === id || e[1] === id)
