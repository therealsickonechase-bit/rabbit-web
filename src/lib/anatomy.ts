// Anatomical layout for the detailed body in the Brain Network view. Pure numbers and small functions (no THREE), tested.
//
// Frame: centimetres, origin at the jugular notch (top of the breastbone, about the T2/T3 level).
// x = the person's right (negative = left), y = front (negative = back), z = up (negative = below the notch).
// The scene draws 1 unit = 15 cm and puts the notch at scene z = -1.5, just below the brain stem (see sceneOf).
// The brain is drawn about twice life size next to the body so its detail stays readable: the picture is NOT to scale
// between brain and body, but the body is proportioned to itself.
//
// Sources (checked 2026-10-10): standard vertebral-level teaching (transpyloric plane at L1; heart T5-T8 with the apex 8-9 cm
// left of the midline at the 5th intercostal space; diaphragm openings caval T8, oesophageal T10, aortic T12; kidneys T12-L3 with the
// right lower; spinal cord about 45 cm ending at L1-L2; cervical enlargement C4-T1; sympathetic outflow T1-L2; vagus to the
// splenic flexure; phrenic nerve C3-C5). Positions are typical adult values and vary between people.

import type { Evidence } from './neuro.ts'

export const CM_PER_UNIT = 15
export const NOTCH_Z = -1.5
export type Vec = [number, number, number]
/** Body centimetres to scene units. */
export const sceneOf = (x: number, y: number, z: number): Vec => [x / CM_PER_UNIT, y / CM_PER_UNIT, NOTCH_Z + z / CM_PER_UNIT]
export const sceneZ = (zcm: number) => NOTCH_Z + zcm / CM_PER_UNIT

// ---- the spine ---------------------------------------------------------------------------------------------------
/** Height of each vertebral body centre below the jugular notch, in cm (positive = above it). */
const VERT: Record<string, number> = {}
;(() => {
  // cervical C1..C7 from +11.5 down to +2.5; thoracic T1..T12 from +1 to -25.5 (about 2.45 cm each with its disc); lumbar L1..L5 -29 to -43
  const add = (name: string, n: number, top: number, step: number) => { for (let i = 1; i <= n; i++) VERT[`${name}${i}`] = top - step * (i - 1) }
  add('C', 7, 11.5, 1.5)
  add('T', 12, 1.0, 2.5)
  add('L', 5, -29.5, 3.4)
  VERT.S1 = -45; VERT.S5 = -54; VERT.Coccyx = -57
})()
export const vertZ = (level: string): number => {
  const z = VERT[level]
  if (z === undefined) throw new Error(`unknown vertebral level ${level}`)
  return z
}
export const VERTEBRAE = [...Array.from({ length: 7 }, (_, i) => `C${i + 1}`), ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `L${i + 1}`)]

/** Front-to-back position (cm) of the middle of the vertebral bodies at a height: neck lordosis, chest kyphosis, lumbar lordosis.
 *  The spinal canal sits CANAL_BEHIND cm behind that line. */
export function spineY(z: number): number {
  const pts: [number, number][] = [[14, -1], [8, -3.8], [0, -6], [-10, -7], [-20, -7], [-28, -5.5], [-36, -2.8], [-42, -3.6], [-50, -7], [-58, -9]]
  return interp(pts, z)
}
export const CANAL_BEHIND = 2.6

function interp(table: [number, number][], z: number): number {
  if (z >= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (z >= table[i][0]) { const [z0, v0] = table[i - 1], [z1, v1] = table[i]; return v0 + ((z - z0) / (z1 - z0)) * (v1 - v0) }
  }
  return table[table.length - 1][1]
}

// ---- the trunk outline -------------------------------------------------------------------------------------------
/** Half-width (cm, left-right) of the skin outline of the trunk at a height below the notch. */
export const trunkHalfWidth = (z: number) => interp([[3, 5.5], [0, 9], [-3, 17], [-6, 19.5], [-14, 17], [-26, 15.6], [-34, 14.6], [-44, 16], [-50, 17.2], [-56, 13], [-60, 6]], z)
/** Half-depth (cm, front-back) of the trunk outline. */
export const trunkHalfDepth = (z: number) => interp([[3, 5.5], [0, 7], [-6, 10], [-14, 11.4], [-26, 10.4], [-34, 10.6], [-46, 11.4], [-56, 10], [-60, 6]], z)
/** Ribcage inner half-width and half-depth at a height. */
export const ribHalfWidth = (z: number) => interp([[1, 5], [-3, 10.5], [-8, 13.2], [-16, 14.4], [-24, 14.6], [-30, 13.5]], z)
export const ribHalfDepth = (z: number) => interp([[1, 4.2], [-3, 6.8], [-8, 8.8], [-16, 9.8], [-24, 9.4], [-30, 8.6]], z)

