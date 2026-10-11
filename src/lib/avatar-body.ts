// The walking avatar's body, built entirely in code (no downloaded models, so there is nothing to license): a skeleton of 21 bones, a single smooth
// skinned surface lofted from anatomical cross-sections (torso, neck, head, arms, hands, legs, feet), simple clothes, eyes with eyelids and gaze,
// brows, nose, lips, ears and hair. Heights are in metres, the figure faces +Z and stands on Y = 0 at about 1.72 m.
// The geometry builders need only three.js (they run in Node for tests); textures need a browser canvas and are skipped without one.

import * as THREE from 'three'
import type { Pose } from './avatar-motion.ts'

export const BUILDS = ['neutral', 'feminine', 'masculine'] as const
export type Build = (typeof BUILDS)[number]
export const HEIGHT = 1.72

interface Shape { sw: number; hw: number; waist: number; chest: number; hips: number; legs: number; arms: number; hairLong: boolean }
const SHAPES: Record<Build, Shape> = {
  neutral: { sw: 1, hw: 1, waist: 1, chest: 1, hips: 1, legs: 1, arms: 1, hairLong: false },
  feminine: { sw: 0.92, hw: 1.06, waist: 0.86, chest: 1.1, hips: 1.1, legs: 0.97, arms: 0.9, hairLong: true },
  masculine: { sw: 1.1, hw: 0.97, waist: 1.04, chest: 1.04, hips: 0.96, legs: 1.04, arms: 1.12, hairLong: false },
}

// ---- skeleton ---------------------------------------------------------------------------------------------------------------------------
export const BONE_NAMES = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'clavL', 'armL', 'foreL', 'handL', 'clavR', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR',
] as const
export type BoneName = (typeof BONE_NAMES)[number]
const PARENT: Record<BoneName, BoneName | null> = {
  pelvis: null, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', armL: 'clavL', foreL: 'armL', handL: 'foreL', clavR: 'chest', armR: 'clavR', foreR: 'armR', handR: 'foreR',
  thighL: 'pelvis', shinL: 'thighL', footL: 'shinL', toeL: 'footL', thighR: 'pelvis', shinR: 'thighR', footR: 'shinR', toeR: 'footR',
}

/** Rest-pose joint positions in world space. Left is +X. */
export function restJoints(s: Shape): Record<BoneName, THREE.Vector3> {
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z)
  const sh = 0.168 * s.sw, hip = 0.09 * s.hw
  const j = {
    pelvis: v(0, 0.97), spine: v(0, 1.07), chest: v(0, 1.22), neck: v(0, 1.46), head: v(0, 1.56),
    clavL: v(0.03, 1.42), armL: v(sh, 1.388), foreL: v(sh + 0.06, 1.11), handL: v(sh + 0.1, 0.862), toeL: v(hip + 0.005, 0.03, 0.14),
    thighL: v(hip, 0.93), shinL: v(hip + 0.005, 0.5), footL: v(hip + 0.005, 0.085),
  }
  const mirror = (p: THREE.Vector3) => v(-p.x, p.y, p.z)
  return {
    ...j, clavR: mirror(j.clavL), armR: mirror(j.armL), foreR: mirror(j.foreL), handR: mirror(j.handL), thighR: mirror(j.thighL), shinR: mirror(j.shinL), footR: mirror(j.footL), toeR: mirror(j.toeL),
  } as Record<BoneName, THREE.Vector3>
}

export function buildSkeleton(s: Shape) {
  const world = restJoints(s)
  const bones = {} as Record<BoneName, THREE.Bone>
  for (const n of BONE_NAMES) { bones[n] = new THREE.Bone(); bones[n].name = n }
  for (const n of BONE_NAMES) {
    const p = PARENT[n]
    bones[n].position.copy(p ? world[n].clone().sub(world[p]) : world[n])
    if (p) bones[p].add(bones[n])
  }
  return { bones, world, skeleton: new THREE.Skeleton(BONE_NAMES.map((n) => bones[n])) }
}

// ---- lofting helpers --------------------------------------------------------------------------------------------------------------------
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** A smooth value curve through evenly spaced control values (Catmull-Rom), t in 0..1. */
export function prof(vals: number[]) {
  const n = vals.length - 1
  return (t: number) => {
    const f = Math.min(n - 1e-9, Math.max(0, t * n)), i = Math.floor(f), u = f - i
    const p0 = vals[Math.max(0, i - 1)], p1 = vals[i], p2 = vals[i + 1], p3 = vals[Math.min(n, i + 2)]
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  }
}

