// Assembles the detailed body (skeleton, organs, vessels, nervous system) and animates it from the physiology model:
// the heart beats at its own rate and rhythm, the diaphragm and lungs breathe, boluses move along the gut, hormones leave the
// adrenals, signals travel down and up every nerve pathway (dimmer and sparser when a pathway is damaged), limbs weaken, stiffen or
// convulse. Browser only (WebGL objects). Geometry comes from body-skeleton.ts, body-organs.ts and body-nerves.ts.

import * as THREE from 'three'
import { sceneOf, trunkHalfDepth, trunkHalfWidth } from './anatomy.ts'
import { ORGANS, ORGAN_IDS, type OrganId, type OrganState } from './body.ts'
import { V } from './body-geom.ts'
import { buildNerves, type Pathway } from './body-nerves.ts'
import { buildOrgans, type OrganPart } from './body-organs.ts'
import { pathwayLevel, physioAt, type Physio } from './body-physiology.ts'
import { applyLive, type Baseline, type LiveFrame } from './live-signals.ts'
import { limbGeometry, pelvisGeometry, ribcageGeometry, spineGeometry, trunkShell } from './body-skeleton.ts'
import type { ScenarioId, SystemId } from './neuro.ts'

export interface BodyLayers { skin: boolean; skeleton: boolean; organs: boolean; vessels: boolean; nerves: boolean; muscles: boolean; labels: boolean }
export const DEFAULT_BODY_LAYERS: BodyLayers = { skin: true, skeleton: true, organs: true, vessels: true, nerves: true, muscles: true, labels: true }

export interface BodyScene {
  group: THREE.Group
  /** meshes a click can hit; each carries userData.organ and userData.label */
  pickables: THREE.Object3D[]
  setStates(states: Record<OrganId, OrganState>, selected: OrganId | null): void
  setScenario(system: SystemId | 'none', scenario: ScenarioId): void
  /** measured values from a connected bridge replace the model's heart, breathing and muscle numbers while the frame is fresh */
  setLive(frame: LiveFrame | null, baseline: Baseline): void
  setLayers(l: BodyLayers): void
  retheme(fg: string, halo: string): void
  tick(t: number): void
  physio(): Physio
  dispose(): void
}

const bump = (x: number, a: number, b: number) => (x > a && x < b ? Math.sin((Math.PI * (x - a)) / (b - a)) : 0)

/** A curve resampled at even spacing so a point at 0..1 is one cheap array lookup. */
class Track {
  pts: THREE.Vector3[]
  constructor(curve: THREE.Curve<THREE.Vector3>, n = 160) { this.pts = curve.getSpacedPoints(n) }
  at(t: number, out: THREE.Vector3) {
    const f = Math.min(0.99999, Math.max(0, t)) * (this.pts.length - 1), i = Math.floor(f), k = f - i
    return out.copy(this.pts[i]).lerp(this.pts[i + 1], k)
  }
  nearestT(p: THREE.Vector3) {
    let best = 0, bd = Infinity
    this.pts.forEach((q, i) => { const d = q.distanceToSquared(p); if (d < bd) { bd = d; best = i } })
    return best / (this.pts.length - 1)
  }
}

interface Particle { track: Track; t: number; speed: number; dir: 1 | -1; size: number; on: boolean; color: THREE.Color; scale: number }

const LABEL_SIDE: Record<OrganId, 1 | -1 | 0> = {
  eyes: 0, lungs: 1, heart: -1, diaphragm: -1, esophagus: 1, liver: 1, gallbladder: 1, stomach: -1, pancreas: -1, spleen: -1, adrenals: 1, kidneys: 1, gut: 1, bladder: -1, muscle: 1, spinalcord: 1,
}
/** Height of each label in cm below the notch, so labels on one side never overlap. */
const LABEL_Z: Record<OrganId, number> = {
  eyes: 12, spinalcord: 5, lungs: -3, esophagus: -8, liver: -14, adrenals: -19, gallbladder: -24, kidneys: -29, gut: -37, muscle: -49,
  heart: -6, diaphragm: -12, spleen: -18, stomach: -24, pancreas: -30, bladder: -50,
}
const SHORT: Record<OrganId, string> = {
  eyes: 'Eyes', lungs: 'Lungs', heart: 'Heart', diaphragm: 'Diaphragm', esophagus: 'Oesophagus', liver: 'Liver', gallbladder: 'Gallbladder', stomach: 'Stomach', pancreas: 'Pancreas', spleen: 'Spleen',
  adrenals: 'Adrenals', kidneys: 'Kidneys', gut: 'Gut', bladder: 'Bladder', muscle: 'Muscle', spinalcord: 'Spinal cord',
}