// ---- ribs and sternum --------------------------------------------------------------------------------------------
export interface RibSpec { n: number; zBack: number; drop: number; cartilage: number; attaches: 'sternum' | 'margin' | 'free' }
/** Twelve rib pairs: height where each meets its vertebra, how far it slopes down toward the front, and how much of its front end is cartilage. */
export const RIBS: RibSpec[] = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1
  return { n, zBack: vertZ(`T${n}`) + 0.5, drop: [2.5, 4.5, 6, 7.5, 9, 10.5, 11.5, 12, 11.5, 10, 6, 3][i], cartilage: n <= 7 ? 0.28 : n <= 10 ? 0.34 : 0.1, attaches: n <= 7 ? 'sternum' : n <= 10 ? 'margin' : 'free' }
})
export const STERNUM = { top: 0, bottom: -17, halfWidth: 1.9 }

// ---- organs: centre, size (full dimensions) and notes -----------------------------------------------------------
export interface Placement { c: Vec; size: Vec; note: string }
export const LAYOUT = {
  heart: { c: [-2.2, 1.6, -10.5], size: [8.5, 6.5, 12], note: 'T5-T8, behind the sternum, two thirds to the left, apex at the 5th intercostal space 8-9 cm left of the midline' },
  rightLung: { c: [9, -1.5, -10], size: [11, 16, 26], note: 'apex above the first rib, base on the diaphragm at the 6th rib (front) to the 10th rib (back); three lobes' },
  leftLung: { c: [-9, -1.5, -10], size: [11, 16, 26], note: 'two lobes; cardiac notch and lingula where it wraps the heart' },
  liver: { c: [4, 1.5, -22], size: [22, 15, 14], note: 'right upper abdomen under the diaphragm, from the 5th rib down to the costal margin, left lobe crosses the midline' },
  gallbladder: { c: [8, 4, -29], size: [3.2, 3.2, 8], note: 'under the liver where the 9th costal cartilage meets the right edge of the rectus, on the transpyloric plane' },
  stomach: { c: [-4, 3, -26], size: [12, 8, 20], note: 'cardia T10-T11, fundus under the left dome, pylorus 2.5 cm right of the midline at L1' },
  spleen: { c: [-12, -4.5, -24.5], size: [4, 7, 12], note: 'behind the 9th-11th ribs on the left, lower border near L1' },
  pancreas: { c: [-1, -2, -31], size: [15, 3, 5], note: 'L1-L2 behind the stomach, head in the duodenal loop, tail at the spleen' },
  rightKidney: { c: [7.5, -5.5, -33], size: [5.5, 3.2, 11], note: 'T12-L3, about 1 cm lower than the left, hilum 5 cm from the midline at L1-L2' },
  leftKidney: { c: [-7.5, -5.5, -32], size: [5.5, 3.2, 11], note: 'T12-L3' },
  rightAdrenal: { c: [5.5, -6, -26.5], size: [3, 1, 4], note: 'cap on the upper pole of the right kidney' },
  leftAdrenal: { c: [-5.5, -6, -26.5], size: [3, 1, 4], note: 'crescent on the upper pole of the left kidney' },
  bladder: { c: [0, 3.5, -53], size: [8, 7, 7], note: 'pelvis, behind the pubic symphysis' },
  diaphragmRightDome: { c: [6, -1, -16.5], size: [16, 20, 6], note: 'right dome reaches the 5th rib (nipple line), higher because of the liver' },
  diaphragmLeftDome: { c: [-6.5, -1, -18], size: [15, 20, 6], note: 'left dome about one rib space lower' },
} satisfies Record<string, Placement>

/** Landmarks, cm below the notch: sternal angle (T4/5), xiphisternal joint (T9), transpyloric plane (L1), umbilicus (L3/4), iliac crest (L4), pubic symphysis. */
export const LANDMARKS = { sternalAngle: -5, xiphisternal: -17, transpyloric: -29, umbilicus: -40, iliacCrest: -42, pubicSymphysis: -54 }

// ---- the diaphragm's three openings -----------------------------------------------------------------------------
export const HIATUS = { caval: { level: 'T8', x: 3, y: 0.5 }, oesophageal: { level: 'T10', x: -1.5, y: -2 }, aortic: { level: 'T12', x: -1, y: -6.5 } }

// ---- the spinal cord, nerves and ganglia ------------------------------------------------------------------------
/** Height (cm) beside the middle of a cord segment. The cord is shorter than the spine, so thoracic segments sit several vertebrae above
 *  their numbers (rule of thumb: cervical one level up, upper thoracic two, lower thoracic three); lumbar segments sit at T10-T12 and sacral at T12-L1. */
export function cordSegmentZ(region: 'C' | 'T' | 'L' | 'S', n: number): number {
  const lin = (n0: number, n1: number, z0: number, z1: number) => z0 + ((n - n0) / (n1 - n0)) * (z1 - z0)
  if (region === 'C') return lin(1, 8, 11, 3)
  if (region === 'T') return lin(1, 12, 1.5, -19)
  if (region === 'L') return lin(1, 5, -21, -26)
  return lin(1, 5, -27, -30)
}
/** Where the cord ends (conus medullaris), about L1-L2. */
export const CONUS_Z = vertZ('L1') - 1.7
export const CORD_TOTAL_CM = 45
export const SEGMENT_COUNTS = { C: 8, T: 12, L: 5, S: 5 } as const
export const SPINAL_PAIRS = SEGMENT_COUNTS.C + SEGMENT_COUNTS.T + SEGMENT_COUNTS.L + SEGMENT_COUNTS.S + 1