type Weights = [number, number][]
const boneIndex = (n: BoneName) => BONE_NAMES.indexOf(n)

/** Skin weights along a chain of joints: each bone owns the stretch between its joint and the next, blended smoothly across each joint. */
export function chainWeights(p: THREE.Vector3, joints: THREE.Vector3[], bones: BoneName[], blend: number): Weights {
  let best = Infinity, arc = 0, run = 0
  const segLen: number[] = []
  for (let i = 0; i < joints.length - 1; i++) {
    const a = joints[i], b = joints[i + 1], ab = b.clone().sub(a), len = ab.length(); segLen.push(len)
    const k = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / (len * len))), d = a.clone().addScaledVector(ab, k).distanceToSquared(p)
    if (d < best) { best = d; arc = run + k * len }
    run += len
  }
  const joint: number[] = []
  let acc = 0
  for (let i = 0; i < segLen.length - 1; i++) { acc += segLen[i]; joint.push(acc) }
  // bone i is "owned" up to joint i; weight to the next bone grows across the blend zone
  const w = bones.map(() => 0)
  let rest = 1
  for (let i = 0; i < joint.length; i++) { const next = smooth(joint[i] - blend, joint[i] + blend, arc); w[i] += rest * (1 - next); rest *= next }
  w[bones.length - 1] += rest
  return bones.map((b, i) => [boneIndex(b), w[i]] as [number, number]).filter((x) => x[1] > 1e-4)
}

const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z)

class Parts {
  pos: number[] = []; uv: number[] = []; idx: number[] = []; sk: number[] = []; sw: number[] = []
  private seams: [number, number][] = []

  add(o: {
    pts: THREE.Vector3[]; ra: (t: number) => number; rb: (t: number) => number; up: THREE.Vector3; rings: number; radial?: number
    range?: [number, number]; shift?: (t: number) => [number, number]; weights: (p: THREE.Vector3) => Weights; capStart?: boolean; capEnd?: boolean; grow?: number; mult?: number
  }) {
    const radial = o.radial ?? 24, [t0, t1] = o.range ?? [0, 1], grow = o.grow ?? 0, mult = o.mult ?? 1
    const curve = new THREE.CatmullRomCurve3(o.pts, false, 'centripetal')
    const base = this.pos.length / 3
    const centres: THREE.Vector3[] = []
    for (let r = 0; r <= o.rings; r++) {
      const t = t0 + ((t1 - t0) * r) / o.rings
      const c = curve.getPoint(t), tan = curve.getTangent(t).normalize()
      const a = new THREE.Vector3().crossVectors(tan, o.up).normalize(), b = new THREE.Vector3().crossVectors(tan, a).normalize()
      const [dx, dz] = o.shift ? o.shift(t) : [0, 0]
      c.x += dx; c.z += dz; centres.push(c.clone())
      const ra = o.ra(t) * mult + grow, rb = o.rb(t) * mult + grow
      for (let k = 0; k <= radial; k++) {
        const th = (k / radial) * Math.PI * 2
        const p = c.clone().addScaledVector(a, ra * Math.cos(th)).addScaledVector(b, rb * Math.sin(th))
        this.push(p, k / radial, t * 3, o.weights(p))
      }
    }
    const row = radial + 1
    for (let r = 0; r < o.rings; r++) for (let k = 0; k < radial; k++) {
      const i = base + r * row + k
      this.idx.push(i, i + row, i + 1, i + 1, i + row, i + row + 1)
    }
    for (let r = 0; r <= o.rings; r++) this.seams.push([base + r * row, base + r * row + radial])
    const cap = (ringIndex: number, flip: boolean) => {
      const c = centres[ringIndex], ci = this.pos.length / 3
      this.push(c, 0.5, 0.5, o.weights(c))
      for (let k = 0; k < radial; k++) { const i = base + ringIndex * row + k; if (flip) this.idx.push(ci, i + 1, i); else this.idx.push(ci, i, i + 1) }
    }
    if (o.capStart !== false) cap(0, false)
    if (o.capEnd !== false) cap(o.rings, true)
  }

