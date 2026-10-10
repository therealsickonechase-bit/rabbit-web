// Draws the schematic body (NOT to scale) under the brain: a see-through torso, spinal cord, limbs, organs and the nerve and
// hormone routes that reach them. Kept apart from Brain3D so that component stays readable. Browser only (uses WebGL objects).

import * as THREE from 'three'
import { BODY_ROUTES, BRAIN_EXIT, ORGANS, ORGAN_IDS, PAIRED, ROUTE_IDS, type OrganId, type OrganState, type RouteId } from './body.ts'

const SHAPES: Record<OrganId, { kind: 'sphere' | 'torus'; r: number; s: [number, number, number] }> = {
  eyes: { kind: 'sphere', r: 0.09, s: [1, 0.8, 1] }, lungs: { kind: 'sphere', r: 0.3, s: [0.8, 0.7, 1.5] }, heart: { kind: 'sphere', r: 0.2, s: [0.9, 0.8, 1.1] },
  liver: { kind: 'sphere', r: 0.34, s: [1.4, 0.9, 0.8] }, stomach: { kind: 'sphere', r: 0.2, s: [1, 0.8, 1.2] }, spleen: { kind: 'sphere', r: 0.13, s: [0.7, 0.7, 1.4] },
  adrenals: { kind: 'sphere', r: 0.07, s: [1, 1, 1] }, kidneys: { kind: 'sphere', r: 0.14, s: [0.8, 0.7, 1.3] }, gut: { kind: 'torus', r: 0.38, s: [1, 0.7, 1] },
  bladder: { kind: 'sphere', r: 0.13, s: [1, 1, 1] }, muscle: { kind: 'sphere', r: 0.01, s: [1, 1, 1] },
}
const SPINE_Y = -0.44

export interface BodyScene {
  group: THREE.Group
  /** meshes a click can hit, each tagged with userData.organ */
  pickables: THREE.Object3D[]
  setStates(states: Record<OrganId, OrganState>, selected: OrganId | null): void
  setLabels(visible: boolean): void
  retheme(fg: string, halo: string): void
  tick(t: number): void
  dispose(): void
}

function labelSprite(text: string, fg: string, halo: string) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 56; const g = c.getContext('2d')!
  g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 7; g.strokeStyle = halo; g.strokeText(text, 160, 36); g.fillStyle = fg; g.fillText(text, 160, 36)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }))
  sp.scale.set(0.9, (0.9 * 56) / 320, 1); return sp
}

/** Bends each route along the neck, chest or spine so the lines read as nerves rather than straight rods. */
function routePoints(route: RouteId, to: THREE.Vector3): THREE.Vector3[] {
  const from = new THREE.Vector3(...BRAIN_EXIT[route])
  if (route === 'visual') return [from, to]
  const alongSpine = route === 'sympathetic' || route === 'motor'
  const neck = new THREE.Vector3(0, alongSpine ? SPINE_Y : 0.12, -1.25)
  const level = new THREE.Vector3(alongSpine ? 0 : to.x * 0.35, alongSpine ? SPINE_Y : 0.1, to.z + 0.15)
  return [from, neck, level, to]
}

const SHORT_NAME: Record<OrganId, string> = {
  eyes: 'Eyes', lungs: 'Lungs', heart: 'Heart', liver: 'Liver', stomach: 'Stomach', spleen: 'Spleen / immune', adrenals: 'Adrenals', kidneys: 'Kidneys', gut: 'Gut', bladder: 'Bladder', muscle: 'Muscle',
}