/** Which cord segments feed each organ (textbook ranges). Heart and lung levels are the classic T1-T4/T5 sympathetic supply. */
export interface Supply { sympathetic?: [string, string]; parasympathetic: string; sensory?: string; note: string; evidence: Evidence }
export const SUPPLY: Record<string, Supply> = {
  heart: { sympathetic: ['T1', 'T4'], parasympathetic: 'vagus (CN X)', sensory: 'T1-T4 (angina is felt in the chest, left arm and jaw)', note: 'Sympathetic fibres speed the heart and strengthen each beat; the right vagus slows the sinoatrial node, the left slows the atrioventricular node.', evidence: 'established' },
  lungs: { sympathetic: ['T2', 'T5'], parasympathetic: 'vagus (CN X)', note: 'Sympathetic input widens the airways; vagal input narrows them and increases secretions.', evidence: 'established' },
  diaphragm: { parasympathetic: 'none (motor: phrenic nerve C3-C5)', sensory: 'phrenic C3-C5 centrally, T5-T12 at the edge', note: 'Breathing\'s main muscle is driven by the phrenic nerve. A cord injury above C3 stops its supply; below C5 it is spared.', evidence: 'established' },
  stomach: { sympathetic: ['T5', 'T9'], parasympathetic: 'vagus (CN X)', sensory: 'T6-T9', note: 'Greater splanchnic nerves (T5-T9) via the celiac ganglion; the vagal trunks drive acid and emptying.', evidence: 'established' },
  liver: { sympathetic: ['T7', 'T10'], parasympathetic: 'vagus (CN X)', sensory: 'T7-T9 plus phrenic (shoulder-tip pain)', note: 'Celiac plexus supply; sympathetic input releases glucose.', evidence: 'established' },
  spleen: { sympathetic: ['T6', 'T10'], parasympathetic: 'no direct supply shown (vagus acts through the celiac plexus)', note: 'Sympathetic nerves follow the splenic artery; the vagus-spleen link is a research topic.', evidence: 'supported' },
  adrenals: { sympathetic: ['T10', 'L1'], parasympathetic: 'none', note: 'The only organ whose sympathetic nerves connect straight to its secreting cells: they release adrenaline and norepinephrine into the blood.', evidence: 'established' },
  kidneys: { sympathetic: ['T10', 'L1'], parasympathetic: 'vagus (renal branches, role unclear)', sensory: 'T10-L1 (loin pain)', note: 'Sympathetic nerves narrow renal vessels and release renin.', evidence: 'established' },
  gut: { sympathetic: ['T9', 'L2'], parasympathetic: 'vagus to the splenic flexure, pelvic nerves S2-S4 beyond', sensory: 'T9-L2', note: 'Sympathetic input slows movement; parasympathetic input drives it.', evidence: 'established' },
  bladder: { sympathetic: ['T10', 'L2'], parasympathetic: 'pelvic nerves S2-S4', sensory: 'S2-S4', note: 'Sacral parasympathetic fibres empty the bladder; sympathetic fibres help hold urine.', evidence: 'established' },
  esophagus: { sympathetic: ['T4', 'T6'], parasympathetic: 'vagus (CN X) and the brain stem swallowing centre', sensory: 'T4-T6 (heartburn is felt behind the breastbone)', note: 'The vagus drives each swallowing wave; the upper third is striated muscle commanded by the brain stem (nucleus ambiguus).', evidence: 'established' },
  gallbladder: { sympathetic: ['T7', 'T9'], parasympathetic: 'vagus (CN X)', sensory: 'T7-T9 plus phrenic (right shoulder-tip pain)', note: 'Vagal input and the hormone CCK make it contract after a fatty meal.', evidence: 'established' },
  pancreas: { sympathetic: ['T6', 'T10'], parasympathetic: 'vagus (CN X)', sensory: 'T6-T10 (felt in the upper back)', note: 'Vagal input drives enzyme and insulin release; sympathetic input dampens insulin.', evidence: 'supported' },
  muscle: { parasympathetic: 'none (motor: spinal nerves C5-T1 arms, L2-S3 legs)', note: 'Skeletal muscle is commanded by motor neurons in the cord; the cervical enlargement serves the arms and the lumbar enlargement the legs.', evidence: 'established' },
}

/** Sympathetic chain: one ganglion per level on each side of the spine, running from the neck to the sacrum. */
export const CHAIN_LEVELS = [...Array.from({ length: 3 }, (_, i) => `C${i + 1}`), ...VERTEBRAE.filter((v) => v[0] === 'T' || v[0] === 'L'), 'S1', 'S2', 'S3', 'S4'] as const
export const THORACOLUMBAR_OUTFLOW: [string, string] = ['T1', 'L2']