  /** A closed ellipsoid, used for rounded joints such as the shoulder caps. */
  ellipsoid(c: THREE.Vector3, rx: number, ry: number, rz: number, weights: (p: THREE.Vector3) => Weights, lat = 14, lon = 24) {
    const base = this.pos.length / 3
    for (let i = 0; i <= lat; i++) for (let j = 0; j <= lon; j++) {
      const phi = (i / lat) * Math.PI, th = (j / lon) * Math.PI * 2
      const p = V(c.x + rx * Math.sin(phi) * Math.cos(th), c.y + ry * Math.cos(phi), c.z + rz * Math.sin(phi) * Math.sin(th))
      this.push(p, j / lon, i / lat, weights(p))
    }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) { const a = base + i * (lon + 1) + j, b = a + lon + 1; this.idx.push(a, b, a + 1, a + 1, b, b + 1) }
  }

  push(p: THREE.Vector3, u: number, v: number, w: Weights) {
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v)
    const top = w.slice().sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((x, y) => x + y[1], 0) || 1
    for (let i = 0; i < 4; i++) { this.sk.push(top[i] ? top[i][0] : 0); this.sw.push(top[i] ? top[i][1] / sum : 0) }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.sk, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4))
    g.setIndex(this.idx)
    g.computeVertexNormals()
    const n = g.getAttribute('normal') as THREE.BufferAttribute
    for (const [a, b] of this.seams) {                       // the first and last vertex of every ring are one point: give them one normal
      const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b), l = Math.hypot(nx, ny, nz) || 1
      n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l)
    }
    return g
  }
}

const UP_Z = V(0, 0, 1), UP_Y = V(0, 1, 0)

// ---- the body surface -------------------------------------------------------------------------------------------------------------------
export interface BodySurface { skin: THREE.BufferGeometry; shirt: THREE.BufferGeometry; shorts: THREE.BufferGeometry }

