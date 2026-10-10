// Textbook knowledge linking the brain to the rest of the body, for the Brain Network page. Pure data and small functions.
//
// Same rules as neuro.ts: every link carries an evidence level, and this is education and research context, not medical
// advice. The body is a schematic drawn NOT TO SCALE; organ positions are only meant to be recognisable.
// Axes match the brain view: x right (negative = the person's left), y front, z up. The neck joins the brain stem near z = -1.

import type { Evidence, ScenarioId, SystemId } from './neuro.ts'
import { GENE_COUNTS } from './neuro-genes.ts'
import { LAYOUT, sceneOf } from './anatomy.ts'

export type OrganId =
  | 'eyes' | 'lungs' | 'heart' | 'diaphragm' | 'esophagus' | 'liver' | 'gallbladder' | 'stomach' | 'pancreas' | 'spleen' | 'adrenals' | 'kidneys' | 'gut' | 'bladder' | 'muscle' | 'spinalcord'

export interface OrganInfo {
  name: string
  /** where it sits in the schematic (the left/right pair, where there is one, is mirrored on x) */
  pos: [number, number, number]
  color: string
  /** what it is, in one or two plain sentences */
  text: string
}

const at = (c: readonly [number, number, number]): [number, number, number] => sceneOf(c[0], c[1], c[2])
export const ORGANS: Record<OrganId, OrganInfo> = {
  eyes: { name: 'Eyes and visual pathway', pos: [0.36, 1.12, 0.2], color: '#4dabf7', text: 'The retinas send signals through the optic nerves and chiasm to the thalamus (lateral geniculate) and on to the occipital cortex at the back of the brain.' },
  lungs: { name: 'Lungs', pos: at(LAYOUT.rightLung.c), color: '#f783ac', text: 'Three lobes on the right and two on the left (the left has a notch for the heart). Breathing rhythm is set in the brain stem; the brain also adjusts airway width and responds to carbon dioxide.' },
  heart: { name: 'Heart', pos: at(LAYOUT.heart.c), color: '#e03131', text: 'Four chambers behind the breastbone, tilted so the apex points left. The sinoatrial node starts each beat; the vagus nerve slows it and sympathetic nerves from T1-T4 speed it up.' },
  diaphragm: { name: 'Diaphragm', pos: at([0, 0, -20]), color: '#d6336c', text: 'The dome-shaped breathing muscle under the lungs. The phrenic nerve (C3-C5) drives it; the oesophagus, aorta and vena cava pass through it at T10, T12 and T8.' },
  esophagus: { name: 'Oesophagus', pos: at([-0.5, -3.4, -12]), color: '#c9706e', text: 'The swallowing tube behind the windpipe. The vagus nerve and brain stem coordinate each swallow.' },
  liver: { name: 'Liver', pos: at(LAYOUT.liver.c), color: '#a0522d', text: 'Fills the right upper abdomen under the diaphragm. Releases glucose under stress hormones and breaks down many chemicals, including brain monoamines and drugs.' },
  gallbladder: { name: 'Gallbladder', pos: at(LAYOUT.gallbladder.c), color: '#4f8f45', text: 'Stores bile under the liver; vagal and hormone signals make it contract after a meal.' },
  stomach: { name: 'Stomach', pos: at(LAYOUT.stomach.c), color: '#fd7e14', text: 'A J-shaped bag from the oesophagus (T10-T11) to the pylorus at L1. Controlled by the vagus nerve and its own enteric nerves; stress and emotion change acid release and emptying.' },
  pancreas: { name: 'Pancreas', pos: at(LAYOUT.pancreas.c), color: '#e6c47c', text: 'Lies behind the stomach at L1-L2, head in the curve of the duodenum, tail at the spleen. Vagal and sympathetic nerves tune its enzyme and insulin release.' },
  spleen: { name: 'Spleen and immune system', pos: at(LAYOUT.spleen.c), color: '#7048e8', text: 'Behind the left 9th-11th ribs. Immune cells here respond to nerve signals and to the stress hormone cortisol.' },
  adrenals: { name: 'Adrenal glands', pos: at(LAYOUT.rightAdrenal.c), color: '#fab005', text: 'Caps on top of each kidney. They make cortisol (cortex) and adrenaline and norepinephrine (medulla) when the brain signals stress through the pituitary and sympathetic nerves.' },
  kidneys: { name: 'Kidneys', pos: at(LAYOUT.rightKidney.c), color: '#c2255c', text: 'T12-L3 on the back wall of the abdomen, the right a little lower. Blood pressure and fluid balance are tuned by brain signals (sympathetic nerves and the hormone vasopressin). Ureters carry urine down to the bladder.' },
  gut: { name: 'Gut (small and large intestine)', pos: at([0, 3, -40]), color: '#94d82d', text: 'A "second brain" of about 500 million neurons. Around 90% of the body\'s serotonin is made here, and the gut talks to the brain through the vagus nerve (to the splenic flexure) and sacral nerves (beyond).' },
  bladder: { name: 'Bladder', pos: at(LAYOUT.bladder.c), color: '#15aabf', text: 'Sits in the pelvis behind the pubic bone. Storing and emptying are coordinated by the pons and cortex through the spinal cord (sacral S2-S4).' },
  muscle: { name: 'Skeletal muscle (arms and legs)', pos: at([22, 0, -30]), color: '#ff6b6b', text: 'Motor cortex and basal ganglia (dopamine) command muscle through the corticospinal tract and cord; acetylcholine is the signal at the nerve-muscle junction.' },
  spinalcord: { name: 'Spinal cord and nerves', pos: at([0, -8.6, -12]), color: '#f1e7c8', text: 'About 45 cm long, ending at L1-L2, with 31 pairs of nerves. The cervical enlargement (C4-T1) serves the arms and the lumbar enlargement the legs. Every brain-to-body signal except the vagus passes through it.' },
}
export const ORGAN_IDS = Object.keys(ORGANS) as OrganId[]
/** Organs drawn as a left/right pair. */
export const PAIRED: ReadonlySet<OrganId> = new Set<OrganId>(['eyes', 'lungs', 'adrenals', 'kidneys'])

