'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { LOBE_RGB, cerebellumGeometry, hemisphere, lobeAt, type Hemisphere, type Lobe } from '@/lib/brain-geometry'
import { buildRoutes, nucleusPoint } from '@/lib/brain-paths'
import { NUC_NAME, SCENARIOS, type ScenarioId, type SystemId } from '@/lib/neuro'
import { createBody } from '@/lib/body-scene'
import type { Physio } from '@/lib/body-physiology'
import { ORGANS, organStates, type OrganId } from '@/lib/body'

export interface ElectrodeView {
  name: string
  x: number
  y: number
  z: number
  /** 0..1 relative power in the selected band, or null when no data */
  level: number | null
}
export interface Layers {
  heat: boolean; lobes: boolean; scalp: boolean; arcs: boolean; labels: boolean; cereb: boolean
  /** the body: master switch, then each system on its own */
  body: boolean; skin: boolean; skeleton: boolean; organs: boolean; vessels: boolean; nerves: boolean; muscles: boolean
}
export type ViewName = 'home' | 'top' | 'front' | 'back' | 'left' | 'right' | 'body' | 'chest' | 'abdomen' | 'spine'
export const DEFAULT_LAYERS: Layers = { heat: true, lobes: true, scalp: true, arcs: true, labels: true, cereb: true, body: true, skin: true, skeleton: true, organs: true, vessels: true, nerves: true, muscles: true }

const LOW = [59, 130, 246], MID = [246, 130, 31], HIGH = [239, 68, 68]
const mix = (a: number[], b: number[], k: number) => a.map((x, i) => x + (b[i] - x) * k)
/** Blue (low) through orange to red (high), as 0..255 channels. */
export function rampRgb(level: number | null): number[] {
  if (level == null) return [107, 107, 107]
  const t = Math.max(0, Math.min(1, level))
  return t < 0.5 ? mix(LOW, MID, t * 2) : mix(MID, HIGH, (t - 0.5) * 2)
}
export const rampColor = (level: number | null) => new THREE.Color(...rampRgb(level).map((v) => v / 255))

const VIEWS: Record<ViewName, [number, number]> = { home: [0.75, 1.12], top: [0, 0.12], front: [0, 1.45], back: [Math.PI, 1.45], left: [-Math.PI / 2, 1.45], right: [Math.PI / 2, 1.45], body: [0.35, 1.45], chest: [0.25, 1.5], abdomen: [0.25, 1.5], spine: [Math.PI, 1.5] }
/** Camera distance and the height the camera looks at for each view. */
const VIEW_FRAME: Partial<Record<ViewName, { r: number; tz: number }>> = { body: { r: 22, tz: -5.4 }, chest: { r: 6.4, tz: -2.5 }, abdomen: { r: 6.8, tz: -4.3 }, spine: { r: 11, tz: -3.2 } }
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'

interface Api {
  setElectrodes(e: ElectrodeView[], sel: string | null): void
  setLinks(l: [string, string][]): void
  setLayers(l: Layers): void
  setView(v: ViewName): void
  setSpin(s: boolean): void
  setScene(system: SystemId | 'none', scenario: ScenarioId): void
  setOrgan(organ: OrganId | null): void
}
interface Props {
  electrodes: ElectrodeView[]
  selected: string | null
  onSelect: (name: string) => void
  onCortex?: (lobe: Lobe) => void
  spin: boolean
  links: [string, string][]
  layers?: Layers
  view?: { name: ViewName; nonce: number }
  system?: SystemId | 'none'
  scenario?: ScenarioId
  organ?: OrganId | null
  onOrgan?: (organ: OrganId | null) => void
  /** the body's current vitals, about four times a second */
  onPhysio?: (p: Physio) => void
}

