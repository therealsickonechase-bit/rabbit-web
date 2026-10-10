'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BUILDS, SKIN_TONES, createAvatar, type Avatar, type Build, type SkinTone } from '@/lib/avatar-body'
import { Mind, type MindInputs, type MindSnapshot } from '@/lib/avatar-mind'
import { ARENA, STOOL, computePose, newWorld, stepWorld } from '@/lib/avatar-motion'
import { SUGGESTED_QUESTIONS, answer, cleanQuestion, describeIntent, organSpot, type Answer, type AvatarContext } from '@/lib/avatar-qa'
import { ORGANS, type OrganId } from '@/lib/body'
import { physioAt } from '@/lib/body-physiology'
import { levelsFrom, type HormoneSource } from '@/lib/hormone-context'
import { eegIndices, isFresh, type LiveFrame } from '@/lib/live-signals'
import type { Level } from '@/lib/body-api'
import type { ScenarioId } from '@/lib/neuro'

// A walking avatar with its own mind. It chooses by itself how to move (sit, stand, stroll, walk, pace, jog, run, stretch, look around) from its mood,
// which comes from hormone levels, the time of day and, if you connect the bridge and choose "mirror", your own EEG and heart rate; otherwise from its own
// simulated twin. You ask it questions instead of clicking on organs. It is a model: it is not conscious and nothing here is medical advice.

interface Msg { who: 'you' | 'avatar'; text: string; note?: string }
const sel = 'rounded border border-line bg-canvas px-1 py-0.5 text-xs'