export function buildSurface(build: Build): BodySurface {
  const s = SHAPES[build], { world } = buildSkeleton(s)
  const skin = new Parts(), shirt = new Parts(), shorts = new Parts()
  const bi = boneIndex

  // torso: pelvis, waist, ribcage, shoulder line and neck base as one loft
  const ys = Array.from({ length: 9 }, (_, i) => 0.82 + i * 0.09)
  const wTorso = (p: THREE.Vector3): Weights => {
    const y = p.y, toSpine = smooth(0.96, 1.08, y), toChest = smooth(1.11, 1.25, y), toNeck = smooth(1.44, 1.52, y)
    const w: Weights = [[bi('pelvis'), 1 - toSpine], [bi('spine'), toSpine * (1 - toChest)], [bi('chest'), toChest * (1 - toNeck)], [bi('neck'), toNeck]]
    return w.filter((x) => x[1] > 1e-4)
  }
  const torsoA = prof([0.150, 0.165 * s.hips, 0.160 * s.hips, 0.140 * s.waist, 0.150 * s.chest, 0.168 * s.sw * s.chest, 0.192 * s.sw, 0.090 * s.sw, 0.046])
  const torsoB = prof([0.095, 0.105, 0.105, 0.092 * s.waist, 0.098 * s.chest, 0.108 * s.chest, 0.100, 0.066, 0.046])
  const torsoPts = ys.map((y) => V(0, y))
  skin.add({ pts: torsoPts, ra: torsoA, rb: torsoB, up: UP_Z, rings: 48, radial: 40, weights: wTorso, capStart: true, capEnd: false })

  // neck
  skin.add({
    pts: [V(0, 1.44), V(0, 1.5), V(0.0, 1.56), V(0.0, 1.61)], ra: prof([0.059, 0.054, 0.052, 0.052]), rb: prof([0.058, 0.055, 0.054, 0.054]), up: UP_Z, rings: 10, radial: 20,
    weights: (p) => { const k = smooth(1.50, 1.60, p.y); return [[bi('neck'), 1 - k], [bi('head'), k]].filter((x) => x[1] > 1e-4) as Weights },
  })

  for (const side of ['L', 'R'] as const) {
    const sg = side === 'L' ? 1 : -1, W = (n: BoneName) => world[n]
    const arm = [W(`arm${side}` as BoneName), W(`fore${side}` as BoneName), W(`hand${side}` as BoneName)], armBones = [`arm${side}`, `fore${side}`] as BoneName[]
    const legJ = [W(`thigh${side}` as BoneName), W(`shin${side}` as BoneName), W(`foot${side}` as BoneName)], legBones = [`thigh${side}`, `shin${side}`] as BoneName[]

    // legs: hip, thigh, knee, calf, ankle
    const hx = world[`thigh${side}` as BoneName].x
    const legPts = [V(hx, 0.92), V(hx, 0.71), V(hx + 0.004, 0.50), V(hx + 0.006, 0.295), V(hx + 0.006, 0.09)]
    const legA = prof([0.090 * s.legs * s.hips, 0.083 * s.legs * s.hips, 0.057 * s.legs, 0.056 * s.legs, 0.034])
    const legB = prof([0.094 * s.legs * s.hips, 0.086 * s.legs * s.hips, 0.058 * s.legs, 0.063 * s.legs, 0.037])
    const wLeg = (p: THREE.Vector3): Weights => {
      const hipBlend = smooth(0.84, 0.99, p.y)                         // the top of the thigh follows the pelvis
      const w = chainWeights(p, legJ, legBones.concat(`foot${side}` as BoneName).slice(0, 3), 0.07)
      return [[bi('pelvis'), hipBlend], ...w.map(([b, k]) => [b, k * (1 - hipBlend)] as [number, number])]
    }
    skin.add({ pts: legPts, ra: legA, rb: legB, up: UP_Z, rings: 40, radial: 36, weights: wLeg, capStart: false, capEnd: true })

    // feet: heel, arch and toes
    const fx = hx + 0.006
    const wFoot = (): Weights => [[bi(`foot${side}` as BoneName), 1]]
    skin.add({ pts: [V(fx, 0.07, -0.05), V(fx, 0.045, 0.045), V(fx, 0.032, 0.12), V(fx, 0.022, 0.19)], ra: prof([0.031, 0.043, 0.047, 0.03]), rb: prof([0.045, 0.034, 0.022, 0.014]), up: UP_Y, rings: 14, radial: 16, weights: wFoot, capStart: true, capEnd: true })

    // arms: deltoid, upper arm, elbow, forearm, wrist
    const ap = (t: number) => arm[0].clone().lerp(arm[1], t)
    const armPts = [ap(0), ap(0.5), ap(1.0), arm[1].clone().lerp(arm[2], 0.5), arm[2].clone()]
    const armR = s.arms
    const armA = prof([0.052 * armR, 0.046 * armR, 0.037 * armR, 0.036 * armR, 0.026 * armR]), armB = prof([0.052 * armR, 0.047 * armR, 0.038 * armR, 0.036 * armR, 0.022 * armR])
    const wArm = (p: THREE.Vector3): Weights => {
      const shoulder = smooth(1.30, 1.43, p.y)                         // the cap of the shoulder follows the chest
      const w = chainWeights(p, arm, [armBones[0], armBones[1], `hand${side}` as BoneName], 0.06)
      return [[bi('chest'), shoulder * 0.7], ...w.map(([b, k]) => [b, k * (1 - shoulder * 0.7)] as [number, number])]
    }
    skin.add({ pts: armPts, ra: armA, rb: armB, up: UP_Z, rings: 34, radial: 32, weights: wArm, capStart: true, capEnd: false })

    skin.ellipsoid(arm[0].clone().add(V(0, 0.004, 0)), 0.054 * s.arms, 0.056 * s.arms, 0.052 * s.arms, wArm)
    shirt.ellipsoid(arm[0].clone().add(V(0, 0.004, 0)), 0.0665 * s.arms, 0.0675 * s.arms, 0.0635 * s.arms, wArm)

    // hands: palm and five fingers, slightly curled
    const wHand = (): Weights => [[bi(`hand${side}` as BoneName), 1]]
    const w0 = arm[2], hd = arm[2].clone().sub(arm[1]).normalize()
    skin.add({ pts: [w0.clone(), w0.clone().addScaledVector(hd, 0.045), w0.clone().addScaledVector(hd, 0.09)], ra: prof([0.027, 0.036, 0.034]), rb: prof([0.014, 0.016, 0.012]), up: UP_Z, rings: 8, radial: 14, weights: wHand, capStart: false, capEnd: true })
    const knuckle = w0.clone().addScaledVector(hd, 0.088)
    for (let f = 0; f < 4; f++) {
      const off = ((f - 1.5) * 0.0165) * sg * -1, len = [0.072, 0.082, 0.078, 0.06][f]
      const a = knuckle.clone().add(V(off, 0, 0)), curl = 0.012
      skin.add({ pts: [a, a.clone().addScaledVector(hd, len * 0.45).add(V(0, 0, curl * 0.4)), a.clone().addScaledVector(hd, len * 0.8).add(V(0, 0, curl * 1.6)), a.clone().addScaledVector(hd, len).add(V(0, 0.002, curl * 3))], ra: prof([0.0085, 0.0075, 0.0068, 0.0055]), rb: prof([0.0085, 0.0075, 0.0068, 0.0055]), up: UP_Z, rings: 8, radial: 8, weights: wHand, capStart: false, capEnd: true })
    }
    const th = w0.clone().add(V(0.01 * sg * -1, 0, 0.012))
    skin.add({ pts: [th, th.clone().add(V(-0.016 * sg * -1 * 1.2, -0.03, 0.02)), th.clone().add(V(-0.02 * sg * -1 * 1.2, -0.056, 0.032))], ra: prof([0.0105, 0.0085, 0.007]), rb: prof([0.0105, 0.0085, 0.007]), up: UP_Z, rings: 6, radial: 8, weights: wHand, capStart: false, capEnd: true })

    // clothes: shorts over the pelvis and upper thigh, a short-sleeved top over the torso and shoulder
    const wShortsLeg = (p: THREE.Vector3): Weights => wLeg(p)
    shorts.add({ pts: legPts, ra: legA, rb: legB, up: UP_Z, rings: 16, radial: 36, range: [0, 0.42], weights: wShortsLeg, capStart: false, capEnd: false, grow: 0.0085 })
    shirt.add({ pts: armPts, ra: armA, rb: armB, up: UP_Z, rings: 8, radial: 32, range: [0, 0.34], weights: wArm, capStart: false, capEnd: false, grow: 0.0115 })
  }
  shorts.add({ pts: torsoPts, ra: torsoA, rb: torsoB, up: UP_Z, rings: 14, radial: 40, range: [0, 0.3], weights: wTorso, capStart: false, capEnd: false, grow: 0.008, mult: 1.1 })
  shirt.add({ pts: torsoPts, ra: torsoA, rb: torsoB, up: UP_Z, rings: 28, radial: 40, range: [0.2, 0.9], weights: wTorso, capStart: false, capEnd: false, grow: 0.0115 })

  // head: an ellipsoid shaped into a skull, cheekbones, brow, jaw and chin
  const head = new Parts()
  const rx = 0.081, ry = 0.112, rz = 0.099, cy = 1.658, cz = 0.012
  const lat = 40, lon = 56, base = head.pos.length / 3
  for (let i = 0; i <= lat; i++) {
    const phi = (i / lat) * Math.PI, dy = Math.cos(phi), rr = Math.sin(phi)
    for (let j = 0; j <= lon; j++) {
      const th = (j / lon) * Math.PI * 2, dx = rr * Math.sin(th), dz = rr * Math.cos(th)
      const y = ry * dy
      let x = rx * dx, z = rz * dz
      if (dy < 0) { const t = -dy; x *= 1 - 0.34 * t ** 1.4; z *= 1 - 0.2 * t ** 1.6; if (dz > 0.4) z += 0.01 * Math.max(0, t - 0.55) }   // jaw narrows, chin juts
      if (dy > 0.12 && dy < 0.34 && dz > 0.5) z += 0.0045                                                                              // brow ridge
      if (dy < 0.05 && dy > -0.4 && Math.abs(dx) > 0.55 && dz > 0.1) x *= 1.025                                                       // cheekbones
      if (dz < -0.3) z *= 1.03                                                                                                         // back of the skull
      head.push(V(x, cy + y, cz + z), j / lon, 1 - i / lat, [[bi('head'), 1]])
    }
  }
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) { const a = base + i * (lon + 1) + j, b = a + lon + 1; head.idx.push(a, b, a + 1, a + 1, b, b + 1) }
  skin.pos.push(...head.pos); skin.uv.push(...head.uv); skin.sk.push(...head.sk); skin.sw.push(...head.sw)
  const offset = skin.pos.length / 3 - head.pos.length / 3
  for (const k of head.idx) skin.idx.push(k + offset)

  return { skin: skin.geometry(), shirt: shirt.geometry(), shorts: shorts.geometry() }
}

