'use client'

import { useConnectionReport } from '@/components/ConnectionsContext'
import { useState, type MutableRefObject } from 'react'
import type { Brain3DControls } from '@/components/Brain3D'
import type { ScenarioId, SystemId } from '@/lib/neuro'

function download(blob: Blob, name: string) {
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob); anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(anchor.href), 4000)
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

export default function CapturePanel({ controlRef, lines, scenario, system }: {
  controlRef: MutableRefObject<Brain3DControls | null>
  lines: () => string[]
  scenario: ScenarioId
  system: SystemId | 'none'
}) {
  const [busy, setBusy] = useState<'shot' | 'clip' | 'glb' | null>(null)
  const [note, setNote] = useState('')
  useConnectionReport('workersai', { status: 'off', detail: 'Former account illustration endpoint is disabled. Browser capture and optional Hugging Face images remain available.', lastAt: null })

  async function capture(kind: 'shot' | 'clip' | 'glb') {
    if (busy) return
    setBusy(kind)
    setNote(kind === 'clip' ? 'Recording 10 seconds; keep this tab open.' : '')
    try {
      const controls = controlRef.current
      const blob = kind === 'shot' ? await controls?.snapshot(lines())
        : kind === 'clip' ? await controls?.record(10, lines)
          : await controls?.exportGlb()
      if (!blob || (kind === 'clip' && blob.size <= 1000)) {
        setNote('This browser could not capture the view. Try Chrome, Edge or Firefox.')
        return
      }
      const extension = kind === 'shot' ? 'png' : kind === 'clip' ? 'webm' : 'glb'
      download(blob, `rabbitos-${kind}-${stamp()}.${extension}`)
      setNote('Saved locally. Nothing was uploaded.')
    } catch {
      setNote('The capture failed. Try a different browser or view.')
    } finally { setBusy(null) }
  }

  const button = 'text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50'
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold">Pictures, clips and open files</h3>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={!!busy} onClick={() => void capture('shot')}>Save picture with data card (PNG)</button>
        <button className={button} disabled={!!busy} onClick={() => void capture('clip')}>Record 10 s clip (WebM)</button>
        <button className={button} disabled={!!busy} onClick={() => void capture('glb')}>Export 3D model (glTF .glb)</button>
      </div>
      <p className="text-xs text-muted">Pictures and clips are made in your browser; nothing is uploaded. Orbit the camera or pick a view before recording. Former account-only AI illustrations are disabled; the optional Hugging Face image panel is separate.</p>
      {note && <p className="text-xs text-muted" role="status">{note}</p>}
      <div className="border-t border-line pt-3 space-y-1">
        <p className="font-medium">Open data for AI models and open-source tools</p>
        <ul className="text-xs space-y-1">
          <li><a className="text-info underline" href="/api/model/body" target="_blank" rel="noopener noreferrer">/api/model/body</a> - teaching model as JSON</li>
          <li><a className="text-info underline" href={`/api/model/state?scenario=${scenario}${system === 'none' ? '' : `&system=${system}`}&t=0`} target="_blank" rel="noopener noreferrer">/api/model/state</a> - chosen simulated state</li>
          <li><a className="text-info underline" href="/api/model/openapi.json" target="_blank" rel="noopener noreferrer">/api/model/openapi.json</a> - OpenAPI description</li>
          <li><a className="text-info underline" href="/llms.txt" target="_blank" rel="noopener noreferrer">/llms.txt</a> - guide for AI tools</li>
        </ul>
        <p className="text-xs text-muted">No account or key is needed. No personal data or live signals reach these APIs.</p>
      </div>
    </div>
  )
}