// ---- how the brain reaches the body -----------------------------------------------------------------------------
export type RouteId = 'vagus' | 'sympathetic' | 'hpa' | 'motor' | 'enteric' | 'visual' | 'phrenic'
export interface BodyRoute { name: string; color: string; from: string; text: string; organs: OrganId[]; evidence: Evidence }
export const BODY_ROUTES: Record<RouteId, BodyRoute> = {
  vagus: { name: 'Vagus nerve (parasympathetic)', color: '#2f9e44', from: 'brain stem', evidence: 'established', organs: ['heart', 'lungs', 'esophagus', 'stomach', 'gallbladder', 'pancreas', 'gut', 'liver', 'spleen'],
    text: 'The longest cranial nerve runs from the brain stem to the chest and abdomen. It slows the heart, drives digestion and carries gut signals back to the brain.' },
  sympathetic: { name: 'Sympathetic nerves (fight or flight)', color: '#e03131', from: 'locus coeruleus, hypothalamus, spinal cord', evidence: 'established', organs: ['heart', 'lungs', 'stomach', 'pancreas', 'liver', 'adrenals', 'kidneys', 'gut', 'bladder', 'spleen', 'spinalcord'],
    text: 'Norepinephrine-driven signals leave through the spinal cord to raise heart rate and blood pressure, widen airways and slow digestion.' },
  hpa: { name: 'Stress hormone axis (HPA)', color: '#868e96', from: 'hypothalamus and pituitary', evidence: 'established', organs: ['adrenals', 'liver', 'heart', 'gut', 'spleen', 'kidneys', 'pancreas'],
    text: 'The hypothalamus signals the pituitary, which signals the adrenal glands to release cortisol into the blood, so the effect reaches nearly every organ.' },
  motor: { name: 'Motor pathway (spinal cord)', color: '#1c7ed6', from: 'motor cortex and basal ganglia', evidence: 'established', organs: ['muscle', 'bladder', 'spinalcord'],
    text: 'Motor cortex fibres cross to the opposite side, run down the spinal cord and reach muscle at the nerve-muscle junction using acetylcholine.' },
  enteric: { name: 'Gut-brain axis (serotonin)', color: '#7048e8', from: 'gut and raphe nuclei', evidence: 'supported', organs: ['gut', 'stomach'],
    text: 'Gut serotonin and brain serotonin are made separately but talk through the vagus nerve and the blood. Gut-brain links to mood are an active research area.' },
  phrenic: { name: 'Phrenic nerves (C3-C5)', color: '#ffe08a', from: 'brain stem breathing centres', evidence: 'established', organs: ['diaphragm', 'lungs', 'spinalcord'],
    text: 'The breathing centres in the brain stem send signals down the cord to C3-C5, where the phrenic nerves leave to drive the diaphragm. A cord injury above C3 cuts this link.' },
  visual: { name: 'Visual pathway', color: '#4dabf7', from: 'occipital cortex', evidence: 'established', organs: ['eyes'],
    text: 'Retina to thalamus to occipital cortex. Damage at the back of the brain removes part of what the eyes can report.' },
}
export const ROUTE_IDS = Object.keys(BODY_ROUTES) as RouteId[]