// ---- face and hair, attached to the head bone ----------------------------------------------------------------------------------------------
/** z of the face surface at (x, y), from the same ellipsoid as the head. */
const faceZ = (x: number, y: number) => 0.012 + 0.099 * Math.sqrt(Math.max(0, 1 - (x / 0.081) ** 2 - ((y - 1.658) / 0.112) ** 2))

export interface Face { group: THREE.Group; lidL: THREE.Mesh; lidR: THREE.Mesh; eyeL: THREE.Group; eyeR: THREE.Group; brows: THREE.Mesh[] }

export function buildFace(headWorld: THREE.Vector3, mats: AvatarMaterials, hairLong: boolean): Face {
  const g = new THREE.Group()
  const at = (x: number, y: number, z: number) => V(x - headWorld.x, y - headWorld.y, z - headWorld.z)
  const eyes: THREE.Group[] = [], lids: THREE.Mesh[] = []
  for (const sg of [1, -1]) {
    const ex = 0.034 * sg, ey = 1.672, ez = faceZ(ex, ey) + 0.0005
    const eye = new THREE.Group(); eye.position.copy(at(ex, ey, ez))
    eye.add(new THREE.Mesh(new THREE.SphereGeometry(0.0125, 20, 16), mats.sclera))
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.0066, 20), mats.iris); iris.position.z = 0.0121; eye.add(iris)
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.003, 16), mats.pupil); pupil.position.z = 0.0123; eye.add(pupil)
    g.add(eye); eyes.push(eye)
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0134, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), mats.skin)
    lid.position.copy(eye.position); g.add(lid); lids.push(lid)
  }
  const brows: THREE.Mesh[] = []
  for (const sg of [1, -1]) {
    const pts = [0.014, 0.032, 0.05, 0.066].map((x, i) => at(x * sg, 1.698 + [0, 0.005, 0.005, -0.002][i], faceZ(x * sg, 1.698) + 0.003))
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.0028, 6), mats.hair); g.add(m); brows.push(m)
  }
  // nose: a soft bridge, a rounded tip and nostril wings
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mats.skin); bridge.scale.set(0.0072, 0.021, 0.0105); bridge.rotation.x = 0.3; bridge.position.copy(at(0, 1.646, faceZ(0, 1.646) + 0.004)); g.add(bridge)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0088, 16, 12), mats.skin); tip.scale.set(1, 0.85, 1.05); tip.position.copy(at(0, 1.629, faceZ(0, 1.629) + 0.0105)); g.add(tip)
  for (const sg of [1, -1]) { const w = new THREE.Mesh(new THREE.SphereGeometry(0.0058, 12, 10), mats.skin); w.position.copy(at(0.0092 * sg, 1.627, faceZ(0.0092, 1.627) + 0.0045)); g.add(w) }
  // lips and chin
  const lipU = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 16, 10), mats.lips); lipU.scale.set(1.5, 0.27, 0.42); lipU.position.copy(at(0, 1.6025, faceZ(0, 1.6025) + 0.0005)); g.add(lipU)
  const lipL = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 16, 10), mats.lips); lipL.scale.set(1.3, 0.3, 0.42); lipL.position.copy(at(0, 1.5915, faceZ(0, 1.5915) + 0.0005)); g.add(lipL)
  // ears
  for (const sg of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 12), mats.skin); e.scale.set(0.35, 1, 0.65); e.position.copy(at(0.082 * sg, 1.658, 0.01)); g.add(e) }
  // hair: a cap over the top and back of the skull (the face and forehead stay clear), plus a long fall behind the shoulders for the feminine build
  const cap = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.66)
  const pos = cap.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i), dy = pos.getY(i), dz = pos.getZ(i)
    const bump = 1 + 0.01 * Math.sin(dx * 40) * Math.cos(dz * 33) + 0.006 * Math.sin(dy * 55)
    const front = smooth(0.2, 0.55, dz) * (1 - smooth(0.5, 0.78, dy))             // forehead and face: pull the hair back inside the skull
    const k = (1 - front * 0.16) * bump
    pos.setXYZ(i, dx * 0.0865 * k, dy * 0.12 * k, dz * 0.1055 * k)
  }
  cap.computeVertexNormals()
  const hair = new THREE.Mesh(cap, mats.hair); hair.position.copy(at(0, 1.658 + 0.002, 0.012 - 0.002)); g.add(hair)
  if (hairLong) {
    const fall = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([at(0, 1.66, -0.07), at(0, 1.55, -0.1), at(0, 1.42, -0.085), at(0, 1.3, -0.07)]), 16, 0.07, 14), mats.hair)
    fall.scale.set(1, 1, 0.45); g.add(fall)
  }
  return { group: g, lidL: lids[0], lidR: lids[1], eyeL: eyes[0], eyeR: eyes[1], brows }
}

