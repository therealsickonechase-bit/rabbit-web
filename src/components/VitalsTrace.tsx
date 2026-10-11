'use client'

import { useEffect, useRef } from 'react'
import type { Physio } from '@/lib/body-physiology'

// Three scrolling traces drawn from the same physiology that drives the 3D body: an ECG (rate and rhythm), breathing, and muscle
// activity. They are synthetic teaching traces, not recordings. Atrial fibrillation-like rhythm drops the P wave and varies the gaps.

const SPAN = 6 // seconds on screen
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

/** One heartbeat's ECG shape at time s after the beat starts (arbitrary units, R wave = 1). */
function beatShape(s: number, withP: boolean) {
  const g = (c: number, w: number, a: number) => a * Math.exp(-(((s - c) / w) ** 2))
  return (withP ? g(0.0, 0.035, 0.14) : 0) + g(0.16, 0.012, -0.12) + g(0.185, 0.014, 1) + g(0.21, 0.014, -0.25) + g(0.4, 0.06, 0.28)
}

export default function VitalsTrace({ physio }: { physio: React.MutableRefObject<Physio> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const ctx = cv.getContext('2d'); if (!ctx) return
    const beats: number[] = [0]
    let raf = 0, last = performance.now(), clock = 0
    const css = (v: string, f: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (document.hidden) return
      const now = performance.now(); clock += Math.min(0.1, (now - last) / 1000); last = now
      const p = physio.current
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
      // beats: extend the schedule with the current rate and rhythm
      while (beats[beats.length - 1] < clock + 0.5) {
        const n = beats.length, base = 60 / p.heart.bpm
        beats.push(beats[beats.length - 1] + Math.max(0.25, base * (1 + (hash(n) - 0.5) * 1.3 * p.heart.irregular)))
      }
      while (beats.length > 2 && beats[1] < clock - SPAN - 1) beats.shift()
      const rows = 3, rh = h / rows, fg = css('--fg', '#ddd'), muted = css('--muted', '#888'), line = css('--line', '#444')
      ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top'
      const label = (i: number, text: string) => { ctx.fillStyle = muted; ctx.fillText(text, 4, i * rh + 3) }
      for (let i = 0; i < rows; i++) { ctx.strokeStyle = line; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(0, (i + 1) * rh); ctx.lineTo(w, (i + 1) * rh); ctx.stroke(); ctx.globalAlpha = 1 }
      const withP = p.heart.irregular < 0.3
      // ECG
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 1.4; ctx.beginPath()
      for (let x = 0; x <= w; x += 1) {
        const t = clock - SPAN + (x / w) * SPAN
        let v = 0
        for (let b = 0; b < beats.length; b++) { const s = t - beats[b]; if (s > -0.05 && s < 0.7) v += beatShape(s, withP) }
        if (!withP) v += 0.045 * Math.sin(t * 38) + 0.03 * Math.sin(t * 61)
        const y = rh * 0.78 - v * rh * 0.62
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke(); label(0, `ECG  ${Math.round(p.heart.bpm)}/min${p.heart.irregular > 0.3 ? '  irregular' : ''}`)
      // breathing
      ctx.strokeStyle = '#4dabf7'; ctx.beginPath()
      let phase = 0
      const rate = (p.lungs.rpm / 60) * (1 - p.lungs.apnea)
      for (let x = 0; x <= w; x += 2) {
        const t = clock - SPAN + (x / w) * SPAN
        phase = t * rate
        const v = p.lungs.apnea > 0.5 ? 0.9 : 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
        const y = rh + rh * 0.82 - v * Math.min(1.4, p.lungs.depth) * rh * 0.6
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke(); label(1, p.lungs.apnea > 0.5 ? 'Breathing  paused' : `Breathing  ${Math.round(p.lungs.rpm)}/min`)
      // muscle activity (EMG-like): burst height follows tone, spasm and tremor
      ctx.strokeStyle = '#ffa94d'; ctx.beginPath()
      const act = Math.min(1.6, 0.12 + 0.18 * (p.muscle.tone - 0.5) + 0.8 * p.muscle.spasm + 0.5 * p.muscle.tremor)
      for (let x = 0; x <= w; x += 2) {
        const t = clock - SPAN + (x / w) * SPAN
        const burst = p.muscle.spasm > 0.3 ? 0.55 + 0.45 * Math.sin(t * 22) : 1
        const v = (hash(Math.floor(t * 120) + x) - 0.5) * 2 * act * burst
        const y = 2 * rh + rh * 0.5 + v * rh * 0.4
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke(); ctx.fillStyle = fg; label(2, `Muscle activity  ${p.muscle.spasm > 0.5 ? 'convulsing' : p.muscle.tone > 1.4 ? 'stiff' : p.muscle.strengthL < 0.8 || p.muscle.strengthR < 0.8 ? 'weak' : 'normal'}`)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [physio])
  return <canvas ref={ref} className="w-full h-36 rounded-md border border-line bg-canvas" role="img" aria-label="Scrolling electrocardiogram, breathing and muscle activity traces for the chosen scenario" />
}
