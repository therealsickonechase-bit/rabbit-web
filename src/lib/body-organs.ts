// The organs and blood vessels of the detailed body, built from deformed ellipsoids and tubes. Every position is taken from
// anatomy.ts (centimetres below the jugular notch). Each part is one mesh with its own colours so the scene can animate it:
// chambers beat, lobes inflate, the diaphragm flattens, a bolus travels along the gut.

import * as THREE from 'three'
import { HIATUS, LAYOUT, ribHalfDepth, ribHalfWidth, spineY, vertZ } from './anatomy.ts'
import { airwayTree, blob, cmV, merge, paint, rng, spline, variableTube } from './body-geom.ts'
import type { OrganId } from './body.ts'

const CM = 1 / 15
export interface OrganPart {
  id: string
  label: string
  organ: OrganId
  geometry: THREE.BufferGeometry
  opacity?: number
  /** point (scene units) the part scales about when it animates */
  pivot?: THREE.Vector3
}
export interface OrganPaths { [name: string]: THREE.Curve<THREE.Vector3> }
export interface OrganModel { parts: OrganPart[]; paths: OrganPaths; heartNodes: { sa: THREE.Vector3; av: THREE.Vector3; apex: THREE.Vector3 } }

const RED = 0xc23b32, BLUE = 0x5266b0, PINK = 0xe5a7a1

/** Push any point that falls inside an ellipsoid out to its surface (used for the heart's bite out of the left lung). */
const carveOut = (c: THREE.Vector3, half: THREE.Vector3) => (p: THREE.Vector3, _u: THREE.Vector3, shift: THREE.Vector3) => {
  const q = p.clone().add(shift).sub(c)
  const n = Math.hypot(q.x / half.x, q.y / half.y, q.z / half.z)
  if (n < 1 && n > 0) { q.divideScalar(n); p.copy(q.add(c).sub(shift)) }
}

function lobe(center: [number, number, number], half: [number, number, number], color: number, seed: number, carve?: (p: THREE.Vector3, u: THREE.Vector3, shift: THREE.Vector3) => void, tilt = 0, extra?: (p: THREE.Vector3) => void) {
  const c = cmV(...center), shift = c.clone()
  return blob(c, [half[0] * CM, half[1] * CM, half[2] * CM], color, { w: 36, h: 26, jitter: 0.07, seed, rot: new THREE.Euler(0, tilt, 0), fn: (p, u) => { extra?.(p); carve?.(p, u, shift) } })
}