export function createBody(fg: string, halo: string): BodyScene {
  const group = new THREE.Group()
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T) => { owned.push(x); return x }

  // ---- torso, neck, spinal cord, limbs -------------------------------------------------------------------------
  const profile = [[0.18, -1.0], [0.2, -1.25], [0.55, -1.45], [0.98, -1.65], [1.02, -2.1], [0.92, -2.7], [0.82, -3.3], [0.92, -4.0], [0.86, -4.7], [0.62, -5.0], [0.2, -5.1]].map(([r, h]) => new THREE.Vector2(r, h))
  const torsoGeo = own(new THREE.LatheGeometry(profile, 40))
  const shellMat = own(new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }))
  const wireMat = own(new THREE.MeshBasicMaterial({ color: 0x9aa0a6, wireframe: true, transparent: true, opacity: 0.09, depthWrite: false }))
  for (const m of [shellMat, wireMat]) { const mesh = new THREE.Mesh(torsoGeo, m); mesh.rotation.x = Math.PI / 2; mesh.scale.set(1, 1, 0.62); group.add(mesh) }

  const spineCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, SPINE_Y, -1.0), new THREE.Vector3(0, SPINE_Y - 0.05, -2.8), new THREE.Vector3(0, SPINE_Y, -4.5)])
  group.add(new THREE.Mesh(own(new THREE.TubeGeometry(spineCurve, 30, 0.045, 8)), own(new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.6 }))))

  const muscleMat = own(new THREE.MeshStandardMaterial({ color: ORGANS.muscle.color, roughness: 0.7, transparent: true, opacity: 0.85 }))
  const limbs: THREE.Mesh[] = []
  const limb = (a: [number, number, number], b: [number, number, number], radius: number) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B)
    const m = new THREE.Mesh(own(new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius * 2), 6, 14)), muscleMat)
    m.position.copy(A.clone().add(B).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); m.userData.organ = 'muscle'; group.add(m); limbs.push(m)
  }
  for (const s of [-1, 1]) { limb([s * 1.02, 0, -1.75], [s * 1.3, 0.05, -3.7], 0.15); limb([s * 0.42, 0, -4.55], [s * 0.5, 0, -6.9], 0.23) }

  // ---- organs ----------------------------------------------------------------------------------------------------
  interface Part { mesh: THREE.Mesh; organ: OrganId; mat: THREE.MeshStandardMaterial }
  const parts: Part[] = []
  for (const id of ORGAN_IDS) {
    if (id === 'muscle') continue
    const o = ORGANS[id], sh = SHAPES[id], sides = PAIRED.has(id) ? [-1, 1] : [1]
    for (const side of sides) {
      const geo = own(sh.kind === 'torus' ? new THREE.TorusGeometry(sh.r, 0.11, 12, 28) : new THREE.SphereGeometry(sh.r, 20, 14))
      const mat = own(new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.55, transparent: true, opacity: 0.92, emissive: new THREE.Color(o.color), emissiveIntensity: 0 }))
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(PAIRED.has(id) ? o.pos[0] * side : o.pos[0], o.pos[1], o.pos[2]); mesh.scale.set(...sh.s); mesh.userData.organ = id
      group.add(mesh); parts.push({ mesh, organ: id, mat })
    }
  }

  // ---- routes from the brain ---------------------------------------------------------------------------------------
  interface Pulse { dot: THREE.Mesh; curve: THREE.CatmullRomCurve3; t: number; sp: number; organ: OrganId }
  interface Line { mat: THREE.MeshBasicMaterial; route: RouteId; organ: OrganId }
  const lines: Line[] = [], pulses: Pulse[] = []
  const pulseGeo = own(new THREE.SphereGeometry(0.03, 8, 6))
  for (const r of ROUTE_IDS) for (const organ of BODY_ROUTES[r].organs) {
    for (const side of PAIRED.has(organ) ? [-1, 1] : [1]) {
      const p = ORGANS[organ].pos
      const to = organ === 'muscle' ? new THREE.Vector3(side * 1.0, 0, -2.4) : new THREE.Vector3(PAIRED.has(organ) ? p[0] * side : p[0], p[1], p[2])
      const curve = new THREE.CatmullRomCurve3(routePoints(r, to))
      const mat = own(new THREE.MeshBasicMaterial({ color: BODY_ROUTES[r].color, transparent: true, opacity: 0.1, depthWrite: false }))
      group.add(new THREE.Mesh(own(new THREE.TubeGeometry(curve, 36, 0.011, 5)), mat)); lines.push({ mat, route: r, organ })
      const dot = new THREE.Mesh(pulseGeo, own(new THREE.MeshBasicMaterial({ color: BODY_ROUTES[r].color }))); dot.visible = false; group.add(dot)
      pulses.push({ dot, curve, t: Math.random(), sp: 0.12 + Math.random() * 0.1, organ })
    }
  }

  // ---- labels ----------------------------------------------------------------------------------------------------
  const labels = new Map<OrganId, THREE.Sprite>()
  const makeLabels = (f: string, h: string) => {
    for (const s of labels.values()) { s.material.map?.dispose(); s.material.dispose(); group.remove(s) }
    labels.clear()
    for (const id of ORGAN_IDS) {
      const s = labelSprite(SHORT_NAME[id], f, h), p = ORGANS[id].pos
      // labels sit just outside the body at the organ's height, on the organ's own side, so they do not hide it
      const side = p[0] >= 0 ? 1 : -1
      if (id === 'eyes') s.position.set(0, p[1] + 0.3, p[2] + 0.35)
      else if (id === 'muscle') s.position.set(1.95, 0, -4.3)
      else s.position.set(side * 1.75, 0.1, p[2] + (id === 'stomach' ? 0.12 : id === 'spleen' ? -0.18 : 0))
      s.userData.organ = id; group.add(s); labels.set(id, s)
    }
  }
  makeLabels(fg, halo)

  // ---- state -----------------------------------------------------------------------------------------------------
  let states: Record<OrganId, OrganState> | null = null, picked: OrganId | null = null, labelsOn = true
  const active = (organ: OrganId) => !!states && states[organ].level > 0

  return {
    group,
    pickables: [...parts.map((p) => p.mesh), ...limbs],
    setStates(s, selected) {
      states = s; picked = selected
      const any = ORGAN_IDS.some((id) => s[id].level > 0)
      for (const l of lines) {
        const on = active(l.organ)
        l.mat.opacity = on ? 0.55 : any ? 0.04 : 0.1
        l.mat.color.set(on || !any ? BODY_ROUTES[l.route].color : '#888888')
      }
      for (const p of parts) p.mat.opacity = any && !active(p.organ) && p.organ !== picked ? 0.35 : 0.92
      muscleMat.opacity = any && !active('muscle') && picked !== 'muscle' ? 0.3 : 0.85
    },
    setLabels(v) { labelsOn = v; for (const s of labels.values()) s.visible = v },
    retheme(f, h) { makeLabels(f, h); for (const s of labels.values()) s.visible = labelsOn },
    tick(t) {
      for (const p of parts) {
        const lvl = states?.[p.organ].level ?? 0, sel = p.organ === picked
        p.mat.emissiveIntensity = sel ? 0.55 + 0.25 * Math.sin(t * 5) : lvl > 0 ? (0.25 + 0.5 * lvl) * (0.7 + 0.3 * Math.sin(t * (2 + 3 * lvl) + p.mesh.id)) : 0
        const s = SHAPES[p.organ].s, k = 1 + (sel ? 0.12 : 0) + (lvl > 0 ? 0.05 * Math.sin(t * (2 + 3 * lvl)) : 0)
        p.mesh.scale.set(s[0] * k, s[1] * k, s[2] * k)
      }
      muscleMat.emissive.set(active('muscle') || picked === 'muscle' ? ORGANS.muscle.color : '#000000')
      muscleMat.emissiveIntensity = active('muscle') ? 0.25 + 0.2 * Math.sin(t * 3) : 0
      for (const p of pulses) {
        const on = active(p.organ); p.dot.visible = on
        if (on) { p.t = (p.t + p.sp * 0.016) % 1; p.dot.position.copy(p.curve.getPoint(p.t)) }
      }
    },
    dispose() {
      for (const s of labels.values()) { s.material.map?.dispose(); s.material.dispose() }
      owned.forEach((o) => o.dispose())
    },
  }
}
