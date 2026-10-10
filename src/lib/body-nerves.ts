// The nervous system of the detailed body: spinal cord with its 31 nerve pairs, the vagus nerves, the sympathetic chain and
// its ganglia, the phrenic nerves, limb nerves, and the tracts that join the brain to the cord (motor, sensory, autonomic, visual).
// Procedural geometry only. Pathways carry the curves the scene animates signals along.

import * as THREE from 'three'
import { CANAL_BEHIND, CHAIN_LEVELS, CONUS_Z, RIBS, SEGMENT_COUNTS, cordSegmentZ, ribHalfWidth, spineY, vertZ } from './anatomy.ts'
import { blob, cmV, merge, spline, spindle, variableTube, V } from './body-geom.ts'
import { ribPath } from './body-skeleton.ts'
import type { OrganId } from './body.ts'

const CM = 1 / 15
export type PathKind = 'motor' | 'sensory' | 'autonomic' | 'vagus' | 'phrenic' | 'visual' | 'sympathetic' | 'sacral' | 'limb'
export interface Pathway {
  id: string
  kind: PathKind
  label: string
  /** -1 left, 1 right, 0 both or midline (the side of the BODY the pathway serves, or the hemisphere for brain tracts) */
  side: -1 | 0 | 1
  curve: THREE.Curve<THREE.Vector3>
  color: string
  /** organs that depend on this pathway */
  organs: OrganId[]
  direction: 'down' | 'up' | 'both'
}
export interface NervePart { id: string; label: string; organ: OrganId; geometry: THREE.BufferGeometry; layer: 'cord' | 'nerves' }
export interface NerveModel { parts: NervePart[]; pathways: Pathway[]; cordCurve: THREE.CatmullRomCurve3; ganglia: { id: string; at: THREE.Vector3 }[] }

const CORD = 0xf1e7c8, YEL = 0xf2d16b, ORANGE = 0xf0a84b, DEEP = 0xe98c5a, ROSE = 0xd7708f, VAGUS = 0x38b259, SYMP = 0xe8590c, PARA = 0x1c9ed6, GANGLION = 0xffc233

const canalY = (z: number) => spineY(z) - CANAL_BEHIND
/** Brain-space joints (the brain is drawn in scene units already; these match the nuclei in neuro.ts). */
const BR = { cortexMotor: [0.42, 0.25, 0.72], radiata: [0.34, 0.15, 0.45], capsule: [0.24, 0.03, 0.18], peduncle: [0.15, -0.18, -0.28], pons: [0.1, -0.32, -0.5], pyramid: [0.05, -0.41, -0.8], decuss: [0, -0.43, -0.9], medullaTop: [0, -0.4, -0.78] } as const

