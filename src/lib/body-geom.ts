// Procedural shape helpers for the detailed body. Every organ is built from tubes and deformed ellipsoids so no outside mesh
// files (and no outside licences) are involved. All geometry is non-indexed with a per-vertex colour so one organ is one mesh.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sceneOf, type Vec } from './anatomy.ts'

export const V = (v: Vec) => new THREE.Vector3(v[0], v[1], v[2])
/** A point given in body centimetres, as a scene vector. */
export const cmV = (x: number, y: number, z: number) => V(sceneOf(x, y, z))

export function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, r: () => number = Math.random): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  const n = g.attributes.position.count, base = new THREE.Color(color), arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const k = jitter ? 1 + (r() - 0.5) * jitter : 1
    arr[i * 3] = Math.min(1, base.r * k); arr[i * 3 + 1] = Math.min(1, base.g * k); arr[i * 3 + 2] = Math.min(1, base.b * k)
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  if (g !== geo) geo.dispose()
  return g
}

/** Join painted parts into one geometry (all parts must carry a colour attribute). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name)
    if (!g.attributes.normal) g.computeVertexNormals()
    if (!g.attributes.color) paint(g, 0xffffff)
    return g
  })
  const out = mergeGeometries(clean, false)
  if (!out) throw new Error('could not merge geometry')
  return out
}

/** A tube of changing radius along a curve (for the gut, vessels, nerves). radius(t) is in scene units, t runs 0..1. */
export function variableTube(curve: THREE.Curve<THREE.Vector3>, radius: (t: number) => number, tubular = 64, radial = 10, color: THREE.ColorRepresentation = 0xffffff, colorAt?: (t: number) => THREE.Color, capped = true): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubular, false)
  const pos: number[] = [], col: number[] = [], idx: number[] = []
  const base = new THREE.Color(color)
  const ring = (i: number) => {
    const t = i / tubular, P = curve.getPointAt(t), N = frames.normals[i], B = frames.binormals[i], r = Math.max(0.0005, radius(t))
    const c = colorAt ? colorAt(t) : base
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, s = Math.sin(a), co = Math.cos(a)
      pos.push(P.x + r * (co * N.x + s * B.x), P.y + r * (co * N.y + s * B.y), P.z + r * (co * N.z + s * B.z))
      col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i <= tubular; i++) ring(i)
  for (let i = 0; i < tubular; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  if (capped) {
    for (const end of [0, tubular]) {
      const P = curve.getPointAt(end / tubular), c = colorAt ? colorAt(end / tubular) : base, ci = pos.length / 3
      pos.push(P.x, P.y, P.z); col.push(c.r, c.g, c.b)
      for (let j = 0; j < radial; j++) { const a = end * (radial + 1) + j; if (end === 0) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1) }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx)
  const out = g.toNonIndexed(); g.dispose(); out.computeVertexNormals(); return out
}

/** A sphere scaled to the given half-sizes and then reshaped by fn (which receives the point and its unit direction). */
export function blob(center: THREE.Vector3, half: Vec, color: THREE.ColorRepresentation, opts: { w?: number; h?: number; jitter?: number; fn?: (p: THREE.Vector3, u: THREE.Vector3) => void; rot?: THREE.Euler; seed?: number } = {}): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, opts.w ?? 28, opts.h ?? 20)
  const p = new THREE.Vector3(), u = new THREE.Vector3(), pos = g.attributes.position as THREE.BufferAttribute
  const m = new THREE.Matrix4().makeRotationFromEuler(opts.rot ?? new THREE.Euler())
  for (let i = 0; i < pos.count; i++) {
    u.fromBufferAttribute(pos, i); p.set(u.x * half[0], u.y * half[1], u.z * half[2])
    opts.fn?.(p, u)
    p.applyMatrix4(m).add(center); pos.setXYZ(i, p.x, p.y, p.z)
  }
  g.computeVertexNormals()
  return paint(g, color, opts.jitter ?? 0, rng(opts.seed ?? 1))
}

/** A curve through points (scene units). */
export const spline = (pts: THREE.Vector3[], tension = 0.5) => new THREE.CatmullRomCurve3(pts, false, 'catmullrom', tension)

/** A smooth swelling-and-tapering profile: radius at t for a muscle belly or a spindle-shaped organ. */
export const spindle = (rMid: number, rEnd: number, power = 1.6) => (t: number) => rEnd + (rMid - rEnd) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), power)

/** A branching airway tree inside a volume: each generation is shorter and narrower. Returns tube parts (already painted). */
export function airwayTree(root: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number, inside: (p: THREE.Vector3) => boolean, seed: number, color: THREE.ColorRepresentation): THREE.BufferGeometry[] {
  const r = rng(seed), parts: THREE.BufferGeometry[] = []
  const grow = (p: THREE.Vector3, d: THREE.Vector3, len: number, rad: number, gen: number) => {
    const q = p.clone().addScaledVector(d, len)
    if (gen > 0 && !inside(q)) return
    const curve = new THREE.LineCurve3(p, q)
    parts.push(variableTube(curve, (t) => rad * (1 - 0.15 * t), 4, 6, color, undefined, false))
    if (gen >= depth) return
    const axis = new THREE.Vector3().crossVectors(d, new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5)).normalize()
    if (!isFinite(axis.x)) return
    const spread = 0.45 + r() * 0.35
    for (const s of [-1, 1]) {
      const nd = d.clone().applyAxisAngle(axis, s * spread * (0.8 + r() * 0.4)).add(new THREE.Vector3(0, 0, -0.12)).normalize()
      grow(q, nd, len * (0.72 + r() * 0.1), rad * 0.74, gen + 1)
    }
  }
  grow(root, dir.normalize(), length, radius, 0)
  return parts
}
