// Bones and limb muscles for the detailed body. Procedural, no outside mesh files. Positions come from anatomy.ts.

import * as THREE from 'three'
import { CANAL_BEHIND, RIBS, type RibSpec, STERNUM, VERTEBRAE, ribHalfDepth, ribHalfWidth, spineY, vertZ } from './anatomy.ts'
import { blob, cmV, merge, paint, spindle, spline, variableTube } from './body-geom.ts'

const BONE = 0xe9dfc9, CARTILAGE = 0xa9c9c9, DISC = 0x9b8f84
const CM = 1 / 15

/** Centre line of one rib from the spine round to the front, as scene points. `lift` shifts it up or down (cm), e.g. to follow the groove under the rib. */
export function ribPath(rib: RibSpec, side: -1 | 1, lift = 0, samples = 26): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const phiMax = rib.attaches === 'sternum' ? Math.PI * 0.985 : rib.attaches === 'margin' ? Math.PI * (0.93 - (rib.n - 8) * 0.045) : Math.PI * 0.5
  for (let i = 0; i <= samples; i++) {
    const phi = 0.14 + (phiMax - 0.14) * (i / samples)
    const zMid = rib.zBack - rib.drop * 0.5
    const a = ribHalfWidth(zMid), b = ribHalfDepth(zMid)
    const f = Math.pow(phi / Math.PI, 1.15)
    const z = rib.zBack - rib.drop * f + 0.9 * Math.sin(Math.min(phi, Math.PI * 0.4) / 0.4 * Math.PI * 0.5) * (rib.n < 11 ? 1 : 0.4) + lift
    const x = side * (a * Math.sin(phi) * 0.96 + (phi < 0.4 ? 2.4 * (1 - phi / 0.4) : 0))
    pts.push(cmV(x, -b * Math.cos(phi), z))
  }
  return pts
}

/** Ribs (bone and cartilage), breastbone and collarbones. */
export function ribcageGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const rib of RIBS) for (const side of [-1, 1] as const) {
    const N = 26, pts = ribPath(rib, side, 0, N)
    const cut = Math.round(N * (1 - rib.cartilage))
    const bone = spline(pts.slice(0, cut + 1)), cart = spline(pts.slice(cut))
    parts.push(variableTube(bone, () => 0.43 * CM, 28, 6, BONE))
    if (rib.cartilage > 0.15) parts.push(variableTube(cart, () => 0.48 * CM, 10, 6, CARTILAGE))
    else parts.push(variableTube(cart, () => 0.38 * CM, 6, 6, BONE))
  }
  // breastbone: manubrium, body, xiphoid process
  const front = (z: number) => ribHalfDepth(z) - 0.4
  parts.push(blob(cmV(0, front(-2.5), -2.6), [2.7 * CM, 0.55 * CM, 2.7 * CM], BONE))
  parts.push(blob(cmV(0, front(-10), -10.2), [1.8 * CM, 0.5 * CM, 5.3 * CM], BONE))
  parts.push(blob(cmV(0, front(-17.5), -17.8), [0.8 * CM, 0.4 * CM, 1.7 * CM], CARTILAGE))
  void STERNUM
  // collarbones
  for (const s of [-1, 1]) {
    const c = spline([cmV(s * 1.5, 3.8, -0.8), cmV(s * 6, 4.4, -1.6), cmV(s * 12, 2.2, -2.6), cmV(s * 17.8, -1.6, -3.4)])
    parts.push(variableTube(c, spindle(0.62 * CM, 0.5 * CM, 0.4), 18, 8, BONE))
  }
  return merge(parts)
}

