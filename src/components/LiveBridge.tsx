'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { calibrateEmg, eegIndices, isFresh, parseLiveFrame, type Baseline, type LiveFrame } from '@/lib/live-signals'

// Connects the page to the BrainFlow / OpenBCI bridge running on THIS computer (research-agents/local_bridge.py). The frames never leave
// the browser: they drive the 3D model and the readings, and a session file is saved only when you press a download button.

export const BRIDGE_URL = 'ws://127.0.0.1:8765'
const LOCAL = /^ws:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{4,5})\/?$/
const MAX_BUFFER = 3000          // about ten minutes at four frames per second
const MAX_MESSAGE = 20_000

type Status = 'off' | 'connecting' | 'live' | 'quiet' | 'error'

const csvCell = (v: unknown) => (v === undefined || v === null ? '' : String(v).replace(/"/g, '""'))
function toCsv(frames: LiveFrame[]) {
  const cols = new Set<string>()
  const rows = frames.map((f) => {
    const r: Record<string, unknown> = { time_iso: new Date(f.t).toISOString(), source: f.source, ecg_bpm: f.ecg?.bpm, resp_rpm: f.resp?.rpm }
    for (const [k, v] of Object.entries(f.emg ?? {})) r[`emg_${k}_uv`] = v
    for (const [ch, bands] of Object.entries(f.eeg ?? {})) for (const [b, v] of Object.entries(bands)) r[`eeg_${ch}_${b}`] = v
    Object.keys(r).forEach((k) => cols.add(k)); return r
  })
  const head = [...cols]
  return [head.join(','), ...rows.map((r) => head.map((c) => `"${csvCell(r[c])}"`).join(','))].join('\n')
}
function save(name: string, text: string, type: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function LiveBridge({ onFrame, onBaseline, bufferRef }: {
  onFrame: (f: LiveFrame | null) => void
  onBaseline: (b: Baseline) => void
  bufferRef: MutableRefObject<LiveFrame[]>
}) {
  const [url, setUrl] = useState(BRIDGE_URL)
  const [status, setStatus] = useState<Status>('off')
  const [msg, setMsg] = useState('')
  const [latest, setLatest] = useState<LiveFrame | null>(null)
  const [calibrated, setCalibrated] = useState(false)
  const [count, setCount] = useState(0)
  const [ignored, setIgnored] = useState(0)
  const ws = useRef<WebSocket | null>(null)
  const want = useRef(false)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const last = useRef<LiveFrame | null>(null)
  const bad = useRef(0)
  const reconnect = useRef<(target: string) => void>(() => {})

  const close = useCallback(() => {
    want.current = false
    if (retry.current) clearTimeout(retry.current)
    ws.current?.close(); ws.current = null
    setStatus('off'); onFrame(null); setLatest(null)
  }, [onFrame])

  const connect = useCallback((target: string) => {
    if (!LOCAL.test(target)) { setStatus('error'); setMsg('Only a bridge on this computer is allowed: ws://127.0.0.1:PORT or ws://localhost:PORT.'); return }
    want.current = true; setStatus('connecting'); setMsg('')
    let sock: WebSocket
    try { sock = new WebSocket(target) } catch { setStatus('error'); setMsg('Could not open the connection.'); return }
    ws.current = sock
    sock.onopen = () => { setStatus('quiet'); setMsg('Connected. Waiting for the first frame.') }
    sock.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > MAX_MESSAGE) return
      let raw: unknown
      try { raw = JSON.parse(ev.data) } catch { bad.current++; return }
      const parsed = parseLiveFrame(raw)
      if (!parsed) { bad.current++; return }
      const f: LiveFrame = { ...parsed, t: Date.now(), t_bridge: parsed.t }
      last.current = f
      bufferRef.current.push(f)
      if (bufferRef.current.length > MAX_BUFFER) bufferRef.current.splice(0, bufferRef.current.length - MAX_BUFFER)
    }
    sock.onerror = () => { setStatus('error'); setMsg('The bridge is not reachable. Start it with: python local_bridge.py') }
    sock.onclose = () => {
      ws.current = null
      if (want.current) { setStatus('connecting'); retry.current = setTimeout(() => reconnect.current(target), 2500) }
    }
  }, [bufferRef])
  useEffect(() => { reconnect.current = connect }, [connect])

  // hand the newest frame to the page four times a second and notice when the stream goes quiet
  useEffect(() => {
    const id = setInterval(() => {
      const f = last.current
      setCount(bufferRef.current.length)
      if (!f) return
      if (isFresh(f)) { setStatus('live'); setIgnored(bad.current); onFrame(f); setLatest(f) }
      else { setStatus('quiet'); setMsg('No new frames for a few seconds.'); onFrame(null); setLatest(null) }
    }, 250)
    return () => clearInterval(id)
  }, [onFrame, bufferRef])
  useEffect(() => () => { want.current = false; if (retry.current) clearTimeout(retry.current); ws.current?.close() }, [])

  const calibrate = () => {
    const recent = bufferRef.current.filter((f) => Date.now() - f.t < 6000 && f.emg)
    if (recent.length < 4) { setMsg('Stay relaxed with the EMG electrodes on, then press again. No muscle frames yet.'); return }
    onBaseline(calibrateEmg(recent)); setCalibrated(true); setMsg(`Resting muscle baseline set from ${recent.length} frames.`)
  }

  const idx = eegIndices(latest)
  const dot = status === 'live' ? 'bg-ok' : status === 'error' ? 'bg-bad' : status === 'off' ? 'bg-line' : 'bg-warn'
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Live signals from BrainFlow / OpenBCI</h3>
        <span className="flex items-center gap-1.5 text-xs" role="status"><span className={`inline-block h-2 w-2 rounded-full ${dot}`} />{status === 'live' ? `live: ${latest?.source}` : status === 'off' ? 'not connected' : status === 'connecting' ? 'connecting…' : status === 'quiet' ? 'connected, quiet' : 'unreachable'}</span>
      </div>
      <p className="text-xs text-muted">
        A small program on your computer reads the headset through BrainFlow and streams summary values to this page over a local connection. Nothing is uploaded or stored. Heart rate (ECG) and muscle activity (EMG) replace the model&apos;s numbers while connected; EEG drives the brain colours.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Bridge address" spellCheck={false} className="rounded border border-line bg-canvas px-2 py-1 text-xs font-mono w-56" />
        {status === 'off' || status === 'error'
          ? <button onClick={() => connect(url.trim())} className="text-xs rounded-md border border-line px-3 py-1 hover:border-accent hover:text-accent">Connect</button>
          : <button onClick={close} className="text-xs rounded-md border border-line px-3 py-1 hover:border-accent hover:text-accent">Disconnect</button>}
        <button onClick={calibrate} disabled={status !== 'live'} className="text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50">Set resting muscle baseline{calibrated ? ' ✓' : ''}</button>
        <button onClick={() => save(`rabbitos-session-${Date.now()}.json`, JSON.stringify({ format: 'rabbitos-live-session', version: 1, frames: bufferRef.current }), 'application/json')} disabled={count === 0} className="text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent disabled:opacity-50">Save session (JSON)</button>
        <button onClick={() => save(`rabbitos-session-${Date.now()}.csv`, toCsv(bufferRef.current), 'text/csv')} disabled={count === 0} className="text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent disabled:opacity-50">Save session (CSV)</button>
      </div>
      {msg && <p className="text-xs text-muted" aria-live="polite">{msg}</p>}
      {ignored > 0 && <p className="text-xs text-warn">{ignored} unreadable frame(s) were ignored.</p>}
      {latest && (
        <table className="w-full text-xs">
          <tbody>
            {latest.ecg && <tr className="border-b border-line/60"><td className="py-1 pr-2 text-muted">Heart rate (ECG, measured)</td><td className="py-1 font-medium">{Math.round(latest.ecg.bpm)} beats/min</td></tr>}
            {latest.resp && <tr className="border-b border-line/60"><td className="py-1 pr-2 text-muted">Breathing (measured)</td><td className="py-1 font-medium">{Math.round(latest.resp.rpm)} breaths/min</td></tr>}
            {latest.emg && Object.entries(latest.emg).map(([k, v]) => <tr key={k} className="border-b border-line/60"><td className="py-1 pr-2 text-muted">Muscle: {k.replace(/_/g, ' ')} (EMG)</td><td className="py-1 font-medium">{v.toFixed(1)} µV RMS</td></tr>)}
            {idx.channels > 0 && (
              <>
                <tr className="border-b border-line/60"><td className="py-1 pr-2 text-muted">EEG: strongest band</td><td className="py-1 font-medium">{idx.dominant} <span className="text-muted font-normal">({idx.channels} channels)</span></td></tr>
                {idx.thetaAlpha !== null && <tr className="border-b border-line/60"><td className="py-1 pr-2 text-muted">EEG: theta / alpha</td><td className="py-1 font-medium">{idx.thetaAlpha.toFixed(2)} <span className="text-muted font-normal">higher with drowsiness</span></td></tr>}
                {idx.engagement !== null && <tr className="border-b border-line/60"><td className="py-1 pr-2 text-muted">EEG: engagement index</td><td className="py-1 font-medium">{idx.engagement.toFixed(2)} <span className="text-muted font-normal">beta / (alpha + theta)</span></td></tr>}
                {idx.frontalAsymmetry !== null && <tr className="border-b border-line/60"><td className="py-1 pr-2 text-muted">EEG: frontal alpha asymmetry</td><td className="py-1 font-medium">{idx.frontalAsymmetry.toFixed(2)} <span className="text-muted font-normal">ln F4 − ln F3</span></td></tr>}
              </>
            )}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">EEG indices are rough estimates for context. They are not measures of mood, thoughts or health, and an EEG alone cannot diagnose anything. Use a headset on yourself or with the wearer&apos;s informed consent.</p>
    </div>
  )
}
