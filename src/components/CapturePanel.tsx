'use client'

import { useState, type MutableRefObject } from 'react'
import type { Brain3DControls } from '@/components/Brain3D'
import { ILLUSTRATION_STYLES, type IllustrationStyle } from '@/lib/body-api'
import type { OrganId } from '@/lib/body'
import type { ScenarioId, SystemId } from '@/lib/neuro'

function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** Make pictures, clips, a 3D file and an AI illustration from the current view and data, and find the open data endpoints. */
export default function CapturePanel({ controlRef, lines, scenario, system, organ }: {
  controlRef: MutableRefObject<Brain3DControls | null>
  /** the data card: first line is the title, then the key readings */
  lines: () => string[]
  scenario: ScenarioId
  system: SystemId | 'none'
  organ: OrganId | null
}) {
  const [busy, setBusy] = useState<'shot' | 'clip' | 'glb' | 'ai' | null>(null)
  const [note, setNote] = useState('')
  const [style, setStyle] = useState<IllustrationStyle>('textbook diagram')
  const [art, setArt] = useState<{ src: string; prompt: string } | null>(null)

  const shot = async () => {
    setBusy('shot'); setNote('')
    const b = await controlRef.current?.snapshot(lines()); setBusy(null)
    if (b) download(b, `rabbitos-view-${stamp()}.png`); else setNote('Could not capture the view.')
  }
  const clip = async () => {
    setBusy('clip'); setNote('Recording 10 seconds of the live view… keep this tab open.')
    const b = await controlRef.current?.record(10, lines); setBusy(null)
    if (b && b.size > 1000) { download(b, `rabbitos-clip-${stamp()}.webm`); setNote('Clip saved (WebM). Open it in a browser, VLC or any editor.') } else setNote('This browser cannot record the view. Try Chrome, Edge or Firefox.')
  }
  const glb = async () => {
    setBusy('glb'); setNote('Building the 3D file…')
    const b = await controlRef.current?.exportGlb(); setBusy(null)
    if (b) { download(b, `rabbitos-body-${stamp()}.glb`); setNote(`Saved ${(b.size / 1e6).toFixed(1)} MB glTF binary. Open it in Blender, three.js or any glTF viewer. Particles and labels are left out.`) } else setNote('Could not build the 3D file.')
  }
  const illustrate = async () => {
    setBusy('ai'); setNote('Generating with Cloudflare Workers AI… this takes a few seconds.'); setArt(null)
    try {
      const r = await fetch('/api/brain/illustrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario, system, organ, style }) })
      const j = (await r.json()) as { image?: string; prompt?: string; error?: string }
      if (!r.ok || !j.image) setNote(j.error ?? 'The illustration could not be made.')
      else { setArt({ src: j.image, prompt: j.prompt ?? '' }); setNote('') }
    } catch { setNote('Could not reach the server.') }
    setBusy(null)
  }
  const btn = 'text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50'

  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold">Pictures, clips and open files</h3>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={!!busy} onClick={shot}>Save picture with data card (PNG)</button>
        <button className={btn} disabled={!!busy} onClick={clip}>Record 10 s clip (WebM)</button>
        <button className={btn} disabled={!!busy} onClick={glb}>Export 3D model (glTF .glb)</button>
      </div>
      <p className="text-xs text-muted">Pictures and clips are made in your browser from what you see, with the scenario and readings written on them; nothing is uploaded. Orbit the camera or pick a view before you record.</p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <select value={style} onChange={(e) => setStyle(e.target.value as IllustrationStyle)} aria-label="Illustration style" className="rounded border border-line bg-canvas px-2 py-1 text-xs">
          {ILLUSTRATION_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className={btn} disabled={!!busy} onClick={illustrate}>Generate AI illustration</button>
      </div>
      <p className="text-xs text-muted">Uses Cloudflare Workers AI (FLUX.1 schnell), which counts against your account&apos;s AI quota. Only the scenario, pathway and organ names are turned into a prompt on the server; your EEG, heart and muscle values are never sent.</p>
      {note && <p className="text-xs text-muted" aria-live="polite">{note}</p>}
      {art && (
        <figure className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.src} alt="AI-generated schematic illustration of the chosen scenario" className="w-full max-w-md rounded-md border border-line" />
          <figcaption className="text-xs text-muted">AI-generated illustration. Schematic and not anatomically exact, so use the 3D model for positions.
            {' '}<button className="underline" onClick={() => fetch(art.src).then((r) => r.blob()).then((b) => download(b, `rabbitos-illustration-${stamp()}.jpg`))}>Download</button>
          </figcaption>
        </figure>
      )}

      <div className="border-t border-line pt-3 space-y-1">
        <p className="font-medium">Open data for AI models and open-source tools</p>
        <ul className="text-xs space-y-0.5">
          <li><a className="text-info hover:underline" href="/api/model/body" target="_blank" rel="noopener noreferrer">/api/model/body</a> <span className="text-muted">the whole model as JSON (organs, routes, spinal supply, scenarios, genes, layout)</span></li>
          <li><a className="text-info hover:underline" href={`/api/model/state?scenario=${scenario}${system === 'none' ? '' : `&system=${system}`}&t=0`} target="_blank" rel="noopener noreferrer">/api/model/state</a> <span className="text-muted">computed state for the scenario you have chosen</span></li>
          <li><a className="text-info hover:underline" href="/api/model/openapi.json" target="_blank" rel="noopener noreferrer">/api/model/openapi.json</a> <span className="text-muted">OpenAPI description</span></li>
          <li><a className="text-info hover:underline" href="/llms.txt" target="_blank" rel="noopener noreferrer">/llms.txt</a> <span className="text-muted">a guide written for AI models; the MCP tools body_model and body_state use the same data</span></li>
        </ul>
        <p className="text-xs text-muted">No key is needed and nothing personal is in these files. Live signals never reach the server.</p>
      </div>
    </div>
  )
}