/** Vertebrae with discs, the sacrum and the coccyx. */
export function spineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  VERTEBRAE.forEach((name, i) => {
    const z = vertZ(name), y = spineY(z)
    const t = i / (VERTEBRAE.length - 1)                       // 0 neck .. 1 lower back
    const w = (name[0] === 'C' ? 1.6 + i * 0.12 : name[0] === 'T' ? 1.7 + (i - 7) * 0.09 : 2.4 + (i - 19) * 0.12) // half width of the body (cm)
    const d = name[0] === 'C' ? 0.95 : name[0] === 'T' ? 1.3 + t * 0.3 : 1.8
    const h = name[0] === 'C' ? 0.65 : name[0] === 'T' ? 1.0 : 1.3
    parts.push(blob(cmV(0, y, z), [w * CM, d * CM, h * CM], BONE, { w: 16, h: 10 }))
    parts.push(blob(cmV(0, y, z - h - 0.18), [(w - 0.2) * CM, (d - 0.15) * CM, 0.3 * CM], DISC, { w: 14, h: 8 }))
    const canalY = y - CANAL_BEHIND
    // neural arch: two pedicles and laminae around the canal, spinous process and transverse processes
    const arch = spline([cmV(w * 0.55, y - d * 0.6, z), cmV(w * 0.9, canalY + 0.4, z + 0.1), cmV(w * 0.55, canalY - 1.5, z + 0.2), cmV(0, canalY - 1.7, z + 0.25), cmV(-w * 0.55, canalY - 1.5, z + 0.2), cmV(-w * 0.9, canalY + 0.4, z + 0.1), cmV(-w * 0.55, y - d * 0.6, z)])
    parts.push(variableTube(arch, () => 0.38 * CM, 22, 6, BONE))
    const sp = (name[0] === 'T' ? 2.4 : 1.8)
    parts.push(variableTube(spline([cmV(0, canalY - 1.7, z + 0.25), cmV(0, canalY - 1.7 - sp * 0.6, z - sp * (name[0] === 'T' ? 0.5 : 0.1))]), spindle(0.35 * CM, 0.2 * CM, 0.5), 5, 6, BONE))
    for (const s of [-1, 1]) parts.push(variableTube(spline([cmV(s * w * 0.9, canalY + 0.4, z + 0.1), cmV(s * (w + (name[0] === 'L' ? 3.2 : 2.6)), canalY - 0.4, z + 0.1)]), () => 0.3 * CM, 4, 6, BONE))
  })
  // sacrum and coccyx
  const zs = vertZ('S1')
  parts.push(blob(cmV(0, spineY(zs) - 1.2, zs - 5), [4.6 * CM, 1.6 * CM, 6.2 * CM], BONE, { fn: (p) => { p.y -= 0.35 * (p.z + 6.2 * CM) / (6.2 * CM) * 0.3; p.x *= 1 - 0.3 * Math.max(0, -p.z / (6.2 * CM)) } }))
  parts.push(blob(cmV(0, spineY(vertZ('Coccyx')) - 1.4, vertZ('Coccyx') + 1), [1 * CM, 0.8 * CM, 2 * CM], BONE))
  return merge(parts)
}

/** The hip bones: iliac wings, sit bones and the pubic arch. */
export function pelvisGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const s of [-1, 1]) {
    parts.push(blob(cmV(s * 11.8, -2.2, -45.5), [1.8 * CM, 8 * CM, 8 * CM], BONE, { rot: new THREE.Euler(0, s * 0.55, s * -0.1), fn: (p) => { p.z += 0.01 * Math.abs(p.x) } }))
    parts.push(variableTube(spline([cmV(s * 8, -7, -52), cmV(s * 13, -2, -56.5), cmV(s * 11.5, 5.5, -58), cmV(s * 5, 8.3, -57.5), cmV(s * 0.9, 9, -56)]), () => 1.05 * CM, 22, 8, BONE))
    parts.push(blob(cmV(s * 9.2, -5, -57.5), [2.4 * CM, 2.4 * CM, 2.4 * CM], BONE))
  }
  return merge(parts)
}

