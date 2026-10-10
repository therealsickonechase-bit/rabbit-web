'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseHormoneCsv, type HormoneSource } from '@/lib/hormone-context'
import { HF_SPACE_DEFAULT, RESOLUTIONS, buildWords, describeWords, validSpaceId, type Built } from '@/lib/hf-generator'
import { emgRatio, isFresh, type Baseline, type LiveFrame } from '@/lib/live-signals'
import type { Level } from '@/lib/body-api'

// Paints the live brain-and-body state with Qwen-Image-2.1-Turbo through the EEG + Qwen-Image Hugging Face Space.
// The page talks to Hugging Face directly (RabbitOS servers never see the request). Only fixed words and a seed are sent: the state, the strongest
// rhythm, arousal, hormone levels, heart and muscle words. Your Hugging Face token, if you add one, is used only for that call and can be kept in this browser.

const TOKEN_KEY = 'rabbitos-hf-token'
const MIN_GAP_S = 45
const MAX_AUTO = 20
const MAX_HISTORY = 6

interface Shot { src: string; built: Built; at: string }

const store = {
  get: (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } },
  set: (v: string) => { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY) } catch { /* private window: nothing to keep */ } },
}

export default function HfGenerator({ live, baseline }: { live: LiveFrame | null; baseline: Baseline }) {
  const [space, setSpace] = useState(HF_SPACE_DEFAULT)
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(false)
  const [resolution, setResolution] = useState<number>(768)
  const [hormones, setHormones] = useState<'clock' | 'manual' | 'csv'>('clock')
  const [cort, setCort] = useState<Level>('typical')
  const [mel, setMel] = useState<Level>('typical')
  const [csv, setCsv] = useState<Extract<HormoneSource, { kind: 'csv' }> | null>(null)
  const [csvNote, setCsvNote] = useState('')
  const [auto, setAuto] = useState(false)
  const [every, setEvery] = useState(120)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const liveRef = useRef(live), baseRef = useRef(baseline), autoCount = useRef(0), lastAt = useRef(0), clientRef = useRef<{ key: string; client: unknown } | null>(null)
  useEffect(() => { liveRef.current = live; baseRef.current = baseline }, [live, baseline])
  useEffect(() => {
    // read the remembered token after mount (the server render has no access to this browser's storage)
    const id = setTimeout(() => { const t = store.get(); if (t) { setToken(t); setRemember(true) } }, 0)
    return () => clearTimeout(id)
  }, [])

  const source = useCallback((): HormoneSource => (hormones === 'manual' ? { kind: 'manual', cortisol: cort, melatonin: mel } : hormones === 'csv' && csv ? csv : { kind: 'clock' }), [hormones, cort, mel, csv])

  const generate = useCallback(async (manual: boolean) => {
    if (busy) return
    if (!validSpaceId(space.trim())) { setNote('The Space must look like username/space-name.'); return }
    const now = Date.now()
    if (!manual && now - lastAt.current < MIN_GAP_S * 1000) return
    setBusy(true); setNote('Reading the live data and asking the Space to paint it. The first call after a quiet spell can take a minute while the model loads.')
    try {
      const f = isFresh(liveRef.current) ? liveRef.current : null
      const d = new Date()
      const built = buildWords(f, source(), d.getHours() + d.getMinutes() / 60, Math.floor(Math.random() * 2 ** 31), resolution, f ? emgRatio(f, baseRef.current) : null)
      const key = `${space.trim()}|${token}`
      if (!clientRef.current || clientRef.current.key !== key) {
        const { Client } = await import('@gradio/client')
        clientRef.current = { key, client: await Client.connect(space.trim(), token.startsWith('hf_') ? { token: token as `hf_${string}` } : {}) }
      }
      const client = clientRef.current.client as { predict: (endpoint: string, data: Record<string, unknown>) => Promise<{ data: unknown[] }> }
      const res = await client.predict('/generate_from_state', { ...built.words })
      const img = res.data?.[0] as { url?: string; path?: string } | undefined
      if (!img?.url) throw new Error('The Space returned no image.')
      lastAt.current = Date.now()
      setShots((s) => [{ src: img.url as string, built, at: d.toLocaleTimeString() }, ...s].slice(0, MAX_HISTORY))
      setNote(f ? '' : 'No live bridge frame: the picture uses the hormone context and neutral EEG words.')
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setNote(/quota|exceeded|ZeroGPU/i.test(m) ? 'The GPU quota for this Hugging Face account is used up for now. Add your own token, wait, or try again later.' : `Could not generate: ${m.slice(0, 200)}`)
    } finally { setBusy(false) }
  }, [busy, space, token, resolution, source])

  // automatic mode: while the bridge is live, paint every N seconds (never faster than the minimum gap, and at most MAX_AUTO per session)
  useEffect(() => {
    if (!auto) return
    autoCount.current = 0
    const id = setInterval(() => {
      if (!isFresh(liveRef.current) || autoCount.current >= MAX_AUTO) return
      autoCount.current++; void generate(false)
    }, Math.max(MIN_GAP_S, every) * 1000)
    return () => clearInterval(id)
  }, [auto, every, generate])

  const onCsv = async (file: File | null) => {
    if (!file) { setCsv(null); setCsvNote(''); return }
    if (file.size > 200_000) { setCsvNote('That file is too large (200 KB at most).'); return }
    const r = parseHormoneCsv(await file.text())
    if (!r.ok) { setCsv(null); setCsvNote(r.error); return }
    setCsv({ kind: 'csv', rows: r.rows, name: file.name.slice(0, 40) }); setCsvNote(`${r.rows.length} rows loaded. Values are read in this browser only.`)
  }

  const btn = 'text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50'
  const sel = 'rounded border border-line bg-canvas px-1 py-0.5 text-xs'
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold">Paint it with Qwen-Image-2.1-Turbo</h3>
      <p className="text-xs text-muted">
        Turns what the live data says right now into a picture: the brain state the EEG transformer read (or a simple alpha rule), the strongest rhythm, engagement, your hormone context, and your heart and muscle activity.
        Everything is reduced to fixed words in this page before anything is sent, and the request goes straight to the Space, not through RabbitOS.
      </p>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <label className="flex flex-col gap-1">Hugging Face Space
          <input value={space} onChange={(e) => setSpace(e.target.value)} spellCheck={false} className="rounded border border-line bg-canvas px-2 py-1 font-mono" /></label>
        <label className="flex flex-col gap-1">Your Hugging Face token (optional, uses your own GPU quota)
          <input type="password" value={token} autoComplete="off" onChange={(e) => { setToken(e.target.value.trim()); if (remember) store.set(e.target.value.trim()) }} placeholder="hf_..." className="rounded border border-line bg-canvas px-2 py-1 font-mono" />
          <span className="flex items-center gap-1 text-muted"><input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); store.set(e.target.checked ? token : '') }} /> keep it in this browser only</span></label>
        <label className="flex flex-col gap-1">Hormone context
          <select value={hormones} onChange={(e) => setHormones(e.target.value as 'clock' | 'manual' | 'csv')} className={sel}>
            <option value="clock">Typical daily pattern for the time of day (not measured)</option>
            <option value="manual">Levels I choose</option>
            <option value="csv">Values I measured (CSV)</option>
          </select></label>
        <label className="flex flex-col gap-1">Image size
          <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))} className={sel}>{RESOLUTIONS.map((r) => <option key={r} value={r}>{r} px</option>)}</select></label>
      </div>

      {hormones === 'manual' && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1">Cortisol <select value={cort} onChange={(e) => setCort(e.target.value as Level)} className={sel}><option>low</option><option>typical</option><option>high</option></select></label>
          <label className="flex items-center gap-1">Melatonin <select value={mel} onChange={(e) => setMel(e.target.value as Level)} className={sel}><option>low</option><option>typical</option><option>high</option></select></label>
        </div>
      )}
      {hormones === 'csv' && (
        <div className="space-y-1 text-xs">
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onCsv(e.target.files?.[0] ?? null)} />
          <p className="text-muted">Columns: <code className="font-mono">time,cortisol,melatonin</code> (time as 8.5 or 08:30; cortisol in ug/dL, melatonin in pg/mL; either may be blank). The picture uses the value for the current time of day, as a word only.</p>
          {csvNote && <p>{csvNote}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className={btn} disabled={busy} onClick={() => void generate(true)}>{busy ? 'Painting…' : 'Paint now'}</button>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> paint automatically while the bridge is live, every
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className={sel}><option value={60}>1 min</option><option value={120}>2 min</option><option value={300}>5 min</option></select>
          <span className="text-muted">(at most {MAX_AUTO} per visit)</span></label>
        <span className="text-xs text-muted">{isFresh(live) ? 'Using the live bridge frame.' : 'Bridge not connected: neutral EEG words.'}</span>
      </div>
      {note && <p className="text-xs text-muted" aria-live="polite">{note}</p>}

      {shots.length > 0 && (
        <div className="space-y-3">
          {shots.map((s, i) => (
            <figure key={s.at + i} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={`Qwen-Image-2.1-Turbo picture made from: ${describeWords(s.built.words)}`} className={`rounded-md border border-line ${i === 0 ? 'w-full max-w-lg' : 'w-40'}`} />
              <figcaption className="text-xs text-muted">
                {s.at}. Words sent: {describeWords(s.built.words)}. Brain state from the {s.built.stateSource}; hormones: {s.built.hormoneLabel}.
                {s.built.measured.heart ? ' Heart: measured.' : ''}{s.built.measured.muscle ? ' Muscle: measured.' : ''}
                {i === 0 && <> <a className="underline" href={s.src} target="_blank" rel="noopener noreferrer" download>Open or save</a></>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Art only: it does not read thoughts or feelings, hormone levels are never estimated from EEG, and the picture is not a medical result. Qwen-Image-2.1-Turbo is licensed for non-commercial use.</p>
    </div>
  )
}