// ---- what each scenario does to the body ------------------------------------------------------------------------
export interface BodyEffect { organ: OrganId; evidence: Evidence; level: number; text: string }
export const SCENARIO_BODY: Record<ScenarioId, BodyEffect[]> = {
  healthy: [],
  stroke: [
    { organ: 'muscle', evidence: 'established', level: 0.7, text: 'If the damage reaches motor pathways, weakness or paralysis appears on the opposite side of the body. A purely temporal lesion mostly affects language and hearing instead.' },
    { organ: 'stomach', evidence: 'established', level: 0.5, text: 'Swallowing is often impaired (dysphagia), which raises the risk of choking and chest infection.' },
    { organ: 'heart', evidence: 'supported', level: 0.5, text: 'Stroke can disturb heart rhythm and raise heart-muscle injury markers ("stroke-heart syndrome"), most clearly with damage near the insula.' },
    { organ: 'lungs', evidence: 'supported', level: 0.4, text: 'Chest infection (aspiration pneumonia) is a common complication after stroke.' },
    { organ: 'bladder', evidence: 'supported', level: 0.4, text: 'Bladder control is often lost in the first days after a stroke.' },
    { organ: 'esophagus', evidence: 'established', level: 0.5, text: 'The swallow is slowed or mistimed, so food and saliva can slip toward the airway.' },
    { organ: 'spinalcord', evidence: 'established', level: 0.5, text: 'The motor tract below the damage slowly degenerates (Wallerian degeneration) and the reflexes below it become brisk, which is why weakness turns into stiffness (spasticity).' },
  ],
  tbi: [
    { organ: 'heart', evidence: 'supported', level: 0.7, text: 'Severe injury can cause surges of sympathetic activity: fast heart rate and high blood pressure ("paroxysmal sympathetic hyperactivity").' },
    { organ: 'lungs', evidence: 'supported', level: 0.5, text: 'Breathing rate and rhythm can change, and breathing in is harder when injury is deep in the brain.' },
    { organ: 'adrenals', evidence: 'established', level: 0.6, text: 'The pituitary-adrenal axis is disturbed: cortisol can be too high early and too low later if the pituitary is damaged.' },
    { organ: 'muscle', evidence: 'established', level: 0.6, text: 'Weakness, stiffness (spasticity) and loss of coordination, depending on which pathways are injured.' },
    { organ: 'gut', evidence: 'supported', level: 0.4, text: 'Digestion slows and stress ulcers are more likely in the first days after severe injury.' },
    { organ: 'kidneys', evidence: 'supported', level: 0.4, text: 'Water and salt balance can swing (for example diabetes insipidus or salt wasting) when the hypothalamus or pituitary is hurt.' },
    { organ: 'spinalcord', evidence: 'supported', level: 0.4, text: 'Diffuse axonal injury can include long tracts running from the brain stem into the cord, so motor and autonomic signals arrive weakened or out of step.' },
    { organ: 'esophagus', evidence: 'supported', level: 0.4, text: 'Swallowing coordination is often impaired after moderate to severe injury.' },
    { organ: 'stomach', evidence: 'supported', level: 0.4, text: 'Emptying slows in the first days.' },
  ],
  occipital: [
    { organ: 'eyes', evidence: 'established', level: 0.9, text: 'The eyes themselves are healthy, but part of the visual field is lost on the side opposite the damage (homonymous hemianopia).' },
  ],
  alz: [
    { organ: 'stomach', evidence: 'supported', level: 0.4, text: 'Swallowing difficulty and weight loss are common as the disease advances.' },
    { organ: 'gut', evidence: 'supported', level: 0.3, text: 'Constipation and bowel control problems become more common in later stages.' },
    { organ: 'bladder', evidence: 'supported', level: 0.4, text: 'Bladder control is lost in later stages.' },
    { organ: 'muscle', evidence: 'supported', level: 0.4, text: 'Movement slows and walking becomes less steady in later stages.' },
    { organ: 'heart', evidence: 'exploratory', level: 0.25, text: 'Autonomic (heart-rate and blood-pressure) control may change; findings vary.' },
    { organ: 'esophagus', evidence: 'supported', level: 0.35, text: 'The swallow becomes slower and less coordinated as the disease advances.' },
  ],
  epilepsy: [
    { organ: 'muscle', evidence: 'established', level: 0.8, text: 'In a generalised convulsive seizure muscles stiffen and jerk. Focal seizures can affect one limb or one side.' },
    { organ: 'heart', evidence: 'supported', level: 0.6, text: 'Heart rate usually rises during a seizure and can sometimes slow or stop. Heart-rhythm changes are a leading suspect in sudden unexpected death in epilepsy (SUDEP).' },
    { organ: 'lungs', evidence: 'supported', level: 0.6, text: 'Breathing can pause (apnea) during or after a seizure.' },
    { organ: 'stomach', evidence: 'exploratory', level: 0.2, text: 'Nausea or a rising feeling in the stomach can start some temporal-lobe seizures.' },
    { organ: 'bladder', evidence: 'established', level: 0.4, text: 'Bladder control can be lost during a convulsive seizure.' },
    { organ: 'diaphragm', evidence: 'supported', level: 0.6, text: 'During the tonic phase the breathing muscle is overridden by the convulsion, so breathing stops until the seizure ends.' },
    { organ: 'spinalcord', evidence: 'established', level: 0.8, text: 'The cord carries the seizure\'s motor drive down to the muscles on both sides, and afterwards its signals are briefly reduced.' },
  ],
}