function labelSprite(text: string, fg: string, halo: string) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 56; const g = c.getContext('2d')!
  g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 7; g.strokeStyle = halo; g.strokeText(text, 160, 36); g.fillStyle = fg; g.fillText(text, 160, 36)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }))
  sp.scale.set(0.9, (0.9 * 56) / 320, 1); return sp
}

export function createBody(fg: string, halo: string): BodyScene {
  const group = new THREE.Group()
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T) => { owned.push(x); return x }
  const layerGroups = {
    skin: new THREE.Group(), skeleton: new THREE.Group(), organs: new THREE.Group(), vessels: new THREE.Group(), nerves: new THREE.Group(), muscles: new THREE.Group(), labels: new THREE.Group(),
  }
  Object.values(layerGroups).forEach((g) => group.add(g))
  const pickables: THREE.Object3D[] = []
  const std = (o: THREE.MeshStandardMaterialParameters = {}) => own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, ...o }))

  // ---- skin and skeleton ------------------------------------------------------------------------------------------------------
  layerGroups.skin.add(new THREE.Mesh(own(trunkShell(trunkHalfWidth, trunkHalfDepth)), own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }))))
  const boneMat = std({ transparent: true, opacity: 0.42, depthWrite: false })
  for (const g of [ribcageGeometry(), spineGeometry(), pelvisGeometry()]) layerGroups.skeleton.add(new THREE.Mesh(own(g), boneMat))

  // ---- eyes ---------------------------------------------------------------------------------------------------------------------------
  const eyeMat = own(new THREE.MeshStandardMaterial({ color: 0xf1f3f5, roughness: 0.3, emissive: new THREE.Color(0x4dabf7), emissiveIntensity: 0 }))
  const eyeParts: THREE.Mesh[] = []
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(own(new THREE.SphereGeometry(0.09, 16, 12)), eyeMat); eye.position.set(s * 0.36, 1.12, 0.2); eye.userData = { organ: 'eyes', label: `${s === 1 ? 'Right' : 'Left'} eye` }
    const iris = new THREE.Mesh(own(new THREE.CircleGeometry(0.04, 16)), own(new THREE.MeshBasicMaterial({ color: 0x3b5bdb }))); iris.position.set(0, 0.092, 0); iris.rotation.x = -Math.PI / 2; eye.add(iris)
    layerGroups.organs.add(eye); pickables.push(eye); eyeParts.push(eye)
  }

  // ---- limbs: bones are static, each muscle group moves on its own pivot ------------------------------------------------------------
  interface LimbRig { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; side: -1 | 1; pivot: THREE.Vector3 }
  const limbs: LimbRig[] = []
  for (const kind of ['arm', 'leg'] as const) for (const side of [-1, 1] as const) {
    const l = limbGeometry(kind, side)
    layerGroups.skeleton.add(new THREE.Mesh(own(l.bones), boneMat))
    const mat = std({ transparent: true, opacity: 0.88, emissive: new THREE.Color(0xff3b30), emissiveIntensity: 0 })
    const mesh = new THREE.Mesh(own(l.muscle), mat); mesh.userData = { organ: 'muscle', label: `${side === 1 ? 'Right' : 'Left'} ${kind} muscles` }
    layerGroups.muscles.add(mesh); pickables.push(mesh)
    limbs.push({ mesh, mat, side, pivot: new THREE.Vector3(...sceneOf(side * (kind === 'arm' ? 18 : 9), 0, kind === 'arm' ? -6 : -51)) })
  }

  // ---- organs and vessels ---------------------------------------------------------------------------------------------------------
  const model = buildOrgans()
  interface Rig { part: OrganPart; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; layer: 'organs' | 'vessels' }
  const rigs: Rig[] = [], byId = new Map<string, Rig>()
  for (const part of model.parts) {
    const layer = part.id.startsWith('vessels.') || part.id === 'heart.aorta' ? 'vessels' : 'organs'
    const mat = std({ transparent: part.opacity !== undefined, opacity: part.opacity ?? 1, emissive: new THREE.Color(ORGANS[part.organ].color), emissiveIntensity: 0, side: THREE.DoubleSide, depthWrite: part.opacity === undefined })
    const mesh = new THREE.Mesh(own(part.geometry), mat); mesh.userData = { organ: part.organ, label: part.label, id: part.id }
    layerGroups[layer].add(mesh); pickables.push(mesh)
    const rig: Rig = { part, mesh, mat, layer }; rigs.push(rig); byId.set(part.id, rig)
  }
  const pivotScale = (mesh: THREE.Mesh, pivot: THREE.Vector3, sx: number, sy: number, sz: number) => {
    mesh.scale.set(sx, sy, sz)
    mesh.position.set(pivot.x * (1 - sx), pivot.y * (1 - sy), pivot.z * (1 - sz))
  }

  // ---- nervous system -------------------------------------------------------------------------------------------------------------
  const nerves = buildNerves()
  for (const part of nerves.parts) {
    const mesh = new THREE.Mesh(own(part.geometry), std({ roughness: 0.5, emissive: new THREE.Color(0x222222), emissiveIntensity: 0.4 }))
    mesh.userData = { organ: part.organ, label: part.label, id: part.id }
    layerGroups.nerves.add(mesh)
    if (part.layer === 'cord' || part.id === 'nerves.vagus' || part.id === 'nerves.phrenic') pickables.push(mesh)
  }
  // per-pathway overlays: brightness and colour show how much of the signal gets through
  interface PathRig { path: Pathway; track: Track; mat: THREE.MeshBasicMaterial; level: number; cutT: number | null }
  const pathRigs: PathRig[] = []
  for (const path of nerves.pathways) {
    const mat = own(new THREE.MeshBasicMaterial({ color: path.color, transparent: true, opacity: 0.55, depthWrite: false }))
    const r = path.kind === 'motor' || path.kind === 'sensory' || path.kind === 'autonomic' || path.kind === 'visual' ? 0.0085 : path.kind === 'limb' ? 0.014 : 0.0075
    const segs = Math.min(220, Math.max(30, Math.round(path.curve.getLength() * 28)))
    layerGroups.nerves.add(new THREE.Mesh(own(new THREE.TubeGeometry(path.curve, segs, r, 6, false)), mat))
    pathRigs.push({ path, track: new Track(path.curve, 200), mat, level: 1, cutT: null })
  }
  const markerMat = own(new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.55, depthWrite: false }))
  const markerGeo = own(new THREE.SphereGeometry(1, 14, 10))
  const markers: THREE.Mesh[] = []
  const lesionSpots: { scenario: ScenarioId; id: string; at: THREE.Vector3; r: number }[] = [
    { scenario: 'stroke', id: 'corticospinal.-1', at: V([-0.24, 0.03, 0.18]), r: 0.1 },
    { scenario: 'tbi', id: 'corticospinal.-1', at: V([-0.1, -0.32, -0.5]), r: 0.06 }, { scenario: 'tbi', id: 'corticospinal.1', at: V([0.1, -0.32, -0.5]), r: 0.06 },
    { scenario: 'tbi', id: 'sensory.-1', at: V([0.12, -0.26, -0.4]), r: 0.05 }, { scenario: 'tbi', id: 'sensory.1', at: V([-0.12, -0.26, -0.4]), r: 0.05 },
    { scenario: 'tbi', id: 'autonomic.-1', at: V([-0.05, -0.14, -0.55]), r: 0.05 }, { scenario: 'tbi', id: 'autonomic.1', at: V([0.05, -0.14, -0.55]), r: 0.05 },
    { scenario: 'occipital', id: 'visual.1', at: V([0.33, -0.7, 0.1]), r: 0.1 },
    { scenario: 'epilepsy', id: 'corticospinal.1', at: V([0.42, 0.25, 0.72]), r: 0.07 },
  ]

  // ---- particles: blood, air, food, urine, hormones and nerve signals all share one instanced mesh ---------------------------------------
  const MAX = 1000
  const dots = new THREE.InstancedMesh(own(new THREE.SphereGeometry(1, 8, 6)), own(new THREE.MeshBasicMaterial({ color: 0xffffff })), MAX)
  dots.frustumCulled = false; dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(dots)
  const parts: Particle[] = []
  const addParticles = (curve: THREE.Curve<THREE.Vector3>, n: number, color: THREE.ColorRepresentation, size: number, speed: number, dir: 1 | -1 = 1, tr?: Track) => {
    const track = tr ?? new Track(curve, 120), out: Particle[] = []
    for (let i = 0; i < n && parts.length < MAX; i++) { const p: Particle = { track, t: i / n, speed, dir, size, on: true, color: new THREE.Color(color), scale: 1 }; parts.push(p); out.push(p) }
    return out
  }
  const P = model.paths
  const line = (a: [number, number, number], b: [number, number, number]) => new THREE.LineCurve3(V(a), V(b))
  const blood = {
    aorta: addParticles(P.aorta, 14, 0xff5a4d, 0.034, 0.32), svc: addParticles(P.svc, 4, 0x6c7fe0, 0.03, 0.3), ivc: addParticles(P.ivc, 8, 0x6c7fe0, 0.03, 0.3, -1),
    carL: addParticles(P.carotidL, 4, 0xff5a4d, 0.026, 0.4, -1), carR: addParticles(P.carotidR, 4, 0xff5a4d, 0.026, 0.4, -1),
  }
  const air = addParticles(P.airwayFlow, 8, 0xcfeaf5, 0.03, 0.5)
  const swallow = addParticles(P.esophagus, 3, 0xffd8a8, 0.05, 0.12)
  const bowel = addParticles(P.smallBowel, 14, 0xffd8a8, 0.045, 0.05), colonDots = addParticles(P.colon, 8, 0xc9a37a, 0.05, 0.03)
  const urine = [...addParticles(P.ureterR, 5, 0xffe066, 0.026, 0.12), ...addParticles(P.ureterL, 5, 0xffe066, 0.026, 0.12)]
  const adrenaline = [-1, 1].flatMap((s) => addParticles(line(sceneOf(s * 5.4, -6.2, -26.6), sceneOf(-1.4, -4.2, -27)), 5, 0xffd43b, 0.026, 0.3))
  const sparks = addParticles(line(sceneOf(2.5, 2, -8), sceneOf(-3, -1, -9)), 4, 0xffe066, 0.024, 0)
  const conduction = addParticles(P.conduction, 1, 0xfff3a0, 0.05, 0)[0]
  const pathParts = pathRigs.map((r) => ({ r, items: addParticles(r.path.curve, 6, r.path.color, r.path.kind === 'limb' ? 0.026 : 0.02, 0.2, r.path.direction === 'up' ? -1 : 1, r.track) }))

  // ---- labels with leader lines ---------------------------------------------------------------------------------------------------
  const labels = new Map<OrganId, { sprite: THREE.Sprite; line: THREE.Line }>()
  const lineMat = own(new THREE.LineBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.35, depthTest: false }))
  const makeLabels = (f: string, h: string) => {
    for (const { sprite, line: ln } of labels.values()) { sprite.material.map?.dispose(); sprite.material.dispose(); layerGroups.labels.remove(sprite, ln); ln.geometry.dispose() }
    labels.clear()
    for (const id of ORGAN_IDS) {
      const o = ORGANS[id], sprite = labelSprite(SHORT[id], f, h), side = LABEL_SIDE[id]
      const anchor = V(o.pos)
      const pos = id === 'eyes' ? new THREE.Vector3(0, 1.75, 0.5) : new THREE.Vector3(side * 2.55, 0.2, sceneOf(0, 0, LABEL_Z[id])[2])
      sprite.position.copy(pos); sprite.userData.organ = id
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([anchor, pos.clone().add(new THREE.Vector3(-side * 0.38, 0, 0))]), lineMat); ln.renderOrder = 5
      layerGroups.labels.add(sprite, ln); labels.set(id, { sprite, line: ln })
    }
  }
  makeLabels(fg, halo)

  // ---- state ---------------------------------------------------------------------------------------------------------------------------
  let states: Record<OrganId, OrganState> | null = null, picked: OrganId | null = null
  let scn: ScenarioId = 'healthy'
  let liveFrame: LiveFrame | null = null, liveBase: Baseline = { emg: {} }
  let physio = physioAt('healthy', 0)
  const active = (o: OrganId) => !!states && states[o].level > 0
  const clock = { last: 0, beatT: 0, beatPeriod: 0.83, beatNo: 0, breathT: 0 }
  const rand = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  const tmp = new THREE.Vector3(), mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), sc = new THREE.Vector3()
  const lungRigs = rigs.filter((r) => r.part.id.startsWith('lung.'))
  const vesselRigs = rigs.filter((r) => r.layer === 'vessels')
  const rebuildLesions = () => {
    markers.forEach((m) => layerGroups.nerves.remove(m)); markers.length = 0
    for (const r of pathRigs) r.cutT = null
    for (const spot of lesionSpots.filter((s) => s.scenario === scn)) {
      const r = pathRigs.find((x) => x.path.id === spot.id); if (!r) continue
      const m = new THREE.Mesh(markerGeo, markerMat); m.position.copy(spot.at); m.scale.setScalar(spot.r); m.renderOrder = 4
      layerGroups.nerves.add(m); markers.push(m); if (scn !== 'epilepsy') r.cutT = Math.max(r.cutT ?? 0, r.track.nearestT(spot.at))
    }
  }
  const heartPivot = byId.get('heart.LV')!.part.pivot!
  const white = new THREE.Color(0xffffff), grey = new THREE.Color(0x868e96), col = new THREE.Color()

  return {
    group, pickables,
    setStates(s, selected) { states = s; picked = selected },
    setScenario(_system, scenario) { scn = scenario; rebuildLesions() },
    setLive(frame, baseline) { liveFrame = frame; liveBase = baseline },
    setLayers(l) {
      layerGroups.skin.visible = l.skin; layerGroups.skeleton.visible = l.skeleton; layerGroups.organs.visible = l.organs; layerGroups.vessels.visible = l.vessels
      layerGroups.nerves.visible = l.nerves; layerGroups.muscles.visible = l.muscles; layerGroups.labels.visible = l.labels
    },
    retheme(f, h) { const vis = layerGroups.labels.visible; makeLabels(f, h); layerGroups.labels.visible = vis },
    physio: () => physio,
    tick(t) {
      const dt = Math.min(0.1, Math.max(0, t - clock.last)); clock.last = t
      physio = applyLive(physioAt(scn, t), liveFrame, liveBase)
      const any = !!states && ORGAN_IDS.some((id) => states![id].level > 0)

      // ---- heart: its own rate and rhythm; atria then ventricles contract, a spark runs SA node -> AV node -> apex ------------------------
      clock.beatT += dt
      if (clock.beatT >= clock.beatPeriod) {
        clock.beatT -= clock.beatPeriod; clock.beatNo++
        const irr = physio.heart.irregular, base = 60 / physio.heart.bpm
        clock.beatPeriod = Math.max(0.25, base * (1 + (rand(clock.beatNo) - 0.5) * 1.3 * irr))
      }
      const x = Math.min(1, clock.beatT / clock.beatPeriod)
      const atrial = physio.heart.irregular > 0.3 ? 0.35 * rand(Math.floor(t * 18)) : bump(x, 0.02, 0.16), vent = bump(x, 0.16, 0.5)
      const kc = physio.heart.contractility
      for (const [id, k, sz] of [['heart.LV', vent, 0.085], ['heart.RV', vent, 0.07], ['heart.RA', atrial, 0.07], ['heart.LA', atrial, 0.07]] as const) {
        const s = 1 - sz * k * kc
        pivotScale(byId.get(id)!.mesh, heartPivot, s, s, 1 - sz * 0.7 * k * kc)
      }
      for (const id of ['heart.coronary', 'heart.aorta']) { const r = byId.get(id); if (r) pivotScale(r.mesh, heartPivot, 1 + 0.01 * vent, 1 + 0.01 * vent, 1) }
      conduction.on = x < 0.3; conduction.t = x / 0.3
      sparks.forEach((p, i) => { p.on = physio.heart.irregular > 0.3; p.t = rand(Math.floor(t * 14) + i * 7) })
      const beatSpeed = (physio.heart.bpm / 72) * 0.32
      blood.aorta.forEach((p) => { p.speed = beatSpeed }); blood.svc.forEach((p) => { p.speed = beatSpeed * 0.9 }); blood.ivc.forEach((p) => { p.speed = beatSpeed * 0.9 })
      blood.carL.forEach((p) => { p.speed = beatSpeed * 1.2 }); blood.carR.forEach((p) => { p.speed = beatSpeed * 1.2 })

      // ---- breathing: lungs, diaphragm and airflow; apnea holds the chest still and the lungs turn blue ---------------------------------------
      clock.breathT += dt * (physio.lungs.rpm / 60) * (1 - physio.lungs.apnea)
      const insp = physio.lungs.apnea > 0.5 ? 0.9 : 0.5 - 0.5 * Math.cos(clock.breathT * Math.PI * 2)
      const dia = byId.get('diaphragm')!
      pivotScale(dia.mesh, dia.part.pivot!, 1, 1, 1 - 0.2 * insp * Math.min(1.4, physio.lungs.depth * physio.diaphragm))
      const cyan = Math.min(1, Math.max(0, (97 - physio.lungs.spo2) / 18))
      for (const r of lungRigs) {
        const d = Math.min(1.5, physio.lungs.depth), s = 1 + 0.075 * insp * d, sz = 1 + 0.1 * insp * d
        pivotScale(r.mesh, r.part.pivot!, s, s, sz)
        const cons = r.part.id === 'lung.R.lower' ? physio.lungs.consolidation : 0
        r.mat.color.setRGB(1 - 0.35 * cyan - 0.18 * cons, 1 - 0.28 * cyan - 0.2 * cons, 1 + 0.1 * cyan - 0.5 * cons)
        r.mat.opacity = (any && !active('lungs') && picked !== 'lungs' ? 0.25 : 0.55) + 0.3 * cons
      }
      const flowOn = physio.lungs.apnea < 0.5
      air.forEach((p) => { p.on = flowOn; p.speed = 0.4 * (physio.lungs.rpm / 14) * physio.lungs.depth; p.dir = Math.sin(clock.breathT * Math.PI * 2) > 0 ? 1 : -1 })

      // ---- swallowing and the gut -----------------------------------------------------------------------------------------------------------
      swallow.forEach((p, i) => { p.speed = 0.1 * physio.esophagus; p.scale = physio.esophagus < 0.6 && Math.sin(t * 9 + i) > 0 ? 0.6 : 1 })
      const st = byId.get('stomach')!
      pivotScale(st.mesh, new THREE.Vector3(...sceneOf(-4, 3, -26)), 1 + 0.045 * physio.stomach * Math.sin(t * 2.4), 1 + 0.02 * Math.sin(t * 3.1) * physio.stomach, 1)
      bowel.forEach((p) => { p.speed = 0.05 * physio.gut }); colonDots.forEach((p) => { p.speed = 0.03 * physio.gut })

      // ---- adrenals, kidneys, bladder ------------------------------------------------------------------------------------------------------------
      const adrOut = Math.min(3, physio.adrenals)
      adrenaline.forEach((p, i) => { p.on = i % 5 < Math.round(adrOut * 1.6); p.speed = 0.25 + 0.25 * adrOut })
      urine.forEach((p, i) => { p.on = i % 5 < Math.max(1, Math.round(physio.kidneys * 4)); p.speed = 0.1 * physio.kidneys })
      const bl = byId.get('bladder')!, fill = physio.bladder.control > 0.2 ? 1 + 0.4 * physio.bladder.urgency : 0.65
      pivotScale(bl.mesh, bl.part.pivot!, fill, fill, fill)

      // ---- organ highlight and emphasis ------------------------------------------------------------------------------------------------------------
      for (const r of rigs) {
        const o = r.part.organ, lvl = states?.[o]?.level ?? 0, sel = picked === o
        const wave = 0.5 + 0.5 * Math.sin(t * (2 + 3 * lvl) + r.mesh.id)
        r.mat.emissiveIntensity = sel ? 0.5 + 0.25 * Math.sin(t * 5) : lvl > 0 ? (0.14 + 0.4 * lvl) * (0.6 + 0.4 * wave) : o === 'heart' ? vent * 0.25 : 0
        if (r.part.opacity === undefined && r.layer === 'organs') { const dim = any && lvl === 0 && !sel; r.mat.transparent = dim; r.mat.opacity = dim ? 0.28 : 1; r.mat.depthWrite = !dim }
      }
      for (const r of vesselRigs) if (r.part.opacity === undefined) { const dim = any && !active('heart') && !active('kidneys'); r.mat.transparent = dim; r.mat.opacity = dim ? 0.3 : 1 }
      eyeMat.emissiveIntensity = picked === 'eyes' ? 0.5 : active('eyes') ? 0.3 + 0.2 * Math.sin(t * 3) : 0

      // ---- muscles: weakness, stiffness, tremor, convulsion ---------------------------------------------------------------------------------------
      for (const l of limbs) {
        const strength = l.side === 1 ? physio.muscle.strengthR : physio.muscle.strengthL
        const shake = physio.muscle.spasm * 0.045 + physio.muscle.tremor * 0.012
        const j = shake * Math.sin(t * (physio.muscle.spasm > 0.3 ? 28 : 16) + l.mesh.id * 1.7)
        const atrophy = 0.55 + 0.45 * Math.min(1, strength), weak = 1 - Math.min(1, strength)
        l.mesh.scale.set(atrophy, atrophy, 1)
        l.mesh.position.set(l.pivot.x * (1 - atrophy) + j, l.pivot.y * (1 - atrophy) + j * 0.6, j * 0.5)
        l.mat.color.setRGB(1 - 0.35 * weak, 1 - 0.1 * weak, 1 + 0.1 * weak)
        l.mat.emissiveIntensity = Math.max(0, (physio.muscle.tone - 1) * 0.28) * (0.6 + 0.4 * Math.sin(t * 4 + l.mesh.id)) + (active('muscle') ? 0.12 : 0) + (picked === 'muscle' ? 0.3 : 0)
      }

      // ---- nerve pathways: strength is shown as colour, brightness and how many signals get through ---------------------------------------------
      for (const pr of pathRigs) {
        const lv = pathwayLevel(physio, pr.path.id); pr.level = lv
        col.set(pr.path.color)
        if (lv < 0.6) col.lerp(grey, (1 - lv / 0.6) * 0.9); else if (lv > 1.2) col.lerp(white, Math.min(0.6, (lv - 1.2) * 0.5))
        pr.mat.color.copy(col); pr.mat.opacity = 0.18 + 0.6 * Math.min(1, lv) + (lv > 1.2 ? 0.2 : 0)
      }
      for (const { r, items } of pathParts) {
        const lv = r.level, n = Math.min(items.length, Math.round(Math.min(1.6, lv) * 4)), speed = 0.13 + 0.14 * Math.min(1.8, lv)
        items.forEach((p, i) => {
          p.on = i < n; p.speed = speed
          const past = r.cutT !== null && (r.path.direction === 'up' ? p.t < r.cutT : p.t > r.cutT)
          p.scale = past ? 0.55 : 1
        })
      }

      // ---- write every live particle into the instanced mesh ---------------------------------------------------------------------------------------
      let n = 0
      for (const p of parts) {
        if (!p.on) continue
        if (p.speed !== 0) { p.t += p.dir * p.speed * dt; if (p.t > 1) p.t -= 1; if (p.t < 0) p.t += 1 }
        p.track.at(p.t, tmp); sc.setScalar(p.size * p.scale)
        mtx.compose(tmp, quat, sc); dots.setMatrixAt(n, mtx); dots.setColorAt(n, p.color); n++
      }
      dots.count = n; dots.instanceMatrix.needsUpdate = true; if (dots.instanceColor) dots.instanceColor.needsUpdate = true
      layerGroups.labels.children.forEach((o) => { const s = o as THREE.Sprite; if (s.isSprite) { const org = s.userData.organ as OrganId; s.material.opacity = picked === org ? 1 : any && !active(org) ? 0.35 : 0.9 } })
    },
    dispose() {
      for (const { sprite, line: ln } of labels.values()) { sprite.material.map?.dispose(); sprite.material.dispose(); ln.geometry.dispose() }
      owned.forEach((o) => o.dispose()); dots.dispose(); void eyeParts
    },
  }
}
