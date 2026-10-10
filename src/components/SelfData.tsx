'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DIMENSIONS, HUB_URL, buildPrompt, drawArt, isFreshSelf, parseSelfFrame, summaryFrom, type SelfFrame } from '@/lib/self-data'
import { HF_SPACE_DEFAULT, validSpaceId } from '@/lib/hf-generator'
import { createClient } from '@/lib/supabase/client'

// Your own data, drawn. Connects to the self-data hub on THIS computer (research-agents: python -m selfdata serve). Values and fixed words arrive over loopback
// and stay in this page; the live picture is drawn here. "Paint with Qwen" sends only fixed words (e.g. "sleep below usual") to the Hugging Face Space.

const LOCAL = /^ws:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{4,5})\/?$/
const fmtRate = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`)
type Status = 'off' | 'connecting' | 'live' | 'error'
interface Shot { src: string; prompt: string; at: string }

export default function SelfData() {
  const [url, setUrl] = useState(HUB_URL)
  const [status, setStatus] = useState<Status>('off')
  const [frame, setFrame] = useState<SelfFrame | null>(null)
  const [space, setSpace] = useState(HF_SPACE_DEFAULT)
  const [style, setStyle] = useState<'art' | 'portrait'>('portrait')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const ws = useRef<WebSocket | null>(null)
  const frameRef = useRef<SelfFrame | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)

  const disconnect = useCallback(() => { ws.current?.close(); ws.current = null; setStatus('off') }, [])
  const connect = useCallback(() => {
    if (!LOCAL.test(url)) { setNote('The hub address must be on this computer, like ws://127.0.0.1:8766.'); return }
    ws.current?.close(); setStatus('connecting'); setNote('')
    try {
      const s = new WebSocket(url); ws.current = s
      s.onopen = () => setStatus('live')
      s.onmessage = (e) => {
        if (typeof e.data !== 'string' || e.data.length > 200_000) return
        try { const f = parseSelfFrame(JSON.parse(e.data)); if (f) { frameRef.current = { ...f, t: Date.now() }; setFrame(frameRef.current) } } catch { /* ignore a malformed frame */ }
      }
      s.onerror = () => { setStatus('error'); setNote('Could not reach the hub. Start it with: python -m selfdata serve (see the directions below).') }
      s.onclose = () => setStatus((st) => (st === 'error' ? st : 'off'))
    } catch { setStatus('error') }
  }, [url])
  useEffect(() => () => ws.current?.close(), [])

  // animate the art from the latest frame (about 20 frames a second is plenty)
  useEffect(() => {
    let id = 0, last = 0
    const loop = (ts: number) => {
      id = requestAnimationFrame(loop)
      if (ts - last < 50) return
      last = ts
      const c = canvas.current; const ctx = c?.getContext('2d')
      if (c && ctx) drawArt(ctx, c.width, c.height, isFreshSelf(frameRef.current) ? frameRef.current : null, ts / 1000)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])

  const saveSummary = async (remove = false) => {
    const f = frameRef.current
    if (!remove && !f) return
    if (remove && !window.confirm('Delete every summary saved to your account?')) return
    setNote(remove ? 'Deleting…' : 'Saving…')
    try {
      const day = new Date().toISOString().slice(0, 10)
      // the server checks this access token (sent only to RabbitOS, same origin) and lets only the owner through
      const { data: { session } } = await createClient().auth.getSession()
      if (!session) { setNote('Sign in first.'); return }
      const auth = { Authorization: `Bearer ${session.access_token}` }
      const r = await fetch('/api/self/daily', remove ? { method: 'DELETE', headers: auth } : { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(summaryFrom(f!, day)) })
      setNote(r.ok ? (remove ? 'Deleted.' : `Saved today's summary (${day}) to your account.`) : r.status === 403 ? 'Only the owner account can save these.' : r.status === 401 || r.redirected ? 'Sign in first.' : 'Could not save.')
    } catch { setNote('Could not reach the server.') }
  }

  const paint = async () => {
    const f = frameRef.current
    if (!f || busy) return
    if (!validSpaceId(space.trim())) { setNote('The Space must look like username/space-name.'); return }
    setBusy(true); setNote('Asking the Space to paint it. The first call after a quiet spell can take a minute.')
    try {
      const prompt = buildPrompt(f, style)
      const { Client } = await import('@gradio/client')
      const client = await Client.connect(space.trim())
      const res = await (client as unknown as { predict: (e: string, d: Record<string, unknown>) => Promise<{ data: unknown[] }> }).predict('/render', { prompt, seed: Math.floor(Math.random() * 2 ** 31), resolution: 768 })
      const img = res.data?.[0] as { url?: string } | undefined
      if (!img?.url) throw new Error('The Space returned no image.')
      setShots((s) => [{ src: img.url as string, prompt, at: new Date().toLocaleTimeString() }, ...s].slice(0, 4)); setNote('')
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setNote(/quota|exceeded|ZeroGPU/i.test(m) ? 'The GPU quota for this account is used up for now. Try again later.' : `Could not generate: ${m.slice(0, 200)}`)
    } finally { setBusy(false) }
  }

  const btn = 'text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50'
  const live = status === 'live' && isFreshSelf(frame)
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold">My data portrait</h3>
      <p className="text-xs text-muted">
        Your own data from this computer (wearable exports, medical records you supply, this PC&apos;s activity, the RabbitOS research data), compared with <em>your</em> usual and drawn as one petal
        per body system. Blue particles are data coming in, amber are data going out. Nothing is uploaded; only fixed words go to the image model, and only when you press the button.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} className="rounded border border-line bg-canvas px-2 py-1 font-mono w-56" aria-label="Hub address" />
        {status === 'live' || status === 'connecting' ? <button className={btn} onClick={disconnect}>Disconnect</button> : <button className={btn} onClick={connect}>Connect to my hub</button>}
        <span className="text-muted">{status === 'live' ? (live ? 'Live.' : 'Connected, waiting for data.') : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'Not reachable.' : 'Not connected.'}</span>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <canvas ref={canvas} width={640} height={480} className="w-full rounded-md border border-line" role="img" aria-label="Animated data portrait" />
        <div className="space-y-2 text-xs">
          {frame && live ? (<>
            <ul className="space-y-1">
              {frame.dims.map((d) => (
                <li key={d.key} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `hsl(${DIMENSIONS.find((x) => x.key === d.key)?.hue},80%,60%)` }} />
                  <span className="w-40">{d.label}</span>
                  <span className="text-muted">{d.raw === null ? 'no data' : `${d.raw} ${d.unit}`.trim()} · {frame.words.levels[d.key]}{d.trend > 0 ? ' ↑' : d.trend < 0 ? ' ↓' : ''}</span>
                </li>
              ))}
            </ul>
            <p><span style={{ color: 'hsl(205,85%,62%)' }}>In {fmtRate(frame.inBps)}</span> · <span style={{ color: 'hsl(38,85%,62%)' }}>Out {fmtRate(frame.outBps)}</span>{frame.connections >= 0 ? ` · ${frame.connections} connections` : ''}</p>
            {frame.events.length > 0 && <p className="text-muted">RabbitOS flows: {frame.events.slice(-4).map((e) => `${e.dir === 'in' ? '←' : '→'} ${e.label}`).join(', ')}</p>}
            {frame.story.map((s) => <p key={s} className="text-muted">{s}</p>)}
            {frame.synthetic && <p className="font-semibold" style={{ color: '#ebbe78' }}>SYNTHETIC DEMO DATA</p>}
          </>) : <p className="text-muted">Connect to see your values. Directions are below.</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">Image <select value={style} onChange={(e) => setStyle(e.target.value as 'art' | 'portrait')} className="rounded border border-line bg-canvas px-1 py-0.5"><option value="portrait">Data portrait (figure of petals)</option><option value="art">Art only</option></select></label>
        <input value={space} onChange={(e) => setSpace(e.target.value)} spellCheck={false} className="rounded border border-line bg-canvas px-2 py-1 font-mono w-72" aria-label="Hugging Face Space" />
        <button className={btn} disabled={!live || busy} onClick={() => void paint()}>{busy ? 'Painting…' : 'Paint with Qwen'}</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button className={btn} disabled={!live} onClick={() => void saveSummary()}>Save today&apos;s summary to my account</button>
        <button className={btn} onClick={() => void saveSummary(true)}>Delete saved summaries</button>
        <span className="text-muted">Owner only. Saves a coarse summary per body system (position against your usual, trend) and lab flag counts, never raw values or names.</span>
      </div>
      {note && <p className="text-xs text-muted" aria-live="polite">{note}</p>}
      {shots.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {shots.map((s, i) => (
            <figure key={s.at + i} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={`Picture made from these words: ${s.prompt}`} className="rounded-md border border-line w-full" />
              <figcaption className="text-xs text-muted">{s.at}. Words sent: {s.prompt}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer font-semibold">Directions: how to give it your data</summary>
        <ol className="list-decimal pl-5 space-y-1 mt-2 text-muted">
          <li>In PowerShell: <code className="font-mono">cd C:\Users\odaat\Projects\research-agents</code></li>
          <li>Try it with a made-up person: <code className="font-mono">.\.venv-eeg\Scripts\python.exe -m selfdata demo</code>, then serve it with <code className="font-mono">... -m selfdata serve --demo</code>.</li>
          <li>Your own files: export from Apple Health, Fitbit, Oura, Garmin or Google Fit, and your lab results as CSV or FHIR JSON (name the file starting with <code className="font-mono">lab</code>). Drop them in <code className="font-mono">%LOCALAPPDATA%\RabbitOS\selfdata\inbox</code> and run <code className="font-mono">... -m selfdata inbox</code>.</li>
          <li>This PC&apos;s activity (counters only): <code className="font-mono">... -m selfdata collect</code> and leave it running. Research data: <code className="font-mono">... -m selfdata research BRCA1 serotonin</code>.</li>
          <li>Start the live hub: <code className="font-mono">... -m selfdata serve</code>, then press Connect above.</li>
          <li>Medical values are encrypted on your disk and never leave it. This is descriptive and compared with your own usual; it is not medical advice.</li>
        </ol>
      </details>
    </div>
  )
}