// ---- what each chemical pathway does in the body ----------------------------------------------------------------
export interface SystemBody { organ: OrganId; evidence: Evidence; text: string }
export const SYSTEM_BODY: Record<SystemId, SystemBody[]> = {
  dopamine: [
    { organ: 'muscle', evidence: 'established', text: 'The nigrostriatal route controls movement; losing it causes the tremor and slowness of Parkinson\'s disease.' },
    { organ: 'gut', evidence: 'established', text: 'Dopamine slows gut movement, and constipation is an early sign of Parkinson\'s disease.' },
    { organ: 'kidneys', evidence: 'supported', text: 'Dopamine made in the kidney itself helps the body excrete salt.' },
  ],
  serotonin: [
    { organ: 'gut', evidence: 'established', text: 'Most of the body\'s serotonin sits in the gut, where it drives movement and digestion.' },
    { organ: 'lungs', evidence: 'established', text: 'The lung lining clears serotonin from the blood before it can act elsewhere.' },
    { organ: 'heart', evidence: 'supported', text: 'Serotonin acts on blood vessels and the heart; antidepressants that raise it can slightly change heart rate.' },
  ],
  norepinephrine: [
    { organ: 'heart', evidence: 'established', text: 'Speeds the heart and strengthens each beat.' },
    { organ: 'lungs', evidence: 'established', text: 'Opens the airways so more air can reach the lungs.' },
    { organ: 'adrenals', evidence: 'established', text: 'The adrenal medulla releases norepinephrine and adrenaline into the blood.' },
    { organ: 'kidneys', evidence: 'established', text: 'Raises renin release, which raises blood pressure.' },
    { organ: 'pancreas', evidence: 'supported', text: 'Dampens insulin release, which helps raise blood sugar during stress.' },
    { organ: 'spinalcord', evidence: 'established', text: 'Locus coeruleus fibres run down the cord and tune both pain signals and motor neurons.' },
    { organ: 'gut', evidence: 'established', text: 'Slows digestion during stress.' },
  ],
  acetylcholine: [
    { organ: 'muscle', evidence: 'established', text: 'The signal that makes skeletal muscle contract, at the nerve-muscle junction.' },
    { organ: 'heart', evidence: 'established', text: 'Vagal acetylcholine slows the heart.' },
    { organ: 'gut', evidence: 'established', text: 'Drives gut movement and secretions through the vagus and enteric nerves.' },
    { organ: 'diaphragm', evidence: 'established', text: 'Acetylcholine is the chemical signal from the phrenic nerve to the breathing muscle.' },
    { organ: 'esophagus', evidence: 'established', text: 'Vagal acetylcholine drives each swallowing wave down the oesophagus.' },
    { organ: 'stomach', evidence: 'established', text: 'Vagal acetylcholine drives acid release and stomach contractions.' },
    { organ: 'pancreas', evidence: 'supported', text: 'Vagal acetylcholine tells the pancreas to release enzymes and insulin when food is expected.' },
    { organ: 'spleen', evidence: 'supported', text: 'Vagus signals can dampen inflammation through the spleen (the "cholinergic anti-inflammatory pathway", well shown in animals, still being tested in people).' },
  ],
  thalamocortical: [
    { organ: 'muscle', evidence: 'established', text: 'Runaway glutamate firing, with too little GABA inhibition, is what drives convulsive seizures.' },
    { organ: 'spinalcord', evidence: 'established', text: 'Glutamate carries the motor drive down the corticospinal tract; GABA interneurons in the cord keep reflexes in check.' },
  ],
  hpa: [
    { organ: 'adrenals', evidence: 'established', text: 'Release cortisol when the pituitary signals them.' },
    { organ: 'liver', evidence: 'established', text: 'Cortisol raises blood sugar by telling the liver to release glucose.' },
    { organ: 'heart', evidence: 'supported', text: 'Long-term high cortisol is linked to higher blood pressure and heart risk.' },
    { organ: 'spleen', evidence: 'established', text: 'Cortisol restrains immune cells; long-term stress changes immune responses.' },
    { organ: 'gut', evidence: 'supported', text: 'Stress hormones change gut movement, sensitivity and the gut lining.' },
  ],
}