// ---- materials ----------------------------------------------------------------------------------------------------------------------------
export interface AvatarMaterials { skin: THREE.MeshPhysicalMaterial; shirt: THREE.MeshStandardMaterial; shorts: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial; sclera: THREE.MeshPhysicalMaterial; iris: THREE.MeshBasicMaterial; pupil: THREE.MeshBasicMaterial; lips: THREE.MeshPhysicalMaterial }

/** A tileable noise texture drawn on a canvas (browser only): freckle-like colour variation for the skin map, fine pores for the bump map. */
function noiseTexture(size: number, mode: 'colour' | 'bump', seed: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'); if (!g) return null
  const img = g.createImageData(size, size)
  let t = seed >>> 0
  const rnd = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296 }
  const cells = 24, lattice = Array.from({ length: cells * cells }, () => rnd())
  const at = (x: number, y: number) => lattice[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)]
  const sm = (u: number) => u * u * (3 - 2 * u)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells, ix = Math.floor(fx), iy = Math.floor(fy), ux = sm(fx - ix), uy = sm(fy - iy)
    const n = at(ix, iy) * (1 - ux) * (1 - uy) + at(ix + 1, iy) * ux * (1 - uy) + at(ix, iy + 1) * (1 - ux) * uy + at(ix + 1, iy + 1) * ux * uy
    const fine = rnd()
    const o = (y * size + x) * 4
    if (mode === 'colour') { const k = 0.93 + n * 0.1 - (fine > 0.992 ? 0.1 : 0); img.data[o] = 255 * k; img.data[o + 1] = 255 * (k - (n - 0.5) * 0.05); img.data[o + 2] = 255 * (k - (n - 0.5) * 0.09); img.data[o + 3] = 255 }
    else { const v = 128 + (fine - 0.5) * 70 + (n - 0.5) * 40; img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255 }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 3); tex.anisotropy = 8
  if (mode === 'colour') tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export const SKIN_TONES = { light: 0xf0c8ac, medium: 0xd9a37e, tan: 0xb97c57, dark: 0x7a4b32 } as const