export function buildOrgans(): OrganModel {
  const parts: OrganPart[] = [], paths: OrganPaths = {}
  const add = (id: string, label: string, organ: OrganId, geometry: THREE.BufferGeometry, extra: Partial<OrganPart> = {}) => parts.push({ id, label, organ, geometry, ...extra })

  // ================= heart: four chambers, great vessels, coronary arteries ==================================================
  const heartC = cmV(...LAYOUT.heart.c)
  const lvAxis = new THREE.Euler(0.35, 0, 0.6)
  add('heart.LV', 'Left ventricle', 'heart', blob(cmV(-4.2, 1.0, -11.2), [3.1 * CM, 2.9 * CM, 5.2 * CM], RED, { w: 30, h: 22, jitter: 0.05, rot: lvAxis, fn: (p) => { if (p.z < 0) p.x *= 1 - 0.45 * (-p.z / (5.2 * CM)) } }), { pivot: heartC })
  add('heart.RV', 'Right ventricle', 'heart', blob(cmV(-0.9, 3.5, -10.4), [3.2 * CM, 2.0 * CM, 4.6 * CM], 0xa2465c, { w: 28, h: 20, jitter: 0.05, rot: new THREE.Euler(0.15, 0, 0.35) }), { pivot: heartC })
  add('heart.RA', 'Right atrium', 'heart', merge([blob(cmV(2.6, 1.4, -9.2), [2.1 * CM, 2.2 * CM, 3.3 * CM], BLUE, { w: 24, h: 18, jitter: 0.05 }), blob(cmV(1.0, 3.6, -6.4), [1.2 * CM, 0.9 * CM, 1.4 * CM], BLUE, { w: 12, h: 8, rot: new THREE.Euler(0, 0, 0.5) })]), { pivot: heartC })
  add('heart.LA', 'Left atrium', 'heart', merge([blob(cmV(-1.4, -2.2, -7.8), [3.4 * CM, 1.9 * CM, 2.2 * CM], 0xc35a52, { w: 24, h: 16, jitter: 0.05 }), blob(cmV(-3.6, 1.6, -6.0), [1.2 * CM, 0.9 * CM, 1.3 * CM], 0xc35a52, { w: 12, h: 8 })]), { pivot: heartC })

  // aorta from the left ventricle, over the arch, down the left of the spine to the fork at L4; arch branches to the head and arms
  const aortaPts = [cmV(-1.2, 1.5, -8), cmV(0.4, 1.6, -5.6), cmV(1.2, 1.0, -3.6), cmV(0.4, -0.6, -2.4), cmV(-2.2, -3, -3.6), cmV(-3.0, -5, -7), cmV(-2.8, spineY(-14) + 1.6, -14), cmV(-2.4, spineY(-22) + 1.8, -22), cmV(-1.6, spineY(-30) + 2, -30), cmV(-0.8, spineY(-39) + 2.2, -38.5)]
  paths.aorta = spline(aortaPts)
  const radiusAorta = (t: number) => (1.55 - 0.65 * t) * CM
  add('heart.aorta', 'Aorta', 'heart', variableTube(paths.aorta, radiusAorta, 120, 14, RED), { pivot: heartC })
  const arch: THREE.BufferGeometry[] = []
  const brachio = spline([cmV(1.0, 0.9, -3.2), cmV(2.4, 1.2, 0.5), cmV(3.6, 1.0, 3.5)])
  const lcc = spline([cmV(-0.3, 0.3, -2.8), cmV(-0.2, 1.0, 2), cmV(0.1, 1.2, 7.5)])
  const lsub = spline([cmV(-1.6, -1.2, -3.2), cmV(-5, -0.5, -1.2), cmV(-10.5, 0.2, -2.8)])
  arch.push(variableTube(brachio, () => 0.62 * CM, 14, 8, RED), variableTube(lcc, () => 0.52 * CM, 16, 8, RED), variableTube(lsub, () => 0.55 * CM, 14, 8, RED))
  paths.carotidL = spline([cmV(-0.3, 0.3, -2.8), cmV(-1.2, 1.2, 3), cmV(-1.8, 0.6, 9), cmV(-1.8, 0, 12)])
  paths.carotidR = spline([cmV(2.4, 1.2, 0.5), cmV(2.6, 1.2, 4), cmV(1.9, 0.6, 9), cmV(1.8, 0, 12)])
  arch.push(variableTube(paths.carotidL, () => 0.5 * CM, 20, 8, RED), variableTube(paths.carotidR, () => 0.5 * CM, 20, 8, RED))
  add('vessels.arch', 'Arch vessels', 'heart', merge(arch))

  // pulmonary trunk (blue) from the right ventricle and its two branches to the lungs; pulmonary veins (red) back to the left atrium
  const pt = spline([cmV(-1.2, 3.0, -7.2), cmV(-1.4, 1.8, -5.0), cmV(-1.0, 0.0, -4.4)])
  const pulm = [variableTube(pt, () => 1.25 * CM, 16, 12, BLUE),
    variableTube(spline([cmV(-1.0, 0.0, -4.4), cmV(2, -1.6, -5.6), cmV(6.5, -1.8, -8.4)]), () => 0.95 * CM, 18, 10, BLUE),
    variableTube(spline([cmV(-1.0, 0.0, -4.4), cmV(-3.4, -1.4, -6.0), cmV(-6.6, -1.8, -8.6)]), () => 0.9 * CM, 18, 10, BLUE)]
  add('vessels.pulmonary', 'Pulmonary arteries', 'lungs', merge(pulm))
  const veins = [cmV(-6, -2, -9.4), cmV(-6.5, -1.4, -11), cmV(6, -2, -10), cmV(6.4, -1.4, -11.6)].map((p, i) => variableTube(spline([p, cmV(i < 2 ? -3.4 : 2.6, -2.2, -8.2)]), () => 0.42 * CM, 10, 8, RED))
  add('vessels.pulmonaryVeins', 'Pulmonary veins', 'lungs', merge(veins))

  // venae cavae: superior comes down into the right atrium, inferior runs up the right of the spine through the diaphragm at T8
  paths.svc = spline([cmV(3.6, 1.0, 3.5), cmV(3.4, 1.0, -2), cmV(3.0, 1.3, -6.6)])
  paths.ivc = spline([cmV(1.8, spineY(-38) + 1.6, -41), cmV(2.8, spineY(-30) + 1.6, -30), cmV(3.2, 0.2, -20), cmV(3.0, 0.9, -15), cmV(2.8, 1.3, -12.5)])
  add('vessels.cavae', 'Venae cavae', 'heart', merge([variableTube(paths.svc, () => 1.05 * CM, 24, 10, BLUE), variableTube(paths.ivc, (t) => (1.2 + 0.3 * (1 - t)) * CM, 60, 10, BLUE)]), { pivot: heartC })

  // coronary arteries on the heart surface
  const cor = [spline([cmV(-1.4, 2.4, -6.8), cmV(-2.6, 4.3, -9), cmV(-4.2, 4.0, -12.5), cmV(-5.4, 3.0, -14.2)]), spline([cmV(-0.8, 2.4, -6.8), cmV(1.6, 3.8, -8.6), cmV(3.4, 3.2, -11.4), cmV(2.2, 1.2, -13.4)])]
  add('heart.coronary', 'Coronary arteries', 'heart', merge(cor.map((c) => variableTube(c, (t) => (0.34 - 0.18 * t) * CM, 24, 6, 0xf0603a))), { pivot: heartC })
  const sa = cmV(3.0, 2.0, -6.6), av = cmV(0.5, 0.6, -9.6), apex = cmV(-6.4, 3.0, -14.2)
  paths.conduction = spline([sa, cmV(1.6, 1.2, -8.2), av, cmV(-0.6, 1.2, -11), cmV(-3.6, 2.4, -13.4), apex])

  // ================= lungs: lobes that wrap the heart, airway tree =========================================================
  const heartCut = carveOut(cmV(-2.6, 1.8, -10.4), new THREE.Vector3(7.2 * CM, 5.2 * CM, 7.6 * CM))
  const midCut = (p: THREE.Vector3, u: THREE.Vector3, s: THREE.Vector3) => { const x = p.x + s.x; const lim = 2.2 * CM; if (Math.abs(x) < lim) p.x += (Math.sign(x || 1) * lim - x) }
  const withMid = (extra?: (p: THREE.Vector3, u: THREE.Vector3, s: THREE.Vector3) => void) => (p: THREE.Vector3, u: THREE.Vector3, s: THREE.Vector3) => { midCut(p, u, s); extra?.(p, u, s) }
  const L = (id: string, label: string, g: THREE.BufferGeometry, piv: [number, number, number]) => add(id, label, 'lungs', g, { opacity: 0.55, pivot: cmV(...piv) })
  L('lung.R.upper', 'Right lung: upper lobe', lobe([8.8, -2, -4.2], [5.4, 7, 7.2], PINK, 11, withMid()), [8.8, -2, -10])
  L('lung.R.middle', 'Right lung: middle lobe', lobe([8.4, 2.6, -12], [5, 4.8, 3.6], 0xeaa59c, 12, withMid()), [8.8, -2, -10])
  L('lung.R.lower', 'Right lung: lower lobe', lobe([8.8, -3.4, -15.5], [5.4, 6.8, 8.6], 0xe29c96, 13, withMid()), [8.8, -2, -10])
  L('lung.L.upper', 'Left lung: upper lobe', lobe([-9.2, -1.6, -6.5], [5.4, 7, 8.4], PINK, 21, withMid(heartCut)), [-8.8, -2, -10])
  L('lung.L.lingula', 'Left lung: lingula', lobe([-9.2, 3, -13.5], [3.8, 3.4, 3.6], 0xeaa59c, 22, withMid(heartCut)), [-8.8, -2, -10])
  L('lung.L.lower', 'Left lung: lower lobe', lobe([-8.8, -3.4, -15.5], [5.4, 6.8, 8.6], 0xe29c96, 23, withMid(heartCut)), [-8.8, -2, -10])

  // trachea with cartilage rings, main bronchi, then a branching tree inside each lung
  paths.trachea = spline([cmV(0, 0.4, 6.5), cmV(0, -0.2, 0), cmV(0, -0.9, -6.2)])
  const ring = (t: number) => (0.95 + 0.07 * Math.sin(t * 30 * Math.PI * 2)) * CM
  const airways: THREE.BufferGeometry[] = [variableTube(paths.trachea, ring, 150, 14, 0xb7d0d8)]
  const lungTree = (side: 1 | -1, seed: number) => {
    const root = cmV(0, -0.9, -6.2), hilum = cmV(side * 5.4, -1.6, -9.6)
    airways.push(variableTube(spline([root, cmV(side * 2.4, -1.2, -7.6), hilum]), () => (side === 1 ? 0.78 : 0.7) * CM, 24, 10, 0xb7d0d8))
    const lc = cmV(side * 8.8, -2, -10)
    const lobeBox = (p: THREE.Vector3) => ((p.x - lc.x) / (5.0 * CM)) ** 2 + ((p.y - lc.y) / (6.5 * CM)) ** 2 + ((p.z - lc.z) / (11 * CM)) ** 2 < 1
    for (const dir of [[side * 0.5, 0.2, 0.7], [side * 0.6, 0, -0.1], [side * 0.45, -0.1, -0.9], [side * 0.5, 0.5, -0.5]]) airways.push(...airwayTree(hilum, new THREE.Vector3(...(dir as [number, number, number])), 2.3 * CM, 0.5 * CM, 5, lobeBox, seed++, 0xb7d0d8))
  }
  lungTree(1, 100); lungTree(-1, 200)
  add('airways', 'Trachea and bronchi', 'lungs', merge(airways))
  paths.airwayFlow = spline([cmV(0, 0.4, 6.5), cmV(0, -0.9, -6.2), cmV(5.4, -1.6, -9.6), cmV(8.8, -2, -15)])

  // ================= diaphragm: two domes, a central tendon and the three openings ===================================================
  {
    const rows = 26, cols = 40, pos: number[] = [], col: number[] = [], idx: number[] = []
    const rim = -26.5, a = 14.6, b = 9.6
    for (let i = 0; i <= rows; i++) {
      const r = i / rows
      for (let j = 0; j <= cols; j++) {
        const th = (j / cols) * Math.PI * 2, x = a * r * Math.cos(th), y = b * r * Math.sin(th) - 0.8
        const dome = x >= 0 ? LAYOUT.diaphragmRightDome.c[2] : LAYOUT.diaphragmLeftDome.c[2]
        const z = dome + (rim - dome) * Math.pow(r, 2.1) - 0.8 * Math.cos(y * 0.35) * (1 - r)
        pos.push(...cmV(x, y, z).toArray())
        const tendon = Math.max(0, 1 - r * 2.6), c = new THREE.Color(0xb8584f).lerp(new THREE.Color(0xe6d6b8), Math.min(1, tendon * 1.4))
        col.push(c.r, c.g, c.b)
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const p = i * (cols + 1) + j, q = (i + 1) * (cols + 1) + j; idx.push(p, q, p + 1, q, q + 1, p + 1) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx)
    const ng = g.toNonIndexed(); g.dispose(); ng.computeVertexNormals()
    add('diaphragm', 'Diaphragm', 'diaphragm', ng, { opacity: 0.82, pivot: cmV(0, 0, rim) })
  }

  // ================= oesophagus ======================================================================================================
  paths.esophagus = spline([cmV(0, -0.8, 6), cmV(0, -2.2, -1), cmV(-0.2, -3.2, -7), cmV(-0.8, -3.4, -13), cmV(HIATUS.oesophageal.x, HIATUS.oesophageal.y, -20.5), cmV(-3.2, -1.2, -22.4)])
  add('esophagus', 'Oesophagus', 'esophagus', variableTube(paths.esophagus, (t) => (0.95 + 0.12 * Math.sin(t * 40)) * CM, 90, 12, 0xc9706e))

  // ================= liver, gallbladder ==============================================================================================
  {
    const [lx, ly, lz] = LAYOUT.liver.c, hx = 11 * CM, hy = 7.4 * CM, hz = 7 * CM
    add('liver', 'Liver', 'liver', blob(cmV(lx, ly, lz), [hx, hy, hz], 0x8d3b2c, {
      w: 44, h: 30, jitter: 0.06, seed: 31,
      fn: (p) => {
        const u = p.x / hx                                                    // -1 (left tip) .. +1 (right lobe)
        const taper = Math.max(0, Math.min(1, (0.15 - u) / 1.1))
        p.z *= 1 - 0.55 * taper; p.y *= 1 - 0.38 * taper
        const floor = -0.3 * hz
        if (p.z < floor) p.z = floor + (p.z - floor) * 0.3                      // flat, slightly hollow under-surface
        if (p.z < floor + 0.02 && Math.abs(u - 0.2) < 0.12) p.z += 0.5 * CM    // gallbladder/ligament groove
        p.y += 0.06 * hy * Math.sin(u * 3)
      },
    }))
    add('gallbladder', 'Gallbladder', 'gallbladder', merge([blob(cmV(8.6, 4.4, -29.4), [1.5 * CM, 1.5 * CM, 3.6 * CM], 0x4f8f45, { w: 16, h: 12, rot: new THREE.Euler(0.25, 0, 0.1), fn: (p) => { p.y *= 1 + 0.15 * Math.max(0, p.z / (3.6 * CM)) } }),
      variableTube(spline([cmV(7.4, 3.6, -26.8), cmV(5.8, 2.8, -27.8), cmV(4.2, 1.8, -30)]), () => 0.3 * CM, 12, 6, 0x6aa84f)]))
  }

  // ================= stomach, duodenum, pancreas, spleen ============================================================================
  const stomachPath = spline([cmV(-6.8, -3.4, -19.8), cmV(-8.2, -1.2, -24), cmV(-7.2, 2.2, -29.2), cmV(-3.6, 3.8, -32.2), cmV(0.4, 3.6, -31.2), cmV(2.6, 3.0, -29.2)])
  paths.stomach = stomachPath
  const sr = (t: number) => (t < 0.18 ? 2.3 + 2.6 * Math.sin(t / 0.18 * Math.PI / 2) : t < 0.55 ? 4.9 - (t - 0.18) * 2.4 : t < 0.9 ? 4.0 - (t - 0.55) * 4.8 : 2.3 - (t - 0.9) * 11) * CM
  add('stomach', 'Stomach', 'stomach', variableTube(stomachPath, (t) => Math.max(0.9 * CM, sr(t)), 80, 18, 0xdc8a6e, undefined, true))
  const duo = spline([cmV(2.6, 3.0, -29.2), cmV(5.6, 1.4, -31.0), cmV(6.4, -1.4, -35.4), cmV(4.2, -2.6, -40), cmV(-0.4, -3.2, -40.4), cmV(-2.2, -3.0, -35), cmV(-2.6, -2.4, -33.2)])
  paths.duodenum = duo
  add('duodenum', 'Duodenum', 'gut', variableTube(duo, (t) => (1.45 - 0.2 * t) * CM, 80, 12, 0xdfa27c))
  const panc = spline([cmV(4.4, 0.0, -35.5), cmV(1.8, 0.4, -32.4), cmV(-0.8, 0.2, -30.2), cmV(-5.4, -1.8, -29.4), cmV(-9.6, -3.4, -26.8)])
  const prng = rng(5)
  add('pancreas', 'Pancreas', 'pancreas', variableTube(panc, (t) => (1.2 + 1.4 * Math.exp(-((t - 0.1) ** 2) / 0.02) + 0.18 * Math.sin(t * 60) + 0.15 * prng() * 0) * CM * (t > 0.7 ? 1 - (t - 0.7) * 1.2 : 1), 80, 12, 0xe6c47c, (t) => new THREE.Color(0xe6c47c).multiplyScalar(0.92 + 0.08 * Math.sin(t * 90))))
  add('spleen', 'Spleen', 'spleen', blob(cmV(-12.4, -4.6, -24.5), [2.2 * CM, 5.2 * CM, 6 * CM], 0x6c2c4a, { w: 28, h: 20, jitter: 0.05, rot: new THREE.Euler(0.1, 0, -0.2), fn: (p) => { p.x += 1.3 * CM * (p.y / (5.2 * CM)) ** 2 * (p.x > 0 ? 1 : 0.3); if (p.x > 0.5 * CM && Math.abs(p.z) < 1.2 * CM) p.x -= 0.5 * CM } }))

  // ================= kidneys, adrenals, ureters ====================================================================================
  for (const side of [1, -1] as const) {
    const c = side === 1 ? LAYOUT.rightKidney.c : LAYOUT.leftKidney.c
    add(side === 1 ? 'kidney.R' : 'kidney.L', side === 1 ? 'Right kidney' : 'Left kidney', 'kidneys', blob(cmV(c[0], c[1], c[2]), [2.8 * CM, 1.7 * CM, 5.5 * CM], 0x8f3d3a, {
      w: 34, h: 24, jitter: 0.05, seed: 40 + side, rot: new THREE.Euler(0.18, -side * 0.12, 0),
      fn: (p) => {
        const mx = -side * p.x / (2.8 * CM)                                    // positive toward the midline
        if (mx > 0) p.x += side * 0.55 * CM * mx * Math.exp(-((p.z / (2.6 * CM)) ** 2)) * 1.6   // hilum indent
        p.y *= 1 + 0.15 * Math.max(0, -mx)
      },
    }))
    add(side === 1 ? 'adrenal.R' : 'adrenal.L', side === 1 ? 'Right adrenal gland' : 'Left adrenal gland', 'adrenals', blob(cmV(side * 5.4, -6.2, -26.6), [1.7 * CM, 0.7 * CM, 2.1 * CM], 0xe3b13c, { w: 16, h: 12, rot: new THREE.Euler(0, 0, side * 0.5), fn: (p) => { if (side === -1) p.y += 0.3 * CM * Math.sin(p.z / CM) } }))
    paths[side === 1 ? 'ureterR' : 'ureterL'] = spline([cmV(side * 5.0, -4.6, -34), cmV(side * 5.4, -5.6, -41), cmV(side * 5.2, -5.2, -47), cmV(side * 4.2, -1.4, -51.5), cmV(side * 3, 2.4, -53.6)])
  }
  add('ureters', 'Ureters', 'kidneys', merge([paths.ureterR, paths.ureterL].map((c) => variableTube(c, () => 0.3 * CM, 40, 6, 0xe8d98a))))
  add('bladder', 'Bladder', 'bladder', merge([blob(cmV(0, 3.6, -53.2), [3.7 * CM, 3.2 * CM, 3.4 * CM], 0xd99c92, { w: 26, h: 18, jitter: 0.04, fn: (p) => { if (p.z > 0) p.y += 0.4 * CM * p.z / (3.4 * CM); p.z *= p.z < 0 ? 0.9 : 1 } }),
    variableTube(spline([cmV(0, 3.0, -56.2), cmV(0, 2, -60)]), () => 0.5 * CM, 8, 8, 0xd99c92)]), { pivot: cmV(0, 3.6, -54.5) })

  // ================= small intestine (coiled, jejunum redder than ileum) and large intestine (framing it) ==========================
  {
    const r = rng(77), pts: THREE.Vector3[] = [cmV(-2.6, -2.4, -33.2)]
    const rows = 13
    for (let k = 0; k < rows; k++) {
      const z = -35.2 - k * 0.95, dir = k % 2 === 0 ? 1 : -1, span = 8.4 - Math.abs(k - 6) * 0.35
      for (let i = 0; i <= 8; i++) {
        const f = i / 8, x = dir * (-span + 2 * span * f) * (k < 4 ? 0.9 : 1) + (k < 6 ? -1.6 : 1.2)
        pts.push(cmV(x, 3.6 + Math.sin(f * Math.PI * 3 + k) * 1.7 + (r() - 0.5) * 1.0, z + Math.sin(f * Math.PI * 2 + k * 0.7) * 0.9 + (r() - 0.5) * 0.4))
      }
    }
    pts.push(cmV(7.6, 0.6, -44.4))
    paths.smallBowel = spline(pts, 0.35)
    const early = new THREE.Color(0xe39a8c), late = new THREE.Color(0xeab9a4)
    add('smallBowel', 'Small intestine', 'gut', variableTube(paths.smallBowel, (t) => (1.15 - 0.2 * t + 0.07 * Math.sin(t * 700)) * CM, 700, 10, 0xe39a8c, (t) => early.clone().lerp(late, t)))
  }
  {
    const cp = [cmV(8.6, 2.2, -45.8), cmV(11, 1.4, -41), cmV(11.8, 0.2, -35), cmV(11.2, -1.4, -30), cmV(7.4, 5.2, -32.4), cmV(2, 6.4, -35.6), cmV(-3.6, 6.2, -36.2), cmV(-8.6, 4, -31.2), cmV(-11.6, -1.2, -27.6),
      cmV(-12.8, -2, -33), cmV(-12.4, -1.6, -41), cmV(-10, 2, -47), cmV(-5, 3.6, -50.2), cmV(-7, 0.6, -53.4), cmV(-2.4, -2.2, -52.6), cmV(0.4, -6.2, -52.4), cmV(0.2, -8.2, -58), cmV(0, -8.4, -63)]
    paths.colon = spline(cp, 0.4)
    const rr = (t: number) => (t < 0.55 ? 2.5 : t < 0.7 ? 2.0 : t < 0.88 ? 1.9 : 2.3 - (t - 0.88) * 8) * CM * (1 + 0.1 * Math.sin(t * 190))
    add('colon', 'Large intestine', 'gut', variableTube(paths.colon, rr, 360, 14, 0xd49d7e, (t) => new THREE.Color(0xd49d7e).lerp(new THREE.Color(0xb98a6c), t)))
    add('appendix', 'Appendix', 'gut', variableTube(spline([cmV(8.6, 1.2, -46.6), cmV(6.8, 0.4, -49.5), cmV(5.6, 1.5, -51.5)]), () => 0.34 * CM, 14, 6, 0xd49d7e))
  }

  // ================= abdominal vessels: renal, celiac and mesenteric branches, iliacs, the inferior cava below the diaphragm =======
  {
    const A = (zz: number) => cmV(-1.4, spineY(zz) + 2.0, zz)
    const v: THREE.BufferGeometry[] = []
    const celiac = spline([A(-27), cmV(-0.8, 1.6, -27.4), cmV(-4, 0.4, -27.0)]), sma = spline([A(-30), cmV(-1.2, 1.0, -33), cmV(1.2, 2.6, -38)])
    v.push(variableTube(celiac, () => 0.42 * CM, 14, 6, RED), variableTube(sma, () => 0.48 * CM, 18, 6, RED))
    v.push(variableTube(spline([A(-32), cmV(-4.8, -4.8, -32.6), cmV(-6.8, -5.4, -33)]), () => 0.4 * CM, 14, 6, RED), variableTube(spline([A(-32.6), cmV(1.4, -5.2, -33.4), cmV(5.8, -5.2, -34)]), () => 0.4 * CM, 14, 6, RED))
    v.push(variableTube(spline([cmV(3.6, spineY(-33) + 1.8, -33.2), cmV(5.2, -5, -33.8)]), () => 0.5 * CM, 14, 6, BLUE), variableTube(spline([cmV(2.4, spineY(-33) + 1.8, -33.2), cmV(-2, -5, -32.6), cmV(-6.2, -5.6, -33.2)]), () => 0.5 * CM, 14, 6, BLUE))
    for (const s of [-1, 1]) {
      v.push(variableTube(spline([cmV(-0.8, spineY(-39) + 2.2, -38.5), cmV(s * 4.5, spineY(-42) + 2, -44), cmV(s * 8, -2, -52), cmV(s * 9, 0, -60)]), (t) => (0.85 - 0.3 * t) * CM, 30, 8, RED))
      v.push(variableTube(spline([cmV(1.8, spineY(-38) + 1.6, -41), cmV(s * 4.8, spineY(-42) + 1.6, -44.4), cmV(s * 8.2, -1.6, -52.5), cmV(s * 9.2, 0.4, -60)]), (t) => (0.9 - 0.3 * t) * CM, 30, 8, BLUE))
    }
    add('vessels.abdominal', 'Abdominal vessels', 'kidneys', merge(v))
    paths.arteries = spline([cmV(-1.2, 1.5, -8), cmV(-0.4, -3, -5), cmV(-2.6, spineY(-22) + 1.8, -22), cmV(-0.8, spineY(-39) + 2.2, -38.5), cmV(8, -2, -52)])
  }

  return { parts, paths, heartNodes: { sa, av, apex } }
}

/** Left and right ribcage helpers re-exported for the scene (kept here so the scene imports one module for layout). */
export const THORAX = { halfWidth: ribHalfWidth, halfDepth: ribHalfDepth, T8: vertZ('T8'), T10: vertZ('T10'), T12: vertZ('T12') }
void paint