// ---- genes: where in the body they act --------------------------------------------------------------------------
export interface GeneBody { organs: OrganId[]; evidence: Evidence; text: string }
/** Only genes from neuro-genes.ts. A gene missing here is mostly brain-specific and shows no body link. */
export const GENE_BODY: Record<string, GeneBody> = {
  SLC6A4: { organs: ['gut', 'lungs'], evidence: 'established', text: 'The serotonin transporter also works outside the brain: in the gut lining and in the lung lining, where it clears serotonin from the blood.' },
  HTR2A: { organs: ['gut', 'heart'], evidence: 'supported', text: 'The 5-HT2A receptor is also found on blood vessels, platelets and gut muscle.' },
  MAOA: { organs: ['liver', 'gut'], evidence: 'established', text: 'The enzyme breaks down monoamines (serotonin, norepinephrine, dopamine) in the gut wall and liver, before they reach the blood.' },
  COMT: { organs: ['liver', 'kidneys'], evidence: 'established', text: 'The enzyme is most active in liver and kidney, where it clears dopamine, norepinephrine and adrenaline.' },
  TH: { organs: ['adrenals', 'heart'], evidence: 'established', text: 'Makes dopamine and then norepinephrine and adrenaline in the adrenal medulla and in sympathetic nerves.' },
  DDC: { organs: ['adrenals', 'kidneys', 'gut'], evidence: 'established', text: 'Makes dopamine and serotonin, including in the kidney and gut.' },
  DBH: { organs: ['adrenals', 'heart'], evidence: 'established', text: 'Turns dopamine into norepinephrine in the adrenal medulla and in sympathetic nerves.' },
  SLC6A2: { organs: ['heart', 'adrenals'], evidence: 'established', text: 'The norepinephrine transporter clears norepinephrine at sympathetic nerve endings in the heart and in the adrenal gland.' },
  DRD2: { organs: ['gut'], evidence: 'established', text: 'Dopamine D2 receptors slow gut movement; drugs that block them (such as metoclopramide) speed it up.' },
  CHAT: { organs: ['muscle', 'gut'], evidence: 'established', text: 'Makes acetylcholine for motor nerves reaching muscle and for enteric nerves in the gut.' },
  CHRNA7: { organs: ['spleen', 'lungs'], evidence: 'supported', text: 'The nicotinic receptor on immune cells links the vagus nerve to inflammation control.' },
  NR3C1: { organs: ['adrenals', 'liver', 'heart', 'gut', 'spleen', 'muscle'], evidence: 'established', text: 'The glucocorticoid receptor is present in almost every tissue, so cortisol reaches the whole body.' },
  FKBP5: { organs: ['adrenals', 'liver', 'spleen'], evidence: 'supported', text: 'Tunes how strongly cells respond to cortisol, so it shapes the stress response beyond the brain.' },
  SCN1A: { organs: ['heart'], evidence: 'supported', text: 'Also active in heart muscle; heart-rhythm effects are being studied as a link to SUDEP in Dravet syndrome.' },
  BDNF: { organs: ['muscle'], evidence: 'supported', text: 'Exercise raises BDNF made by muscle as well as by the brain.' },
  APOE: { organs: ['liver', 'heart'], evidence: 'established', text: 'Mostly made by the liver, which carries fats in the blood; the e4 form also raises heart-disease risk.' },
}