export default function AvatarPanel({ live, scenario }: { live: LiveFrame | null; scenario: ScenarioId }) {
  const host = useRef<HTMLDivElement | null>(null)
  const [build, setBuild] = useState<Build>('neutral')
  const [tone, setTone] = useState<SkinTone>('medium')
  const [mirror, setMirror] = useState(false)
  const [hormones, setHormones] = useState<'clock' | 'manual'>('clock')
  const [cort, setCort] = useState<Level>('typical')
  const [mel, setMel] = useState<Level>('typical')
  const [hud, setHud] = useState<MindSnapshot | null>(null)
  const [vitals, setVitals] = useState({ heart: 72, breath: 14 })
  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'avatar', text: 'Hello. Ask me anything about my body or my mind: how I feel, why I am moving this way, my organs, my EEG or my hormones.' }])
  const [q, setQ] = useState('')
  const [claude, setClaude] = useState(false)
  const [speak, setSpeak] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nogl, setNogl] = useState(false)

  // everything the animation loop reads lives in refs, so it never restarts when the page re-renders
  const live$ = useRef(live), scenario$ = useRef(scenario), cfg = useRef({ mirror, hormones, cort, mel })
  const snap = useRef<MindSnapshot | null>(null), ctx = useRef<AvatarContext | null>(null), focus = useRef<{ organ: OrganId; until: number } | null>(null)
  useEffect(() => { live$.current = live; scenario$.current = scenario; cfg.current = { mirror, hormones, cort, mel } }, [live, scenario, mirror, hormones, cort, mel])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) } catch { setTimeout(() => setNogl(true), 0); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
    el.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'

    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff)     // white background
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4d0, 1.1))
    const sun = new THREE.DirectionalLight(0xfff4e8, 2.2); sun.position.set(2.5, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025
    Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 14 }); scene.add(sun)
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.7); fill.position.set(-3, 2, 1); scene.add(fill)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.16 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor)
    const ring = new THREE.Mesh(new THREE.RingGeometry(ARENA, ARENA + 0.015, 96), new THREE.MeshBasicMaterial({ color: 0xe4e4e4, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring)
    const stool = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({ color: 0xe8e2da, roughness: 0.8 })
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 28), wood); seat.position.y = 0.44; seat.castShadow = true; stool.add(seat)
    for (let i = 0; i < 4; i++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, 0.44, 8), wood); const a = (i / 4) * Math.PI * 2 + 0.4; leg.position.set(Math.cos(a) * 0.14, 0.22, Math.sin(a) * 0.14); leg.castShadow = true; stool.add(leg) }
    stool.position.set(STOOL.x, 0, STOOL.z); scene.add(stool)

    let avatar: Avatar = createAvatar(build, tone)
    scene.add(avatar.root)
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 16), new THREE.MeshBasicMaterial({ color: 0xe03131, transparent: true, opacity: 0.9, depthTest: false })); marker.renderOrder = 20; marker.visible = false
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.05, 32), new THREE.MeshBasicMaterial({ color: 0xe03131, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide })); halo.renderOrder = 20; marker.add(halo)
    avatar.root.add(marker)

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60); camera.position.set(3.4, 1.6, 4.6)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.target.set(0, 0.95, 0); controls.minDistance = 1.2; controls.maxDistance = 11; controls.maxPolarAngle = Math.PI * 0.52; controls.enablePan = false

    const fit = () => { const w = el.clientWidth || 640, h = el.clientHeight || 480; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
    fit(); const ro = new ResizeObserver(fit); ro.observe(el)

    const mind = new Mind(Math.floor(Math.random() * 1e6)), world = newWorld(), rng = Math.random
    let last = performance.now(), t = 0, hudAt = 0, raf = 0, exertion = 0
    const lastTarget = new THREE.Vector3(0, 0.95, 0), want = new THREE.Vector3()
    const material = avatar.materials

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt
      const c = cfg.current, frame = live$.current, fresh = isFresh(frame, Date.now()) ? frame : null
      const d = new Date(), hour = d.getHours() + d.getMinutes() / 60
      const src: HormoneSource = c.hormones === 'manual' ? { kind: 'manual', cortisol: c.cort, melatonin: c.mel } : { kind: 'clock' }
      const lv = levelsFrom(src, hour)
      const idx = c.mirror && fresh ? eegIndices(fresh) : null
      const inputs: MindInputs = {
        hour, cortisol: lv.cortisol, melatonin: lv.melatonin,
        eeg: idx && idx.channels > 0 ? { engagement: idx.engagement, thetaAlpha: idx.thetaAlpha, asymmetry: idx.frontalAsymmetry } : null,
        heartBpm: c.mirror && fresh?.ecg?.bpm ? fresh.ecg.bpm : null,
      }
      const s = mind.step(dt, inputs)
      snap.current = s
      const physio = physioAt(scenario$.current, t)
      const seizing = physio.phase === 'seizure'
      const intent = seizing ? 'rest' : s.intent
      stepWorld(world, dt, intent, s.gait, rng)
      const moving = Math.hypot(world.x, world.z) >= 0 && s.gait.moving
      exertion += ((moving ? Math.min(1, s.gait.speed / 3.5) : 0) - exertion) * Math.min(1, dt * 0.6)
      const breathRpm = physio.lungs.rpm * (1 + exertion * 0.9 + (s.affect.arousal - 0.5) * 0.2)
      const pose = computePose({
        intent, gait: s.gait, phase: world.phase, t, sit: world.sit, stretch: world.stretch, look: world.look, breathRpm, breathDepth: physio.lungs.depth * (0.8 + exertion * 0.7),
        fatigue: s.affect.fatigue, tremor: physio.muscle.tremor + (seizing ? 0.8 : 0), strengthL: Math.min(1, physio.muscle.strengthL), strengthR: Math.min(1, physio.muscle.strengthR),
      })
      avatar.apply(pose)
      avatar.root.position.set(world.x, 0, world.z); avatar.root.rotation.y = world.heading
      avatar.tint(Math.min(1, s.affect.arousal * 0.5 + exertion * 0.8 + (lv.cortisol === 'high' ? 0.2 : 0)), Math.min(1, s.affect.fatigue * 0.8 + s.affect.stress * 0.2))
      ctx.current = {
        affect: s.affect, emotion: s.emotion, intent, thought: s.thought, reasons: s.reasons, hormones: lv, physio, scenario: scenario$.current,
        source: idx ? 'live signals' : 'simulated twin', eeg: s.eeg,
      }

      // x-ray: while an organ is being talked about, the skin turns see-through and a marker glows where it sits
      const f = focus.current
      const on = !!f && now < f.until
      const k = on ? 1 : 0
      for (const m of [material.skin, material.shirt, material.shorts]) { const target = on ? 0.28 : 1; m.opacity += (target - m.opacity) * Math.min(1, dt * 6); m.transparent = m.opacity < 0.99; m.depthWrite = !m.transparent }
      marker.visible = on
      if (on && f) {
        const [x, y, z] = organSpot(f.organ); marker.position.set(x, y, z)
        const col = new THREE.Color(ORGANS[f.organ].color); (marker.material as THREE.MeshBasicMaterial).color.copy(col); (halo.material as THREE.MeshBasicMaterial).color.copy(col)
        const pulse = 1 + 0.25 * Math.sin(now / 160); marker.scale.setScalar(pulse * k); halo.scale.setScalar(1.4 + 0.5 * Math.sin(now / 240))
        halo.quaternion.copy(camera.quaternion).premultiply(avatar.root.quaternion.clone().invert())
      }

      // the camera keeps the avatar in view; the viewer can still orbit and zoom
      want.set(world.x, 0.95, world.z); const delta = want.clone().sub(lastTarget).multiplyScalar(0.1)
      controls.target.add(delta); camera.position.add(delta); lastTarget.add(delta)
      controls.update()
      renderer.render(scene, camera)
      if (now - hudAt > 300) { hudAt = now; setHud({ ...s, intent }); setVitals({ heart: Math.round(physio.heart.bpm * (1 + exertion * 0.5 + (s.affect.arousal - 0.5) * 0.2)), breath: Math.round(breathRpm) }) }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); avatar.dispose(); marker.geometry.dispose(); halo.geometry.dispose(); renderer.dispose()
      el.removeChild(renderer.domElement)
      avatar = null as unknown as Avatar
    }
  }, [build, tone])

  const ask = useCallback(async (text: string) => {
    const cleaned = cleanQuestion(text)
    if (!cleaned.ok) { setMsgs((m) => [...m, { who: 'avatar', text: cleaned.error }]); return }
    const c = ctx.current
    setMsgs((m) => [...m, { who: 'you', text: cleaned.question }]); setQ('')
    if (!c) return
    const local: Answer = answer(cleaned.question, c)
    if (local.organ) focus.current = { organ: local.organ, until: performance.now() + 9000 }
    let reply = local.text, note = local.evidence ? `evidence: ${local.evidence}` : 'from my body model'
    if (claude && (local.topic === 'unknown' || local.topic === 'mind' || local.topic === 'help')) {
      setBusy(true)
      try {
        const history = msgs.slice(-6).map((m) => ({ role: m.who, text: m.text.slice(0, 1200) }))
        const r = await fetch('/api/avatar/ask', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: cleaned.question, history, state: { emotion: c.emotion, intent: c.intent, scenario: c.scenario, source: c.source, cortisol: c.hormones.cortisol, melatonin: c.hormones.melatonin } }),
        })
        const j = (await r.json().catch(() => ({}))) as { answer?: string; error?: string }
        if (r.ok && j.answer) { reply = j.answer; note = 'Claude, using your key; a model, not advice' }
        else note = `${j.error ?? 'Claude could not answer'}; showing my built-in answer`
      } catch { note = 'Could not reach Claude; showing my built-in answer' }
      setBusy(false)
    }
    setMsgs((m) => [...m, { who: 'avatar', text: reply, note }])
    if (speak && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(reply.slice(0, 600))) }
  }, [claude, msgs, speak])

  const eegBars = hud ? (Object.entries(hud.eeg) as [string, number][]) : []
  const bar = (v: number, color: string) => <span className="block h-1.5 rounded-full" style={{ width: `${Math.round(v * 100)}%`, background: color }} />
  const btn = 'text-xs rounded-md border border-line px-2.5 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50'
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold">Meet your twin: a walking avatar with its own mind</h3>
      <p className="text-xs text-muted">
        The avatar chooses by itself how to move (sit, stand, stroll, walk, pace, jog, run, stretch, look around) from its mood. Its mood comes from hormone levels, the time of day and EEG and heart signals:
        its own simulated twin by default, or yours if you connect the bridge and choose &quot;mirror&quot;. Ask it questions instead of clicking on organs. It is a model, not a conscious being, and nothing it says is medical advice.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">Body <select className={sel} value={build} onChange={(e) => setBuild(e.target.value as Build)}>{BUILDS.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        <label className="flex items-center gap-1">Skin <select className={sel} value={tone} onChange={(e) => setTone(e.target.value as SkinTone)}>{(Object.keys(SKIN_TONES) as SkinTone[]).map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> mirror my live signals {mirror && !live && <span className="text-muted">(bridge not connected: using the simulated twin)</span>}</label>
        <label className="flex items-center gap-1">Hormones <select className={sel} value={hormones} onChange={(e) => setHormones(e.target.value as 'clock' | 'manual')}><option value="clock">typical for the time of day</option><option value="manual">levels I choose</option></select></label>
        {hormones === 'manual' && (<>
          <label className="flex items-center gap-1">Cortisol <select className={sel} value={cort} onChange={(e) => setCort(e.target.value as Level)}><option>low</option><option>typical</option><option>high</option></select></label>
          <label className="flex items-center gap-1">Melatonin <select className={sel} value={mel} onChange={(e) => setMel(e.target.value as Level)}><option>low</option><option>typical</option><option>high</option></select></label>
        </>)}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4">
        <div className="space-y-2 min-w-0">
          <div ref={host} className="relative w-full h-[480px] rounded-md border border-line bg-white overflow-hidden" role="img" aria-label="A 3D human avatar walking in a white room">
            {nogl && <p className="absolute inset-0 grid place-items-center text-xs text-muted p-4 text-center">This browser could not start 3D graphics, so the avatar cannot be drawn. You can still ask it questions.</p>}
          </div>
          <p className="text-xs text-muted">Drag to turn the view, scroll to zoom. The camera follows the avatar. Built in code; skin, face and clothes are stylised, not a scan of a real person.</p>
        </div>

        <div className="space-y-3 min-w-0">
          {hud && (
            <div className="rounded-md border border-line p-3 space-y-2 text-xs" aria-live="off">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-accent text-accent px-2 py-0.5">feels {hud.emotion}</span>
                <span className="rounded-full border border-line px-2 py-0.5">{describeIntent(hud.intent)}</span>
                <span className="rounded-full border border-line px-2 py-0.5 text-muted">{hud.simulated ? 'simulated twin' : 'live signals'}</span>
                <span className="text-muted">heart ~{vitals.heart}/min · breathing ~{vitals.breath}/min</span>
              </div>
              <p className="italic">&ldquo;{hud.thought}&rdquo;</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {([['arousal', hud.affect.arousal, '#e8590c'], ['energy', hud.affect.energy, '#2f9e44'], ['stress', hud.affect.stress, '#c92a2a'], ['tiredness', hud.affect.fatigue, '#4263eb']] as const).map(([k, v, col]) => (
                  <div key={k}><span className="text-muted">{k}</span>{bar(v, col)}</div>
                ))}
              </div>
              <div>
                <p className="text-muted mb-1">{hud.simulated ? 'Its own EEG (synthetic, follows its mood)' : 'EEG-style bands from its mood and your signals'}</p>
                <div className="grid grid-cols-5 gap-1">{eegBars.map(([k, v]) => <div key={k} className="text-center"><span className="block h-12 rounded bg-canvas border border-line relative overflow-hidden"><span className="absolute bottom-0 left-0 right-0 bg-accent/70" style={{ height: `${Math.min(100, Math.round(v * 220))}%` }} /></span><span className="text-[10px] text-muted">{k}</span></div>)}</div>
              </div>
            </div>
          )}

          <div className="rounded-md border border-line p-3 space-y-2">
            <div className="max-h-60 overflow-y-auto space-y-2 text-xs" aria-live="polite">
              {msgs.map((m, i) => (
                <div key={i} className={m.who === 'you' ? 'text-right' : ''}>
                  <p className={`inline-block max-w-[92%] rounded-lg px-3 py-1.5 text-left ${m.who === 'you' ? 'bg-accent-soft' : 'bg-canvas border border-line'}`}>{m.text}</p>
                  {m.note && <p className="text-[10px] text-muted mt-0.5">{m.note}</p>}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">{SUGGESTED_QUESTIONS.map((s) => <button key={s} className="text-[11px] rounded-full border border-line px-2 py-0.5 text-muted hover:text-fg hover:border-accent" onClick={() => void ask(s)}>{s}</button>)}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q) }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={400} placeholder="Ask the avatar anything about its body or mind…" aria-label="Ask the avatar" className="flex-1 rounded border border-line bg-canvas px-2 py-1 text-xs" />
              <button className={btn} disabled={busy || !q.trim()}>{busy ? '…' : 'Ask'}</button>
            </form>
            <div className="flex flex-wrap gap-4 text-[11px] text-muted">
              <label className="flex items-center gap-1"><input type="checkbox" checked={claude} onChange={(e) => setClaude(e.target.checked)} /> also let Claude answer open questions (your own key in Settings; only fixed words about its state are sent)</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> speak the answers</label>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