export interface Limb { bones: THREE.BufferGeometry; muscle: THREE.BufferGeometry }
/** One arm or leg with its bones and the main muscle bellies. side: -1 left, +1 right. */
export function limbGeometry(kind: 'arm' | 'leg', side: -1 | 1): Limb {
  const bones: THREE.BufferGeometry[] = [], muscles: THREE.BufferGeometry[] = []
  const MUSCLE = 0xc0443e, TENDON = 0xdcc9b0
  const belly = (a: THREE.Vector3, b: THREE.Vector3, r: number, bulge = 0.45, color: THREE.ColorRepresentation = MUSCLE) => {
    const c = spline([a, a.clone().lerp(b, 0.5), b]); muscles.push(variableTube(c, (t) => (0.18 + 0.82 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), bulge)) * r, 22, 10, color, (t) => new THREE.Color(color).lerp(new THREE.Color(TENDON), Math.pow(Math.abs(t - 0.5) * 2, 3) * 0.7)))
  }
  const joint = (p: THREE.Vector3, r: number) => bones.push(blob(p, [r, r, r], BONE, { w: 14, h: 10 }))
  const off = (v: THREE.Vector3, x: number, y: number, z: number) => v.clone().add(new THREE.Vector3(x * CM, y * CM, z * CM))
  if (kind === 'arm') {
    const sh = cmV(side * 18, 0, -6), el = cmV(side * 21.5, 0.5, -36), wr = cmV(side * 24, 1.2, -58), hand = cmV(side * 24.8, 1.6, -63.5)
    bones.push(variableTube(spline([sh, el]), spindle(1.0 * CM, 0.8 * CM, 0.3), 12, 8, BONE))
    bones.push(variableTube(spline([off(el, 0.6, 0, 0), off(wr, 0.5, 0, 0)]), () => 0.55 * CM, 10, 6, BONE), variableTube(spline([off(el, -0.6, 0.3, 0), off(wr, -0.6, 0, 0)]), () => 0.45 * CM, 10, 6, BONE))
    joint(sh, 1.8 * CM); joint(el, 1.3 * CM); joint(wr, 1.0 * CM)
    bones.push(blob(hand, [3.2 * CM, 1.1 * CM, 5.5 * CM], BONE))
    // deltoid, biceps (front), triceps (back), forearm flexors
    belly(off(sh, side * 1.2, 0, 1), off(sh, side * 2.5, 0, -15), 3.4 * CM, 0.5)
    belly(off(sh, side * 0.4, 1.8, -3), off(el, 0, 1.4, 2), 2.5 * CM, 0.6)
    belly(off(sh, side * 0.4, -1.8, -3), off(el, 0, -1.6, 2), 2.6 * CM, 0.6)
    belly(off(el, 0, 0.6, -2), off(wr, 0, 0.6, 3), 2.2 * CM, 0.5)
    belly(off(el, 0, -0.9, -2), off(wr, 0, -0.9, 3), 1.9 * CM, 0.5)
  } else {
    const hip = cmV(side * 9, 0, -51), kn = cmV(side * 9.6, 1.6, -94), an = cmV(side * 9.6, 0.4, -137), ft = cmV(side * 9.7, 7, -141)
    bones.push(variableTube(spline([hip, kn]), spindle(1.35 * CM, 1.1 * CM, 0.3), 14, 8, BONE))
    bones.push(variableTube(spline([kn, an]), spindle(1.1 * CM, 0.8 * CM, 0.3), 14, 8, BONE), variableTube(spline([off(kn, side * 1.6, -0.3, -3), off(an, side * 1.4, -0.3, 2)]), () => 0.4 * CM, 10, 6, BONE))
    joint(hip, 2.4 * CM); joint(kn, 2.2 * CM); joint(an, 1.3 * CM)
    bones.push(blob(ft, [3.4 * CM, 10 * CM, 2.3 * CM], BONE))
    // quadriceps, hamstrings, calf, shin muscle
    belly(off(hip, 0, 2.6, -4), off(kn, 0, 2.4, 3), 5.8 * CM, 0.5)
    belly(off(hip, 0, -2.4, -4), off(kn, 0, -2.4, 3), 5.4 * CM, 0.5)
    belly(off(kn, 0, -2.2, -5), off(an, 0, -1.6, 10), 4.2 * CM, 0.55)
    belly(off(kn, side * 1.4, 1.6, -7), off(an, side * 1.2, 1.4, 8), 2.6 * CM, 0.5)
  }
  return { bones: merge(bones), muscle: merge(muscles) }
}

/** The skin outline of the trunk as a see-through shell (stacked ellipses). */
export function trunkShell(halfWidth: (z: number) => number, halfDepth: (z: number) => number): THREE.BufferGeometry {
  const rings = 44, seg = 36, pos: number[] = [], idx: number[] = []
  const z0 = 3, z1 = -60
  for (let i = 0; i <= rings; i++) {
    const z = z0 + (z1 - z0) * (i / rings), a = halfWidth(z), b = halfDepth(z)
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2
      pos.push(...cmV(a * Math.sin(th), b * Math.cos(th), z).toArray())
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = (i + 1) * (seg + 1) + j; idx.push(a, b, a + 1, b, b + 1, a + 1) }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  return paint(g, 0xb9bec2)
}