// ---- helpers ----------------------------------------------------------------------------------------------------
export interface OrganState { level: number; evidence: Evidence | null; reasons: { source: 'scenario' | 'pathway'; text: string; evidence: Evidence }[] }

/** How strongly each organ should be highlighted for the chosen pathway and scenario (0 = not involved). */
export function organStates(system: SystemId | 'none', scenario: ScenarioId): Record<OrganId, OrganState> {
  const out = {} as Record<OrganId, OrganState>
  for (const id of ORGAN_IDS) out[id] = { level: 0, evidence: null, reasons: [] }
  const rank: Record<Evidence, number> = { established: 3, supported: 2, exploratory: 1 }
  const bump = (id: OrganId, level: number, ev: Evidence) => {
    const s = out[id]
    s.level = Math.max(s.level, level)
    if (!s.evidence || rank[ev] > rank[s.evidence]) s.evidence = ev
  }
  for (const e of SCENARIO_BODY[scenario]) { bump(e.organ, e.level, e.evidence); out[e.organ].reasons.push({ source: 'scenario', text: e.text, evidence: e.evidence }) }
  if (system !== 'none') for (const e of SYSTEM_BODY[system]) { bump(e.organ, 0.45, e.evidence); out[e.organ].reasons.push({ source: 'pathway', text: e.text, evidence: e.evidence }) }
  return out
}

/** Routes that reach an organ. */
export const routesTo = (organ: OrganId): RouteId[] => ROUTE_IDS.filter((r) => BODY_ROUTES[r].organs.includes(organ))

/** Genes (from the ClinVar list) that act in an organ. */
export const genesIn = (organ: OrganId): string[] => Object.keys(GENE_BODY).filter((g) => g in GENE_COUNTS && GENE_BODY[g].organs.includes(organ))

/** The point in the brain where a route leaves for the body (the brain stem, or the hypothalamus for hormones). */
export const BRAIN_EXIT: Record<RouteId, [number, number, number]> = {
  phrenic: [0, -0.42, -0.9], vagus: [0, -0.45, -0.95], sympathetic: [0.08, -0.52, -0.55], hpa: [0, 0.26, -0.44], motor: [0.3, 0.0, 0.7], enteric: [0, -0.44, -0.46], visual: [0.35, -0.8, 0.18],
}
