// A schematic brain for the 3D view: two folded hemispheres (procedural folds, central and lateral grooves), a cerebellum
// and a brainstem. It is NOT anatomical or MRI-based. Pure geometry so it can be tested without a browser.

import * as THREE from 'three'

export type Lobe = 'frontal' | 'parietal' | 'temporal' | 'occipital'
export type LobeWeights = Record<Lobe, number>
export const LOBE_RGB: Record<Lobe | 'base', [number, number, number]> = {
  frontal: [215, 166, 184], parietal: [169, 199, 176], temporal: [224, 188, 142], occipital: [169, 168, 214], base: [217, 169, 163],
}

const hash = (x: number, y: number, z: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf), l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  )
}
function ridge(x: number, y: number, z: number) {
  let a = 0, f = 1, amp = 1, s = 0
  for (let o = 0; o < 3; o++) { const n = 1 - Math.abs(2 * vnoise(x * f, y * f, z * f) - 1); a += n * n * amp; s += amp; f *= 2.1; amp *= 0.5 }
  return a / s
}
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Soft membership of a cortex point in each lobe (x right, y front, z up). Weights sum to 1. */
export function lobeWeights(p: [number, number, number]): LobeWeights {
  const wf = smooth(0.18, 0.42, p[1]), wo = smooth(-0.42, -0.62, p[1])
  const wt = smooth(0.12, -0.06, p[2]) * smooth(0.26, 0.4, Math.abs(p[0])) * (1 - wf) * (1 - wo)
  const wp = Math.max(0, 1 - wf - wo - wt)
  return { frontal: wf, occipital: wo, temporal: wt, parietal: wp }
}
export function lobeAt(p: [number, number, number]): Lobe {
  const w = lobeWeights(p)
  return (Object.entries(w) as [Lobe, number][]).sort((a, b) => b[1] - a[1])[0][0]
}

export interface Hemisphere {
  geometry: THREE.BufferGeometry
  /** vertex positions (x, y, z per vertex) */
  P: Float32Array
  /** vertex colours, updated by the caller */
  C: Float32Array
  lobes: LobeWeights[]
  n: number
}

/** side = +1 right, -1 left. */
export function hemisphere(side: 1 | -1, detail = 30): Hemisphere {
  const src = new THREE.IcosahedronGeometry(1, detail), pos = src.attributes.position
  const map = new Map<string, number>(), verts: number[] = [], idx: number[] = []
  for (let i = 0; i < pos.count; i++) {      // weld duplicate vertices so normals are smooth
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
    let j = map.get(k)
    if (j === undefined) { j = verts.length / 3; map.set(k, j); verts.push(x, y, z) }
    idx.push(j)
  }
  src.dispose()
  const n = verts.length / 3, P = new Float32Array(n * 3), C = new Float32Array(n * 3), lobes: LobeWeights[] = []
  for (let i = 0; i < n; i++) {
    let dx = verts[i * 3], dy = verts[i * 3 + 1], dz = verts[i * 3 + 2]
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l
    const medial = dx * side < 0                               // the wall that faces the other hemisphere
    const rx = 0.52, ry = 1.04 - 0.03 * Math.max(0, -dy), rz = dz < 0 ? 0.5 : 0.74
    const fold = ridge(dx * 2.2 + side * 3, dy * 2.2, dz * 2.2)
    let d = 0.075 * (fold - 0.38) * (medial ? 0.25 : 1) * (dz < -0.35 ? 0.5 : 1)
    // central sulcus (slanted groove across the top) and lateral / Sylvian fissure (groove along the side)
    const cx = dy - (0.08 - 0.3 * (dz - 0.3)); d -= 0.05 * Math.exp(-(cx * cx) / 0.0016) * smooth(0.0, 0.3, dz) * (medial ? 0.2 : 1)
    const sy = dz - (-0.1 + 0.12 * dy); d -= 0.055 * Math.exp(-(sy * sy) / 0.0025) * smooth(0.25, 0.5, Math.abs(dx)) * smooth(-0.55, -0.2, dy)
    const k = 1 + d
    const px = medial ? side * (0.43 - 0.38 * (1 - Math.pow(1 - Math.abs(dx), 3)) * k) : side * 0.43 + rx * dx * k
    const py = ry * dy * k, pz = 0.02 + rz * dz * k
    P[i * 3] = px; P[i * 3 + 1] = py; P[i * 3 + 2] = pz
    lobes.push(lobeWeights([px, py, pz]))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(P, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(C, 3))
  geometry.setIndex(idx)
  geometry.computeVertexNormals()
  return { geometry, P, C, lobes, n }
}

/** Cerebellum (ridged folia) and a short brainstem. */
export function cerebellumGeometry() {
  const g = new THREE.SphereGeometry(1, 64, 48), p = g.attributes.position, c = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = 1 + 0.035 * Math.sin(z * 34 + x * 3), s = 0.9 + 0.1 * Math.sin(z * 34)
    p.setXYZ(i, x * 0.58 * r, y * 0.34 * r - 0.74, z * 0.3 * r - 0.46)
    c.set([0.62 * s, 0.5 * s, 0.5 * s], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals()
  return g
}