export function buildNerves(): NerveModel {
  const parts: NervePart[] = [], pathways: Pathway[] = [], ganglia: { id: string; at: THREE.Vector3 }[] = []
  const addPath = (p: Pathway) => { pathways.push(p); return p }

  // ================= spinal cord, with its two enlargements and the conus ====================================================
  const zTop = 11.5
  const cordPts: THREE.Vector3[] = [new THREE.Vector3(0, -0.4, -0.78)]
  for (let z = zTop; z >= CONUS_Z; z -= 2.5) cordPts.push(cmV(0, canalY(z), z))
  cordPts.push(cmV(0, canalY(CONUS_Z), CONUS_Z))
  const cordCurve = spline(cordPts, 0.3)
  const zAt = (t: number) => zTop + (CONUS_Z - zTop) * t
  const cordR = (t: number) => {
    const z = zAt(t)
    const cervical = Math.exp(-(((z - 5) / 5) ** 2)) * 0.2, lumbar = Math.exp(-(((z + 23) / 4) ** 2)) * 0.18
    const taper = z < CONUS_Z + 4 ? Math.max(0.15, (z - CONUS_Z) / 4) : 1
    return (0.42 + cervical + lumbar) * taper * CM * 1.15
  }
  const seg = new THREE.Color(CORD), segDark = new THREE.Color(0xd9ccaa)
  parts.push({ id: 'cord', label: 'Spinal cord', organ: 'spinalcord', layer: 'cord', geometry: variableTube(cordCurve, cordR, 260, 14, CORD, (t) => { const z = zAt(t); return seg.clone().lerp(segDark, 0.5 + 0.5 * Math.sin(z * 2.2)) }) })

  // ================= conus tip, filum terminale, cauda equina and the 31 pairs of nerves ==================================
  const exitZ = (region: 'C' | 'T' | 'L' | 'S', n: number) =>
    region === 'C' ? (n === 1 ? vertZ('C1') + 1 : n <= 7 ? (vertZ(`C${n - 1}`) + vertZ(`C${n}`)) / 2 : (vertZ('C7') + vertZ('T1')) / 2)
      : region === 'T' ? vertZ(`T${n}`) - 1.3 : region === 'L' ? vertZ(`L${n}`) - 1.9 : -46 - (n - 1) * 2.3
  const regionColor = { C: YEL, T: ORANGE, L: DEEP, S: ROSE } as const
  const rootsByRegion: Record<string, THREE.BufferGeometry[]> = { C: [], T: [], L: [], S: [] }
  const exits: Record<string, THREE.Vector3[]> = {}
  for (const region of ['C', 'T', 'L', 'S'] as const) {
    const n = SEGMENT_COUNTS[region]
    for (let k = 1; k <= n; k++) for (const side of [-1, 1] as const) {
      const zs = cordSegmentZ(region, k), ze = exitZ(region, k)
      const w = region === 'C' ? 2.4 : region === 'T' ? 2.4 : region === 'L' ? 3.4 : 2.6
      const pts: THREE.Vector3[] = [cmV(side * 0.45, canalY(zs), zs)]
      if (region === 'L' || region === 'S') {            // the lower roots hang down inside the canal (cauda equina) before leaving
        const steps = 5
        for (let i = 1; i <= steps; i++) { const f = i / steps, z = zs + (ze - zs) * f; pts.push(cmV(side * (0.55 + 0.25 * Math.sin(f * 3)) * (1 + 0.1 * k), canalY(z) - 0.1, z)) }
      } else pts.push(cmV(side * 1.0, canalY((zs + ze) / 2), (zs + ze) / 2))
      pts.push(cmV(side * (w + 0.7), canalY(ze) + 1.0, ze), cmV(side * (w + 3.0), canalY(ze) + 0.6, ze - 1.4))
      rootsByRegion[region].push(variableTube(spline(pts), (t) => (0.2 - 0.08 * t) * CM * (region === 'T' ? 1 : 1.2), 18, 5, regionColor[region]))
      ;(exits[`${region}${k}${side}`] ??= []).push(pts[pts.length - 2])
    }
  }
  const names = { C: 'Cervical', T: 'Thoracic', L: 'Lumbar', S: 'Sacral' } as const
  for (const r of ['C', 'T', 'L', 'S'] as const) parts.push({ id: `roots.${r}`, label: `${names[r]} spinal nerves`, organ: 'spinalcord', layer: 'nerves', geometry: merge(rootsByRegion[r]) })
  parts.push({ id: 'cord.filum', label: 'Filum terminale', organ: 'spinalcord', layer: 'cord', geometry: variableTube(spline([cmV(0, canalY(CONUS_Z), CONUS_Z), cmV(0, canalY(-45) - 0.2, -45), cmV(0, canalY(-56), -56)]), () => 0.09 * CM, 20, 5, 0xfff3d0) })

  // intercostal nerves follow the groove under each rib
  const inter: THREE.BufferGeometry[] = []
  for (const rib of RIBS.slice(0, 11)) for (const side of [-1, 1] as const) {
    const pts = ribPath(rib, side, -0.9, 22).slice(1)
    pts.unshift((exits[`T${rib.n}${side}`] ?? [])[0] ?? pts[0])
    inter.push(variableTube(spline(pts), (t) => (0.21 - 0.08 * t) * CM, 26, 5, ORANGE))
  }
  parts.push({ id: 'nerves.intercostal', label: 'Intercostal nerves', organ: 'muscle', layer: 'nerves', geometry: merge(inter) })

  // ================= limb nerves: brachial plexus and arm nerves, lumbosacral plexus and the sciatic nerve ======================
  const limbN: THREE.BufferGeometry[] = []
  for (const side of [-1, 1] as const) {
    const roots = [5, 6, 7, 8].map((c) => (exits[`C${c}${side}`] ?? [])[0]).concat((exits[`T1${side}`] ?? [])[0]).filter(Boolean)
    const node = cmV(side * 12.5, -1.2, -1.6)
    roots.forEach((p) => limbN.push(variableTube(spline([p, cmV(side * 8, -1.5, -0.4), node]), () => 0.17 * CM, 14, 5, YEL)))
    const arm = spline([node, cmV(side * 18, 0.4, -6.4), cmV(side * 20.5, 0.8, -24), cmV(side * 21.2, 1.1, -36), cmV(side * 23.6, 1.4, -57), cmV(side * 25, 1.6, -65)])
    limbN.push(variableTube(arm, (t) => (0.42 - 0.26 * t) * CM, 70, 6, YEL))
    addPath({ id: `limb.arm.${side}`, kind: 'limb', label: `${side === 1 ? 'Right' : 'Left'} arm nerves`, side, curve: arm, color: '#f2d16b', organs: ['muscle'], direction: 'both' })
    const lroots = ['L2', 'L3', 'L4', 'L5', 'S1', 'S2', 'S3'].map((k) => (exits[`${k[0]}${k.slice(1)}${side}`] ?? [])[0]).filter(Boolean)
    const lnode = cmV(side * 8.2, -8.4, -50)
    lroots.forEach((p) => limbN.push(variableTube(spline([p, cmV(side * 7, -7.6, -44), lnode]), () => 0.17 * CM, 16, 5, DEEP)))
    const leg = spline([lnode, cmV(side * 9.2, -4.2, -62), cmV(side * 9.4, -2.6, -80), cmV(side * 9.5, -1.4, -94), cmV(side * 9.7, -0.6, -115), cmV(side * 9.6, 0.6, -137), cmV(side * 9.7, 5, -142)])
    limbN.push(variableTube(leg, (t) => (0.6 - 0.42 * t) * CM, 120, 6, DEEP))
    addPath({ id: `limb.leg.${side}`, kind: 'limb', label: `${side === 1 ? 'Right' : 'Left'} leg nerves (sciatic)`, side, curve: leg, color: '#e98c5a', organs: ['muscle'], direction: 'both' })
  }
  parts.push({ id: 'nerves.limbs', label: 'Brachial and lumbosacral plexuses', organ: 'muscle', layer: 'nerves', geometry: merge(limbN) })

  // ================= phrenic nerves (C3-C5) to the diaphragm ==========================================================================
  const ph: THREE.BufferGeometry[] = []
  for (const side of [-1, 1] as const) {
    const c = spline([(exits[`C4${side}`] ?? [])[0] ?? cmV(side * 4, -2, 8), cmV(side * 4.6, -1.6, 6), cmV(side * 5.4, 0.4, -1.5), cmV(side * 6.2, 0.4, -8.5), cmV(side * 5.8, 0.4, -14.5), cmV(side * 4.6, 0.6, -17)])
    ph.push(variableTube(c, () => 0.26 * CM, 50, 6, 0xffe08a))
    addPath({ id: `phrenic.${side}`, kind: 'phrenic', label: `${side === 1 ? 'Right' : 'Left'} phrenic nerve (C3-C5)`, side, curve: c, color: '#ffe08a', organs: ['diaphragm', 'lungs'], direction: 'down' })
  }
  parts.push({ id: 'nerves.phrenic', label: 'Phrenic nerves', organ: 'diaphragm', layer: 'nerves', geometry: merge(ph) })

  // ================= vagus nerves: brainstem to the splenic flexure =============================================================
  const vg: THREE.BufferGeometry[] = []
  const vagusPaths: Record<number, THREE.CatmullRomCurve3> = {}
  for (const side of [-1, 1] as const) {
    const trunk = side === 1
      ? [V([0.1, -0.44, -0.88]), cmV(2.2, -0.4, 10), cmV(2.8, 0.1, 2), cmV(3.6, -0.6, -4), cmV(4.5, -2.4, -9.2), cmV(1.4, -3.2, -13.4), cmV(-0.2, -3.6, -17.5), cmV(-1.2, -3.4, -21), cmV(-1.4, -5.8, -27.6)]
      : [V([-0.1, -0.44, -0.88]), cmV(-2.2, -0.4, 10), cmV(-2.8, 0.1, 2), cmV(-3.4, -0.2, -3.6), cmV(-4.2, -2, -9.4), cmV(-1.6, -2.6, -14), cmV(-1.4, -2.2, -18), cmV(-2, -1.4, -21.6), cmV(-3.4, 0.4, -24.6)]
    const c = spline(trunk); vagusPaths[side] = c
    vg.push(variableTube(c, (t) => (0.3 - 0.06 * t) * CM, 140, 7, VAGUS))
    addPath({ id: `vagus.${side}`, kind: 'vagus', label: `${side === 1 ? 'Right' : 'Left'} vagus nerve (CN X)`, side, curve: c, color: '#38b259', organs: ['heart', 'lungs', 'esophagus', 'stomach', 'liver', 'pancreas', 'gut', 'spleen'], direction: 'both' })
  }
  // cardiac branches (right to the sinoatrial node, left to the atrioventricular node) and pulmonary branches to the lung roots
  vg.push(variableTube(spline([cmV(2.8, 0.1, 1), cmV(3.4, 1.4, -3.6), cmV(3.0, 2.0, -6.6)]), () => 0.16 * CM, 20, 5, VAGUS), variableTube(spline([cmV(-2.8, 0.1, 1), cmV(-3.2, 0.6, -5), cmV(-0.2, 0.8, -9.2)]), () => 0.16 * CM, 24, 5, VAGUS))
  for (const side of [-1, 1] as const) vg.push(variableTube(spline([cmV(side * 4.4, -2.4, -9.2), cmV(side * 5.4, -2.0, -9.8)]), () => 0.18 * CM, 8, 5, VAGUS))
  // abdominal branches: liver, stomach, then along the mesenteric artery to the small bowel and colon up to the splenic flexure
  const celiac = cmV(-1.2, spineY(-28) + 3.4, -28)
  vg.push(variableTube(spline([cmV(-1.4, -5.8, -27.6), cmV(2, -2, -27), cmV(6.6, 0.2, -25.6)]), () => 0.14 * CM, 24, 5, VAGUS))
  vg.push(variableTube(spline([cmV(-3.4, 0.4, -24.6), cmV(-5.4, 3, -27.4), cmV(-3.2, 3.8, -31)]), () => 0.15 * CM, 24, 5, VAGUS))
  vg.push(variableTube(spline([celiac, cmV(-1.0, 1.2, -33), cmV(0.6, 3.6, -37.4), cmV(5.8, 1.4, -44)]), () => 0.14 * CM, 30, 5, VAGUS), variableTube(spline([cmV(-1.0, 1.2, -33), cmV(3.5, 6, -33.6), cmV(-6, 5.8, -34.4), cmV(-11, 0.6, -28.6)]), () => 0.12 * CM, 40, 5, VAGUS))
  parts.push({ id: 'nerves.vagus', label: 'Vagus nerves (parasympathetic)', organ: 'heart', layer: 'nerves', geometry: merge(vg) })

  // ================= sympathetic chain, ganglia and splanchnic nerves ===========================================================
  const sy: THREE.BufferGeometry[] = [], beads: THREE.BufferGeometry[] = []
  const chainPt = (lvl: string, side: -1 | 1) => {
    const z = lvl[0] === 'S' ? -46 - (Number(lvl[1]) - 1) * 2.4 : vertZ(lvl) - (lvl[0] === 'C' ? 0 : 1.0)
    const y = lvl[0] === 'S' ? spineY(-46) + 0.4 : spineY(z) + 0.9
    return cmV(side * (lvl[0] === 'C' ? 2.4 : lvl[0] === 'T' ? 3.4 : lvl[0] === 'L' ? 4.2 : 2.2), y, z)
  }
  const chains: Record<number, THREE.Vector3[]> = { [-1]: [], 1: [] }
  for (const side of [-1, 1] as const) {
    CHAIN_LEVELS.forEach((lvl) => { const p = chainPt(lvl, side); chains[side].push(p); beads.push(blob(p, [0.55 * CM, 0.55 * CM, 0.7 * CM], GANGLION, { w: 10, h: 8 })); ganglia.push({ id: `${lvl}${side}`, at: p }) })
    const c = spline(chains[side]); sy.push(variableTube(c, () => 0.17 * CM, 160, 6, SYMP))
    addPath({ id: `sympathetic.chain.${side}`, kind: 'sympathetic', label: `${side === 1 ? 'Right' : 'Left'} sympathetic chain`, side, curve: c, color: '#e8590c', organs: ['heart', 'lungs', 'stomach', 'liver', 'spleen', 'kidneys', 'adrenals', 'gut', 'bladder'], direction: 'down' })
  }
  // white rami: preganglionic fibres leave the cord (T1-L2) and join the chain
  for (const side of [-1, 1] as const) for (let n = 1; n <= 12 + 2; n++) {
    const lvl = n <= 12 ? `T${n}` : `L${n - 12}`
    const ex = (exits[`${lvl[0]}${lvl.slice(1)}${side}`] ?? [])[0], ch = chainPt(lvl, side)
    if (ex) sy.push(variableTube(spline([ex, ch]), () => 0.1 * CM, 6, 5, SYMP))
  }
  const celiacG = [cmV(-1.8, spineY(-28) + 3.6, -28), cmV(1.8, spineY(-28) + 3.6, -28)]
  const smg = cmV(0, spineY(-31) + 3.4, -31.4), img = cmV(0, spineY(-38) + 3.6, -38.6), hyp = cmV(0, spineY(-46) + 3.4, -46.4)
  for (const g of [...celiacG, smg, img, hyp]) beads.push(blob(g, [0.9 * CM, 0.7 * CM, 0.7 * CM], GANGLION, { w: 12, h: 8 }))
  ganglia.push({ id: 'celiac', at: celiacG[0] }, { id: 'smg', at: smg }, { id: 'img', at: img }, { id: 'hypogastric', at: hyp })
  for (const side of [-1, 1] as const) {
    const s = chains[side]
    const idxOf = (l: string) => CHAIN_LEVELS.indexOf(l as (typeof CHAIN_LEVELS)[number])
    const greater = spline([s[idxOf('T5')], s[idxOf('T7')], s[idxOf('T9')], cmV(side * 2.4, spineY(-24) + 3.0, -24.5), celiacG[side === 1 ? 1 : 0]])
    const lesser = spline([s[idxOf('T10')], s[idxOf('T11')], cmV(side * 1.8, spineY(-29) + 3.2, -29), smg])
    const lumbar = spline([s[idxOf('L1')], s[idxOf('L2')], cmV(side * 1.4, spineY(-37) + 3.2, -36.8), img])
    sy.push(variableTube(greater, () => 0.2 * CM, 40, 6, SYMP), variableTube(lesser, () => 0.16 * CM, 30, 6, SYMP), variableTube(lumbar, () => 0.14 * CM, 26, 6, SYMP))
    // postganglionic plexuses to the organs
    const to = (from: THREE.Vector3, ...pts: THREE.Vector3[]) => sy.push(variableTube(spline([from, ...pts]), () => 0.1 * CM, 20, 5, SYMP))
    const cg = celiacG[side === 1 ? 1 : 0]
    to(cg, cmV(side * 3, 0, -27), cmV(side * 6.8, 0.4, -25.4))                         // liver (right branch ends at the hilum)
    if (side === -1) { to(cg, cmV(-4, 1.2, -26.4), cmV(-6, 1.6, -26)); to(cg, cmV(-7, -1.8, -26.4), cmV(-11, -3.6, -25)) }   // stomach, spleen
    to(cg, cmV(side * 4.4, spineY(-28) + 2.2, -29), cmV(side * 5.4, -6.2, -26.8))     // adrenal (direct)
    to(side === 1 ? smg : img, cmV(side * 3.6, -4.8, -32.4), cmV(side * 5.8, -5.0, -33.4))  // kidney (renal plexus)
    to(hyp, cmV(side * 2.6, -4.6, -50), cmV(side * 2.0, 1.2, -53))                     // bladder (hypogastric nerves)
  }
  sy.push(variableTube(spline([smg, cmV(0, 1.6, -35), cmV(1.2, 3.2, -38.6), cmV(6.8, 1, -44.2)]), () => 0.13 * CM, 30, 5, SYMP))  // small bowel
  sy.push(variableTube(spline([img, cmV(-6, 1, -40), cmV(-12.2, -1.4, -40)]), () => 0.13 * CM, 30, 5, SYMP))                       // descending colon
  // cardiac and pulmonary sympathetic nerves from the cervical and upper thoracic chain
  for (const side of [-1, 1] as const) {
    const s = chains[side]
    sy.push(variableTube(spline([s[3], cmV(side * 2.8, 0, -1.5), cmV(side * 2.2, 1.4, -5.4), cmV(side * 0.6, 1.8, -8)]), () => 0.15 * CM, 28, 5, SYMP))
    sy.push(variableTube(spline([s[CHAIN_LEVELS.indexOf('T4')], cmV(side * 4.4, -1.8, -9.4), cmV(side * 5.2, -1.8, -9.8)]), () => 0.13 * CM, 14, 5, SYMP))
  }
  parts.push({ id: 'nerves.sympathetic', label: 'Sympathetic chain and nerves', organ: 'heart', layer: 'nerves', geometry: merge(sy) })
  parts.push({ id: 'ganglia', label: 'Sympathetic ganglia', organ: 'heart', layer: 'nerves', geometry: merge(beads) })

  // sacral parasympathetic outflow (S2-S4): pelvic splanchnic nerves to the bladder, rectum and the descending colon
  const sp: THREE.BufferGeometry[] = []
  for (const side of [-1, 1] as const) {
    const ex = [2, 3, 4].map((k) => (exits[`S${k}${side}`] ?? [])[0]).filter(Boolean)
    const hub = cmV(side * 3.4, -4.6, -52)
    ex.forEach((p) => sp.push(variableTube(spline([p, cmV(side * 3.4, -6.5, -50), hub]), () => 0.14 * CM, 14, 5, PARA)))
    const toBladder = spline([hub, cmV(side * 2.8, 0, -53.2), cmV(side * 1.8, 2.6, -54)])
    sp.push(variableTube(toBladder, () => 0.14 * CM, 14, 5, PARA))
    const up = spline([hub, cmV(side === -1 ? -9 : 3, -2, -49), cmV(side === -1 ? -12.4 : 3, -1.4, -42), cmV(side === -1 ? -12.6 : 3, -1.4, -35), cmV(side === -1 ? -10.8 : 3, 0, -29.6)])
    if (side === -1) sp.push(variableTube(up, () => 0.12 * CM, 40, 5, PARA))
    addPath({ id: `sacral.${side}`, kind: 'sacral', label: `${side === 1 ? 'Right' : 'Left'} pelvic splanchnic nerves (S2-S4)`, side, curve: toBladder, color: '#1c9ed6', organs: ['bladder', 'gut'], direction: 'both' })
  }
  parts.push({ id: 'nerves.sacral', label: 'Sacral parasympathetic nerves', organ: 'bladder', layer: 'nerves', geometry: merge(sp) })

  // ================= tracts: brain to cord (motor, sensory, autonomic) and the optic pathway ======================================
  const tr: THREE.BufferGeometry[] = []
  for (const h of [-1, 1] as const) {                       // h = the hemisphere; the tract serves the OPPOSITE side of the body
    const brain = [BR.cortexMotor, BR.radiata, BR.capsule, BR.peduncle, BR.pons, BR.pyramid].map((p) => V([p[0] * h, p[1], p[2]]))
    const down: THREE.Vector3[] = [V([h * 0.04, BR.decuss[1], BR.decuss[2]]), V([0, BR.decuss[1] + 0.02, BR.decuss[2] - 0.08])]
    const cordPtsT: THREE.Vector3[] = []
    for (let z = 10; z >= CONUS_Z + 1; z -= 4) cordPtsT.push(cmV(-h * 0.5, canalY(z) - 0.15, z))
    const c = spline([...brain, ...down, ...cordPtsT], 0.4)
    tr.push(variableTube(c, (t) => (t < 0.35 ? 0.016 : 0.01) * (1 + 0.1 * Math.sin(t * 30)), 190, 6, 0x4dabf7))
    addPath({ id: `corticospinal.${h}`, kind: 'motor', label: `${h === 1 ? 'Right' : 'Left'} corticospinal tract`, side: h, curve: c, color: '#4dabf7', organs: ['muscle', 'bladder'], direction: 'down' })
    // sensory (dorsal column and medial lemniscus): ipsilateral in the cord, crossing in the medulla, to the thalamus and sensory cortex
    const sCord: THREE.Vector3[] = []
    for (let z = CONUS_Z + 2; z <= 10; z += 4) sCord.push(cmV(h * 0.4, canalY(z) - 0.9, z))
    const sBrain = [V([h * 0.02, -0.46, -0.84]), V([-h * 0.05, -0.4, -0.66]), V([-h * 0.12, -0.26, -0.4]), V([-h * 0.18, -0.08, -0.06]), V([-h * 0.34, -0.06, 0.4]), V([-h * 0.5, -0.04, 0.66])]
    const sc = spline([...sCord, ...sBrain], 0.4)
    tr.push(variableTube(sc, () => 0.009, 190, 6, 0xb197fc))
    addPath({ id: `sensory.${h}`, kind: 'sensory', label: `${h === 1 ? 'Right' : 'Left'} body: dorsal column to sensory cortex`, side: h, curve: sc, color: '#b197fc', organs: ['muscle', 'bladder'], direction: 'up' })
  }
  // descending autonomic fibres: hypothalamus to the lateral horn of the cord
  for (const h of [-1, 1] as const) {
    const pts = [V([h * 0.03, 0.16, -0.3]), V([h * 0.05, -0.14, -0.55]), V([h * 0.05, -0.38, -0.82])]
    for (let z = 9; z >= -22; z -= 5) pts.push(cmV(h * 0.5, canalY(z) + 0.15, z))
    const c = spline(pts, 0.4)
    tr.push(variableTube(c, () => 0.008, 160, 6, 0xff922b))
    addPath({ id: `autonomic.${h}`, kind: 'autonomic', label: `${h === 1 ? 'Right' : 'Left'} descending autonomic fibres`, side: h, curve: c, color: '#ff922b', organs: ['heart', 'lungs', 'stomach', 'liver', 'spleen', 'kidneys', 'adrenals', 'gut', 'bladder'], direction: 'down' })
  }
  // optic pathway: eyes, chiasm (nasal fibres cross), lateral geniculate in the thalamus, radiation to the occipital pole
  for (const h of [-1, 1] as const) {
    const eye = V([h * 0.36, 1.12, 0.2]), chiasm = V([0, 0.5, -0.1])
    const c = spline([eye, V([h * 0.2, 0.8, 0.02]), chiasm, V([h * 0.2, 0.26, -0.1]), V([h * 0.3, -0.1, -0.02]), V([h * 0.34, -0.5, 0.06]), V([h * 0.3, -0.84, 0.12])], 0.4)
    tr.push(variableTube(c, () => 0.012, 100, 6, 0x4dabf7))
    addPath({ id: `visual.${h}`, kind: 'visual', label: `${h === 1 ? 'Right' : 'Left'} visual pathway`, side: h, curve: c, color: '#74c0fc', organs: ['eyes'], direction: 'up' })
  }
  parts.push({ id: 'tracts', label: 'Brain to cord tracts', organ: 'spinalcord', layer: 'cord', geometry: merge(tr) })
  void ribHalfWidth; void spindle
  return { parts, pathways, cordCurve, ganglia }
}