export default function Brain3D({ electrodes, selected, onSelect, onCortex, spin, links, layers = DEFAULT_LAYERS, view, system = 'none', scenario = 'healthy', organ = null, onOrgan, onPhysio }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const cb = useRef({ onSelect, onCortex, onOrgan, onPhysio })
  useEffect(() => { cb.current = { onSelect, onCortex, onOrgan, onPhysio } }, [onSelect, onCortex, onOrgan, onPhysio])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }) } catch { el.dataset.nogl = '1'; return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50); camera.up.set(0, 0, 1)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f86, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(3, 4, 5); scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-4, -3, 1); scene.add(fill)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.minDistance = 2.4; controls.maxDistance = 30; controls.enablePan = false; controls.autoRotateSpeed = 1.4

    // ---- the brain ---------------------------------------------------------------------------------------------
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 })
    const hemis: Hemisphere[] = [hemisphere(-1), hemisphere(1)]
    const cortex = hemis.map((h) => { const m = new THREE.Mesh(h.geometry, mat); scene.add(m); return m })
    const cereb = new THREE.Group(); scene.add(cereb)
    cereb.add(new THREE.Mesh(cerebellumGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })))
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.085, 0.62, 24), new THREE.MeshStandardMaterial({ color: 0xc9a39c, roughness: 0.7 }))
    stem.position.set(0, -0.36, -0.68); stem.rotation.x = 0.35; cereb.add(stem)

    // ---- scalp ---------------------------------------------------------------------------------------------------
    const scalp = new THREE.Group(); scene.add(scalp)
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 36), new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false }))
    shell.scale.set(1.12, 1.28, 0.98); scalp.add(shell)
    const wire = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x9aa0a6, wireframe: true, transparent: true, opacity: 0.1, depthWrite: false }))
    wire.scale.copy(shell.scale); scalp.add(wire)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 16), new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.55 }))
    nose.position.set(0, 1.38, -0.05); nose.rotation.x = -Math.PI / 2; scalp.add(nose)
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.4 }))
      ear.scale.set(0.5, 1, 1.4); ear.position.set(s * 1.14, 0, -0.08); scalp.add(ear)
    }

    // ---- the body (schematic, below the neck) --------------------------------------------------------------------
    const body = createBody(css('--fg'), css('--surface')); scene.add(body.group)
    let organSel: OrganId | null = null

    // ---- electrodes ----------------------------------------------------------------------------------------------
    const electrodesGroup = new THREE.Group(), labelsGroup = new THREE.Group(), stems = new THREE.Group(), arcs = new THREE.Group(), pulses = new THREE.Group(), paths = new THREE.Group(), lesions = new THREE.Group()
    scene.add(electrodesGroup, labelsGroup, stems, arcs, pulses, paths, lesions)
    const ringGeo = new THREE.TorusGeometry(1, 0.09, 8, 36)
    interface Elec { mesh: THREE.Mesh; ring: THREE.Mesh; dir: [number, number, number]; base: number; lvl: number | null; name: string }
    const elec = new Map<string, Elec>()
    let current: ElectrodeView[] = [], selected: string | null = null
    const makeElectrode = (e: ElectrodeView): Elec => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf6821f }))
      mesh.position.set(e.x * 1.12, e.y * 1.28, e.z * 0.98); mesh.userData.name = e.name; electrodesGroup.add(mesh)
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })); ring.visible = false; mesh.add(ring)
      const lg = new THREE.BufferGeometry().setFromPoints([mesh.position.clone(), new THREE.Vector3(e.x * 0.9, e.y, e.z * 0.76)])
      stems.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.35 })))
      return { mesh, ring, dir: [e.x, e.y, e.z], base: 0.05, lvl: null, name: e.name }
    }
    const makeLabels = () => {
      while (labelsGroup.children.length) { const o = labelsGroup.children.pop() as THREE.Sprite; o.material.map?.dispose(); o.material.dispose() }
      const fg = css('--fg'), halo = css('--surface')
      for (const [n, e] of elec) {
        const c = document.createElement('canvas'); c.width = 128; c.height = 56; const g = c.getContext('2d')!
        g.font = '600 30px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 7; g.strokeStyle = halo; g.strokeText(n, 64, 38); g.fillStyle = fg; g.fillText(n, 64, 38)
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }))
        const p = e.mesh.position; sp.position.set(p.x * 1.1, p.y * 1.1, p.z * 1.1 + 0.07); sp.scale.set(0.34, 0.15, 1); labelsGroup.add(sp)
      }
    }
    const textSprite = (text: string, scale: number) => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 56; const g = c.getContext('2d')!
      g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 7; g.strokeStyle = css('--surface'); g.strokeText(text, 160, 36); g.fillStyle = css('--fg'); g.fillText(text, 160, 36)
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }))
      sp.scale.set(scale, (scale * 56) / 320, 1); return sp
    }
    const disposeGroup = (g: THREE.Object3D) => {
      while (g.children.length) {
        const o = g.children.pop() as THREE.Mesh & THREE.Sprite
        if (o.children?.length) disposeGroup(o)
        o.geometry?.dispose?.()
        const m = o.material as THREE.Material & { map?: THREE.Texture } | undefined
        if (m) { m.map?.dispose?.(); m.dispose() }
      }
    }

    // ---- state ---------------------------------------------------------------------------------------------------
    let L: Layers = { ...DEFAULT_LAYERS }, sys: SystemId | 'none' = 'none', scn: ScenarioId = 'healthy'
    const target = new Float32Array(hemis[0].n * 3 * 2)
    const pathPulses: { curve: THREE.CatmullRomCurve3; dot: THREE.Mesh; t: number; sp: number }[] = []
    const arcPulses: { curve: THREE.QuadraticBezierCurve3; dot: THREE.Mesh; t: number; sp: number }[] = []
    let tween: { th: number; ph: number; r: number; tz: number } | null = null

    function recolor(snap: boolean) {
      const lv = [...elec.values()].filter((e) => e.lvl != null)
      hemis.forEach((h, hi) => {
        for (let i = 0; i < h.n; i++) {
          const lw = h.lobes[i]; let base: number[] = LOBE_RGB.base, tot = 0
          if (L.lobes) { base = [0, 0, 0]; for (const k of Object.keys(lw) as Lobe[]) { const c = LOBE_RGB[k]; base[0] += c[0] * lw[k]; base[1] += c[1] * lw[k]; base[2] += c[2] * lw[k]; tot += lw[k] }; if (tot > 0) base = base.map((x) => x / tot) }
          if (SCENARIOS[scn].atrophy) { const f = 1 - 0.3 * (lw.temporal + lw.parietal); base = base.map((x) => x * f) }
          let out = base
          if (L.heat && lv.length) {
            const px = h.P[i * 3], py = h.P[i * 3 + 1], pz = h.P[i * 3 + 2]; let ws = 0, ls = 0
            for (const e of lv) { const dx = px - e.dir[0] * 0.9, dy = py - e.dir[1], dz = pz - e.dir[2] * 0.76, w = Math.exp(-(dx * dx + dy * dy + dz * dz) / 0.09); ws += w; ls += w * (e.lvl as number) }
            if (ws > 0.02) { const inf = Math.min(1, ws * 0.9), c = rampRgb(ls / ws); out = base.map((b, k) => b + (c[k] - b) * (0.12 + 0.78 * inf)) }
          }
          const o = hi * h.n * 3 + i * 3
          target[o] = out[0] / 255; target[o + 1] = out[1] / 255; target[o + 2] = out[2] / 255
          if (snap) { h.C[i * 3] = out[0] / 255; h.C[i * 3 + 1] = out[1] / 255; h.C[i * 3 + 2] = out[2] / 255 }
        }
        if (snap) h.geometry.attributes.color.needsUpdate = true
      })
    }
    function easeColors() {
      hemis.forEach((h, hi) => {
        let moved = false; const o = hi * h.n * 3
        for (let i = 0; i < h.n * 3; i++) { const d = target[o + i] - h.C[i]; if (Math.abs(d) > 0.002) { h.C[i] += d * 0.16; moved = true } }
        if (moved) h.geometry.attributes.color.needsUpdate = true
      })
    }
    function buildPaths() {
      disposeGroup(paths); disposeGroup(lesions); pathPulses.length = 0
      const sc = SCENARIOS[scn]
      for (const l of sc.lesions) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(l.r, 24, 16), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35, depthWrite: false }))
        m.position.set(...l.p); m.userData.focus = !!l.focus; lesions.add(m)
        const w = new THREE.Mesh(new THREE.SphereGeometry(l.r * 1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xef4444, wireframe: true, transparent: true, opacity: 0.5 })); w.position.copy(m.position); lesions.add(w)
        const t = textSprite(l.focus ? 'seizure focus' : 'damage', 0.3); t.position.set(l.p[0], l.p[1], l.p[2] + l.r + 0.12); lesions.add(t)
      }
      const see = sys !== 'none' || sc.lesions.length > 0
      mat.transparent = see; mat.opacity = see ? 0.32 : 1; mat.depthWrite = !see; mat.needsUpdate = true
      if (sys === 'none') return
      const labelled = new Set<string>()
      const marker = (k: string, side: -1 | 1, color: string) => {
        const id = k + (side === 1 || ['VTA', 'raphe', 'septum', 'hyp', 'pit', 'adrenal'].includes(k) ? '' : side)
        if (labelled.has(id)) return; labelled.add(id)
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshBasicMaterial({ color })); m.position.copy(nucleusPoint(k, side)); paths.add(m)
        if (side === 1 || id === k) { const t = textSprite(NUC_NAME[k], 0.42); t.position.copy(m.position); t.position.z += 0.1; paths.add(t) }
      }
      for (const r of buildRoutes(sys, scn)) {
        const col = new THREE.Color(r.def.color)
        paths.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(r.live), Math.max(8, r.live.length), 0.01 + 0.005 * r.strength, 6, false), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: r.def.soft ? 0.3 : 0.28 + 0.62 * r.strength })))
        if (r.cut) { const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(r.rest), new THREE.LineDashedMaterial({ color: 0x888888, dashSize: 0.035, gapSize: 0.035, transparent: true, opacity: 0.6 })); ln.computeLineDistances(); paths.add(ln) }
        const curve = new THREE.CatmullRomCurve3(r.live)
        for (let k = 0; k < r.pulses; k++) {
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), new THREE.MeshBasicMaterial({ color: col })); paths.add(d)
          pathPulses.push({ curve, dot: d, t: Math.random(), sp: (0.14 + 0.16 * r.strength) * (r.bidirectional && k % 2 ? -1 : 1) })
        }
        marker(r.def.a, r.side, r.def.color); marker(r.def.b, r.side, r.def.color)
      }
    }
    function applyLayers() {
      scalp.visible = L.scalp; body.group.visible = L.body; body.setLayers({ skin: L.skin, skeleton: L.skeleton, organs: L.organs, vessels: L.vessels, nerves: L.nerves, muscles: L.muscles, labels: L.labels }); labelsGroup.visible = L.labels; arcs.visible = L.arcs; pulses.visible = L.arcs; cereb.visible = L.cereb
      recolor(false)
    }
    function setLinks(pairs: [string, string][]) {
      disposeGroup(arcs); disposeGroup(pulses); arcPulses.length = 0
      const accent = new THREE.Color(css('--accent'))
      for (const [a, b] of pairs.slice(0, 40)) {
        const A = elec.get(a)?.mesh.position, B = elec.get(b)?.mesh.position; if (!A || !B) continue
        const mid = A.clone().add(B).multiplyScalar(0.5).normalize().multiplyScalar(Math.max(A.length(), B.length()) + 0.16 + A.distanceTo(B) * 0.28)
        const curve = new THREE.QuadraticBezierCurve3(A, mid, B)
        arcs.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(28)), new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.5 })))
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: accent })); pulses.add(dot)
        arcPulses.push({ curve, dot, t: Math.random(), sp: 0.22 + Math.random() * 0.2 })
      }
    }
    function setElectrodes(list: ElectrodeView[], sel: string | null) {
      current = list; selected = sel
      for (const e of list) if (!elec.has(e.name)) { elec.set(e.name, makeElectrode(e)); makeLabels() }
      const known = list.filter((e) => e.level != null).map((e) => e.level as number)
      const lo = Math.min(...known), hi = Math.max(...known)
      for (const [n, e] of elec) {
        const v = list.find((x) => x.name === n)?.level ?? null
        e.lvl = v == null ? null : hi === lo ? 0.5 : (v - lo) / (hi - lo)
        e.base = 0.045 + (e.lvl ?? 0) * 0.04
        const c = rampRgb(e.lvl); (e.mesh.material as THREE.MeshBasicMaterial).color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255)
        e.ring.visible = n === sel
      }
      recolor(false)
    }
    function setView(name: ViewName) { const [th, ph] = VIEWS[name], f = VIEW_FRAME[name]; tween = { th, ph, r: f?.r ?? (name === 'home' ? 4.4 : 4.2), tz: f?.tz ?? 0 } }
    const sphToCam = (th: number, ph: number, r: number) => camera.position.set(controls.target.x + r * Math.sin(ph) * Math.sin(th), controls.target.y + r * Math.sin(ph) * Math.cos(th), controls.target.z + r * Math.cos(ph))
    sphToCam(...([...VIEWS.home, 4.4] as [number, number, number]))

    api.current = {
      setElectrodes, setLinks, setLayers: (l) => { L = l; applyLayers() }, setView, setSpin: (s) => { controls.autoRotate = s },
      setScene: (s, c) => { sys = s; scn = c; buildPaths(); recolor(false); body.setScenario(s, c); body.setStates(organStates(s, c), organSel) },
      setOrgan: (o) => { organSel = o; body.setStates(organStates(sys, scn), o) },
    }

    // ---- interaction ---------------------------------------------------------------------------------------------
    const ray = new THREE.Raycaster()
    const pick = (ev: PointerEvent | MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera)
      const e = ray.intersectObjects(electrodesGroup.children, false)[0]
      if (e) return { type: 'electrode' as const, name: e.object.userData.name as string }
      const o = L.body ? ray.intersectObjects(body.pickables, false)[0] : undefined
      const c = ray.intersectObjects(cortex, false)[0]
      if (o && (!c || o.distance < c.distance)) return { type: 'organ' as const, organ: o.object.userData.organ as OrganId, label: String(o.object.userData.label ?? '') }
      return c ? { type: 'cortex' as const, lobe: lobeAt([c.point.x, c.point.y, c.point.z]) } : null
    }
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; tween = null }
    const onClick = (e: MouseEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return        // that was a drag, not a click
      const h = pick(e); if (!h) return
      if (h.type === 'electrode') cb.current.onSelect(h.name); else if (h.type === 'organ') cb.current.onOrgan?.(h.organ); else cb.current.onCortex?.(h.lobe)
    }
    const onMove = (e: PointerEvent) => {
      const t = tip.current; if (!t || e.buttons) { if (t) t.hidden = true; return }
      const h = pick(e), box = host.current!.getBoundingClientRect()
      if (!h) { t.hidden = true; renderer.domElement.style.cursor = 'grab'; return }
      renderer.domElement.style.cursor = h.type === 'electrode' || h.type === 'organ' ? 'pointer' : 'grab'
      t.hidden = false; t.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 150)}px`; t.style.top = `${e.clientY - box.top + 12}px`
      t.textContent = h.type === 'organ' ? (h.label || ORGANS[h.organ].name) : h.type === 'electrode' ? `${h.name} · ${current.find((x) => x.name === h.name)?.level != null ? Math.round((current.find((x) => x.name === h.name)!.level as number) * 100) + '%' : 'no data'}` : `${h.lobe} lobe`
    }
    const dom = renderer.domElement
    dom.addEventListener('pointerdown', onDown); dom.addEventListener('click', onClick); dom.addEventListener('pointermove', onMove); dom.addEventListener('pointerleave', () => { if (tip.current) tip.current.hidden = true })

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
    const ro = new ResizeObserver(resize); ro.observe(el); resize()
    const retheme = () => { makeLabels(); body.retheme(css('--fg'), css('--surface')) }
    const mo = new MutationObserver(retheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', retheme)

    let raf = 0, lastVitals = -1; const t0 = performance.now(); const sph = new THREE.Spherical()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      const t = (performance.now() - t0) / 1000
      if (tween) {
        const off = camera.position.clone().sub(controls.target)
        sph.setFromVector3(off)
        const cur = Math.atan2(off.x, off.y)
        let dth = tween.th - cur; dth = Math.atan2(Math.sin(dth), Math.cos(dth))
        controls.target.z += (tween.tz - controls.target.z) * 0.14
        const th = cur + dth * 0.14, ph = sph.phi + (tween.ph - sph.phi) * 0.14, r = sph.radius + (tween.r - sph.radius) * 0.14
        sphToCam(th, ph, r)
        if (Math.abs(dth) < 0.005 && Math.abs(tween.ph - ph) < 0.005 && Math.abs(tween.tz - controls.target.z) < 0.01) tween = null
      }
      body.tick(t)
      if (t - lastVitals > 0.25) { lastVitals = t; cb.current.onPhysio?.(body.physio()) }
      controls.update(); easeColors()
      for (const e of elec.values()) { const pulse = 1 + 0.12 * Math.sin(t * (1.6 + (e.lvl ?? 0) * 4) + e.name.length); e.mesh.scale.setScalar(e.base * pulse * (e.name === selected ? 1.35 : 1)); if (e.ring.visible) { e.ring.scale.setScalar(1.6 + 0.2 * Math.sin(t * 5)); e.ring.lookAt(camera.position) } }
      for (const p of arcPulses) { p.t = (p.t + p.sp * 0.016) % 1; p.dot.position.copy(p.curve.getPoint(p.t)) }
      for (const p of pathPulses) { p.t = (p.t + p.sp * 0.016 + 1) % 1; p.dot.position.copy(p.curve.getPoint(p.t)) }
      const spiking = scn === 'epilepsy' && t % 5.5 < 0.6
      lesions.children.forEach((o, i) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m && !(o as THREE.Sprite).isSprite) m.opacity = spiking && o.userData.focus ? 0.95 : (m.wireframe ? 0.5 : 0.35) + 0.12 * Math.sin(t * 3 + i) })
      labelsGroup.children.forEach((s) => { const d = camera.position.distanceTo(s.position); ((s as THREE.Sprite).material as THREE.SpriteMaterial).opacity = Math.max(0.25, Math.min(1, 1.4 - d * 0.16)) })
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); mq.removeEventListener('change', retheme)
      dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('click', onClick); dom.removeEventListener('pointermove', onMove)
      controls.dispose()
      for (const g of [arcs, pulses, paths, lesions, labelsGroup]) disposeGroup(g)
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose()) })
      body.dispose(); ringGeo.dispose(); renderer.dispose(); dom.remove(); api.current = null
    }
  }, [])

  useEffect(() => { api.current?.setElectrodes(electrodes, selected) }, [electrodes, selected])
  useEffect(() => { api.current?.setLinks(links) }, [links])
  useEffect(() => { api.current?.setLayers(layers) }, [layers])
  useEffect(() => { api.current?.setSpin(spin) }, [spin])
  useEffect(() => { api.current?.setScene(system, scenario) }, [system, scenario])
  useEffect(() => { if (view) api.current?.setView(view.name) }, [view])
  useEffect(() => { api.current?.setOrgan(organ) }, [organ])

  return (
    <div className="relative">
      <div ref={host} className="w-full h-[clamp(380px,64vh,620px)] rounded-md border border-line bg-canvas touch-none" role="img"
        aria-label="Interactive 3D schematic of the brain with EEG electrodes coloured by band power, and a simplified body below it showing organs the brain reaches. Drag to rotate, scroll or pinch to zoom, click an electrode or an organ for details." />
      <div ref={tip} hidden className="absolute pointer-events-none bg-surface border border-line rounded px-2 py-1 text-xs shadow" />
    </div>
  )
}
