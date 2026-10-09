'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface ElectrodeView {
  name: string
  x: number
  y: number
  z: number
  /** 0..1 relative power in the selected band, or null when no data */
  level: number | null
}

const LOW = new THREE.Color('#3b82f6')
const MID = new THREE.Color('#f6821f')
const HIGH = new THREE.Color('#ef4444')
const IDLE = new THREE.Color('#6b6b6b')

export function rampColor(level: number | null) {
  if (level == null) return IDLE.clone()
  const t = Math.max(0, Math.min(1, level))
  return t < 0.5 ? LOW.clone().lerp(MID, t * 2) : MID.clone().lerp(HIGH, (t - 0.5) * 2)
}

/** A schematic brain: two folded hemispheres as a point cloud inside a faint scalp sphere. Not anatomical. */
function brainPoints() {
  const pts: number[] = []
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  while (pts.length < 9000 * 3) {
    const u = rnd() * 2 - 1
    const th = rnd() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    let x = r * Math.cos(th), y = r * Math.sin(th), z = u
    const fold = 1 + 0.045 * Math.sin(9 * x + 3 * z) * Math.cos(8 * y) + 0.03 * Math.sin(14 * z + 5 * y)
    x *= 0.78 * fold; y *= 0.98 * fold; z *= 0.7 * fold
    if (Math.abs(x) < 0.04) continue                    // the longitudinal fissure
    z = z > 0 ? z : z * 0.75                            // flatter underneath
    pts.push(x, y, z)
  }
  return new Float32Array(pts)
}

export default function Brain3D({ electrodes, selected, onSelect, spin, links }: {
  electrodes: ElectrodeView[]
  selected: string | null
  onSelect: (name: string) => void
  spin: boolean
  /** pairs of electrode names drawn as lines (similar level in the chosen band) */
  links: [string, string][]
}) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ update: (e: ElectrodeView[], sel: string | null, spin: boolean, links: [string, string][]) => void } | null>(null)
  const pick = useRef(onSelect)
  useEffect(() => { pick.current = onSelect }, [onSelect])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
    camera.position.set(2.6, -2.4, 1.6)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 2
    controls.maxDistance = 7
    controls.autoRotateSpeed = 1.2

    const scalp = new THREE.Mesh(new THREE.SphereGeometry(1.02, 32, 24), new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true, transparent: true, opacity: 0.07 }))
    scene.add(scalp)
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(brainPoints(), 3))
    const brain = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xc9a6a0, size: 0.012, transparent: true, opacity: 0.55 }))
    scene.add(brain)
    // nose marker so the front is obvious
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 12), new THREE.MeshBasicMaterial({ color: 0x888888 }))
    nose.position.set(0, 1.08, 0)
    nose.rotation.x = -Math.PI / 2
    scene.add(nose)

    const group = new THREE.Group()
    scene.add(group)
    const lineMat = new THREE.LineBasicMaterial({ color: 0xf6821f, transparent: true, opacity: 0.55 })
    let lines: THREE.LineSegments | null = null
    const meshes = new Map<string, THREE.Mesh>()
    const labels = new Map<string, THREE.Sprite>()
    const geo = new THREE.SphereGeometry(1, 16, 12)

    const label = (text: string) => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 48
      const g = c.getContext('2d')!
      g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#d4d4d4'
      g.fillText(text, 64, 32)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }))
      s.scale.set(0.28, 0.105, 1)
      return s
    }

    let current: ElectrodeView[] = []
    let spinning = false
    api.current = {
      update(e, sel, spin, linkPairs) {
        current = e
        spinning = spin
        controls.autoRotate = spin
        for (const el2 of e) {
          let m = meshes.get(el2.name)
          if (!m) {
            m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
            m.userData.name = el2.name
            m.position.set(el2.x, el2.y, el2.z)
            group.add(m); meshes.set(el2.name, m)
            const l = label(el2.name); l.position.set(el2.x * 1.14, el2.y * 1.14, el2.z * 1.14 + 0.04)
            group.add(l); labels.set(el2.name, l)
          }
          const lvl = el2.level
          const s = 0.035 + (lvl ?? 0) * 0.05 + (el2.name === sel ? 0.02 : 0)
          m.userData.base = s
          m.scale.setScalar(s)
          ;(m.material as THREE.MeshBasicMaterial).color.copy(rampColor(lvl))
        }
        if (lines) { group.remove(lines); lines.geometry.dispose(); lines = null }
        const pos: number[] = []
        for (const [a, b] of linkPairs) {
          const A = meshes.get(a)?.position, B = meshes.get(b)?.position
          if (A && B) pos.push(A.x, A.y, A.z, B.x, B.y, B.z)
        }
        if (pos.length) {
          const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
          lines = new THREE.LineSegments(lg, lineMat); group.add(lines)
        }
      },
    }

    const ray = new THREE.Raycaster()
    const onClick = (ev: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(p, camera)
      const hit = ray.intersectObjects([...meshes.values()])[0]
      if (hit) pick.current(hit.object.userData.name as string)
    }
    renderer.domElement.addEventListener('click', onClick)

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize); ro.observe(el); resize()

    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = (performance.now() - t0) / 1000
      for (const e of current) {                                 // gentle pulse proportional to level
        const m = meshes.get(e.name)
        if (m && e.level != null) m.scale.setScalar((m.userData.base as number) * (1 + 0.1 * Math.sin(t * (2 + e.level * 6))))
      }
      controls.update()
      renderer.render(scene, camera)
      if (!spinning) controls.autoRotate = false
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('click', onClick)
      controls.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose?.()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        ;(Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { (x as THREE.SpriteMaterial).map?.dispose(); x.dispose() })
      })
      geo.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      api.current = null
    }
  }, [])

  useEffect(() => { api.current?.update(electrodes, selected, spin, links) }, [electrodes, selected, spin, links])

  return (
    <div ref={host} className="w-full h-[460px] rounded-md border border-line bg-canvas touch-none" role="img"
      aria-label="Interactive 3D schematic of the brain with EEG electrodes coloured by band power. Drag to rotate, scroll to zoom, click an electrode for details." />
  )
}