export type SkinTone = keyof typeof SKIN_TONES

export function makeMaterials(tone: SkinTone = 'medium'): AvatarMaterials {
  const map = noiseTexture(256, 'colour', 3), bump = noiseTexture(256, 'bump', 9)
  const skin = new THREE.MeshPhysicalMaterial({ color: SKIN_TONES[tone], roughness: 0.58, metalness: 0, sheen: 0.55, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffd9c4), clearcoat: 0.04, clearcoatRoughness: 0.6, emissive: new THREE.Color(0x8a3a28), emissiveIntensity: 0.05, map: map ?? undefined, bumpMap: bump ?? undefined, bumpScale: 0.04, side: THREE.DoubleSide })
  return {
    skin,
    shirt: new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.92, side: THREE.DoubleSide }),
    shorts: new THREE.MeshStandardMaterial({ color: 0x586a7d, roughness: 0.9, side: THREE.DoubleSide }),
    hair: new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.55, metalness: 0.05 }),
    sclera: new THREE.MeshPhysicalMaterial({ color: 0xf6f3ee, roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.08 }),
    iris: new THREE.MeshBasicMaterial({ color: 0x6b4a2f }), pupil: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    lips: new THREE.MeshPhysicalMaterial({ color: 0xb8665f, roughness: 0.4, clearcoat: 0.3 }),
  }
}

/** Euler angles (x, y, z in YXZ order) for every driven joint of a pose. Shared by the built-in body and by loaded models. */
export function boneEulers(p: Pose): Partial<Record<BoneName, [number, number, number]>> {
  return {
    pelvis: [0, p.rootYaw, p.rootRoll],
    spine: [p.spineFlex * 0.55, p.chestTwist * 0.4, 0], chest: [p.spineFlex * 0.45 + p.chestBreath * 0.012, p.chestTwist * 0.6, 0],
    neck: [p.neckFlex * 0.55 + p.headPitch * 0.3, p.headYaw * 0.4, 0], head: [p.neckFlex * 0.45 + p.headPitch * 0.7, p.headYaw * 0.6, 0],
    thighL: [-p.hipL, 0, -p.hipAbdL], thighR: [-p.hipR, 0, p.hipAbdR], shinL: [p.kneeL, 0, 0], shinR: [p.kneeR, 0, 0], footL: [p.ankleL, 0, 0], footR: [p.ankleR, 0, 0],
    armL: [-p.shoulderL, 0, p.abdL * 0.9 - 0.05], armR: [-p.shoulderR, 0, -(p.abdR * 0.9 - 0.05)], foreL: [-p.elbowL, 0, 0], foreR: [-p.elbowR, 0, 0],
  }
}

// ---- the assembled avatar -----------------------------------------------------------------------------------------------------------------
/** What the panel needs from any figure, whether the built-in body or a loaded model. */
export type Figure = Pick<Avatar, 'root' | 'apply' | 'tint' | 'dispose' | 'xray'>

export interface Avatar {
  root: THREE.Group
  bones: Record<BoneName, THREE.Bone>
  world: Record<BoneName, THREE.Vector3>
  materials: AvatarMaterials
  /** every material that should turn see-through for the x-ray view */
  xray: THREE.Material[]
  face: Face
  /** apply joint angles; the head, eyes and eyelids follow too */
  apply(p: Pose): void
  /** colour the skin: flush 0..1 warms it (arousal, exertion), pallor 0..1 pales it (fatigue, stress) */
  tint(flush: number, pallor: number): void
  dispose(): void
}

export function createAvatar(build: Build = 'neutral', tone: SkinTone = 'medium'): Avatar {
  const shape = SHAPES[build], { bones, world, skeleton } = buildSkeleton(shape), surface = buildSurface(build), materials = makeMaterials(tone)
  const root = new THREE.Group()
  root.scale.setScalar(HEIGHT / 1.77)
  const hips = new THREE.Group()
  root.add(hips); hips.add(bones.pelvis)
  const meshes = [new THREE.SkinnedMesh(surface.skin, materials.skin), new THREE.SkinnedMesh(surface.shirt, materials.shirt), new THREE.SkinnedMesh(surface.shorts, materials.shorts)]
  hips.updateMatrixWorld(true)
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; hips.add(m); m.bind(skeleton) }
  const face = buildFace(world.head, materials, shape.hairLong)
  face.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true })
  bones.head.add(face.group)
  const baseSkin = new THREE.Color(SKIN_TONES[tone]), pink = new THREE.Color(0xe0877a), pale = new THREE.Color(0xdcc9bd)
  const rest = Object.fromEntries(BONE_NAMES.map((n) => [n, bones[n].quaternion.clone()])) as Record<BoneName, THREE.Quaternion>
  const eul = new THREE.Euler(), q = new THREE.Quaternion()
  const rot = (n: BoneName, x = 0, y = 0, z = 0) => { eul.set(x, y, z, 'YXZ'); q.setFromEuler(eul); bones[n].quaternion.copy(rest[n]).multiply(q) }

  const avatar: Avatar = {
    root, bones, world, materials, face, xray: [materials.skin, materials.shirt, materials.shorts],
    apply(p) {
      hips.position.y = p.rootY
      for (const [n, e] of Object.entries(boneEulers(p)) as [BoneName, [number, number, number]][]) rot(n, e[0], e[1], e[2])
      bones.chest.scale.set(1 + p.chestBreath * 0.012, 1, 1 + p.chestBreath * 0.016)
      for (const lid of [face.lidL, face.lidR]) lid.rotation.x = -0.55 + p.lid * 1.55
      for (const eye of [face.eyeL, face.eyeR]) eye.rotation.set(p.gazePitch, p.gazeYaw * 0.35, 0)
    },
    tint(flush, pallor) {
      const c = baseSkin.clone().lerp(pink, Math.min(1, flush) * 0.28).lerp(pale, Math.min(1, pallor) * 0.3)
      materials.skin.color.copy(c); materials.skin.emissiveIntensity = 0.04 + flush * 0.07
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose()
      face.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose() })
      Object.values(materials).forEach((m) => { const mm = m as THREE.MeshStandardMaterial; mm.map?.dispose(); mm.bumpMap?.dispose(); mm.dispose() })
    },
  }
  return avatar
}
