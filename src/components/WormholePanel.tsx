'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HF_SPACE_DEFAULT, validSpaceId } from '@/lib/hf-generator'
import { eegIndices, isFresh, type LiveFrame } from '@/lib/live-signals'
import { HUB_URL } from '@/lib/self-data'
import type { SharedScene } from '@/lib/twin-net'
import {
  DEFAULT_WEIGHTS, HORMONES, ProvenanceLog, RATINGS, affectFromEeg, buildScene, confidence, match, minutesOf, parseMoments, parseRefinement, refine, scenePrompt,
  type Hormone, type Level3, type Moment, type Rating, type Refinement, type StateVector,
} from '@/lib/wormhole'

// The EEG-hormone wormhole. It compares how you are NOW (live EEG band shares, hormone levels you note, how you feel, time of day, words you give it) with the
// moments YOU logged and shows the closest ones with a stated confidence. It does not read memories out of a brain: it is a similarity search over your own log.
// The moments come from the hub on this computer (python -m selfdata serve, after python -m selfdata import-moments FILE). Nothing leaves this page except,
// when you press "Paint this scene", a short prompt made only of approved words.

const LOCAL = /^ws:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{4,5})\/?$/
const STORE_KEY = 'rabbitos-wormhole-v1'
type Pick ='unknown' | 'low' | 'medium' | 'high'
const RATING_VALUE: Record<Exclude<Pick, 'unknown'>, number> = { low: 0.15, medium: 0.5, high: 0.85 }
const STATE_LABEL: Record<string, string> = { none: 'no reconstruction', weak: 'weak', plausible: 'plausible', strong: 'strong' }

function download(name: string, text: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function WormholePanel({ live, onScene }: { live: LiveFrame | null; onScene?: (scene: SharedScene | null) => void }) {
  const [url, setUrl] = useState(HUB_URL)
  const [status, setStatus] = useState<'off' | 'connecting' | 'live' | 'error'>('off')
  const [moments, setMoments] = useState<Moment[]>([])
  const [approved, setApproved] = useState<string[]>([])
  const [feel, setFeel] = useState<Record<Rating, Pick>>({ arousal: 'unknown', valence: 'unknown', stress: 'unknown', energy: 'unknown' })
  const [horm, setHorm] = useState<Record<Hormone, 'unknown' | Level3>>({ cortisol: 'unknown', melatonin: 'unknown' })
  const [useEeg, setUseEeg] = useState(true)
  const [useTime, setUseTime] = useState(true)
  const [useDay, setUseDay] = useState(true)
  const [today, setToday] = useState<Record<string, Level3>>({})
  const [words, setWords] = useState<string[]>([])
  const [word, setWord] = useState('')
  const [ref, setRef] = useState<Refinement>({ weights: DEFAULT_WEIGHTS, boosts: {} })
  const [log, setLog] = useState<{ seq: number; kind: string; detail: string; hash: string }[]>([])
  const [logOk, setLogOk] = useState<string>('')
  const [note, setNote] = useState('')
  const [space, setSpace] = useState(HF_SPACE_DEFAULT)
  const [busy, setBusy] = useState(false)
  const [shot, setShot] = useState<{ src: string; prompt: string } | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const prov = useRef(new ProvenanceLog())
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setClock(Date.now()), 5000); return () => clearInterval(id) }, [])

  const record = useCallback(async (kind: 'query' | 'feedback' | 'scene' | 'render', detail: string) => {
    const e = await prov.current.append(kind, detail)
    setLog((l) => [...l, { seq: e.seq, kind: e.kind, detail: e.detail, hash: e.hash }].slice(-30))
  }, [])

  // weights, boosts and the provenance log are kept in this browser only, so a closed tab does not forget the feedback. A saved log whose chain does not verify is discarded.
  const loaded = useRef(false)
  useEffect(() => {
    void (async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { ref?: unknown; log?: unknown } | null
        if (saved) {
          setRef(parseRefinement(saved.ref))
          if (await prov.current.restore(saved.log)) setLog(prov.current.entries.slice(-30).map((e) => ({ seq: e.seq, kind: e.kind, detail: e.detail, hash: e.hash })))
        }
      } catch { /* storage unavailable or damaged: start fresh */ }
      loaded.current = true
    })()
  }, [])
  useEffect(() => {
    if (!loaded.current) return
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ref, log: prov.current.entries.slice(-200) })) } catch { /* storage unavailable */ }
  }, [ref, log])
  const forget = () => {
    try { localStorage.removeItem(STORE_KEY) } catch { /* ignore */ }
    prov.current = new ProvenanceLog(); setLog([]); setLogOk(''); setRef({ weights: DEFAULT_WEIGHTS, boosts: {} })
  }

  const disconnect = () => { ws.current?.close(); ws.current = null; setStatus('off') }
  const connect = () => {
    if (!LOCAL.test(url)) { setNote('The hub address must be on this computer, like ws://127.0.0.1:8766.'); return }
    ws.current?.close(); setStatus('connecting'); setNote('')
    try {
      const s = new WebSocket(url); ws.current = s
      s.onopen = () => setStatus('live')
      s.onmessage = (e) => {
        if (typeof e.data !== 'string' || e.data.length > 400_000) return
        try { const m = parseMoments(JSON.parse(e.data)); if (m) { setMoments(m.moments); setApproved(m.approved); setToday(m.today) } } catch { /* not a moments message */ }
      }
      s.onerror = () => { setStatus('error'); setNote('Could not reach the hub. Start it with: python -m selfdata serve') }
      s.onclose = () => setStatus((st) => (st === 'error' ? st : 'off'))
    } catch { setStatus('error') }
  }
  useEffect(() => () => ws.current?.close(), [])

  // the present, as far as it is known: unknown parts are left out of the comparison
  const eegAffect = useMemo(() => {
    if (!useEeg || !isFresh(live, clock) || !live.eeg) return null
    const idx = eegIndices(live)
    if (!idx.channels) return null
    const sum = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 }; let n = 0
    for (const bands of Object.values(live.eeg)) { if (!(['delta', 'theta', 'alpha', 'beta', 'gamma'] as const).every((b) => typeof bands[b] === 'number')) continue; for (const b of Object.keys(sum) as (keyof typeof sum)[]) sum[b] += bands[b]!; n++ }
    return n ? affectFromEeg({ delta: sum.delta / n, theta: sum.theta / n, alpha: sum.alpha / n, beta: sum.beta / n, gamma: sum.gamma / n }, idx) : null
  }, [live, useEeg, clock])

  const state: StateVector = useMemo(() => {
    const ratings: StateVector['ratings'] = {}
    for (const k of RATINGS) if (feel[k] !== 'unknown') ratings[k] = RATING_VALUE[feel[k] as Exclude<Pick, 'unknown'>]
    if (eegAffect) for (const k of RATINGS) if (feel[k] === 'unknown' && eegAffect[k] !== undefined) ratings[k] = eegAffect[k]      // what you say outranks what the EEG suggests
    const hormones: StateVector['hormones'] = {}
    for (const k of HORMONES) if (horm[k] !== 'unknown') hormones[k] = horm[k] as Level3
    return { ratings, minutes: useTime ? minutesOf(new Date(clock)) : null, hormones, day: useDay ? today : {}, guidance: words }
  }, [feel, horm, eegAffect, useTime, useDay, today, words, clock])

  const matches = useMemo(() => match(state, moments, ref.weights, ref.boosts, 5), [state, moments, ref])
  const conf = useMemo(() => confidence(matches, moments.length), [matches, moments.length])
  const scene = useMemo(() => buildScene(state, matches, conf, approved), [state, matches, conf, approved])
  const prompt = scenePrompt(scene)
  const sharedScene: SharedScene = { words: scene.words, mood: scene.mood, confidence: conf.state }

  // save to, and load from, files on this computer (the same shapes the local agents read)
  const saveState = () => download('wormhole-state.json', JSON.stringify({ v: 1, type: 'rabbitos-wormhole', ref, log: prov.current.entries }, null, 1))
  const saveScene = () => { if (scene.words.length) download('wormhole-scene.json', JSON.stringify({ from: 'wormhole', scene: sharedScene, t: Math.floor(Date.now() / 1000) })) }
  const loadState = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 1_000_000) { setNote('That file is too large to be a wormhole state.'); return }
    try {
      const saved = JSON.parse(await file.text()) as { type?: unknown; ref?: unknown; log?: unknown }
      if (saved.type !== 'rabbitos-wormhole') { setNote('That is not a wormhole state file.'); return }
      setRef(parseRefinement(saved.ref))
      if (saved.log !== undefined && !(await prov.current.restore(saved.log))) { setNote('Weights loaded, but the saved log failed its hash check and was ignored.'); return }
      setLog(prov.current.entries.slice(-30).map((e) => ({ seq: e.seq, kind: e.kind, detail: e.detail, hash: e.hash }))); setNote('Loaded.')
    } catch { setNote('Could not read that file.') }
  }

  const toggleWord = (w: string) => setWords((ws0) => (ws0.includes(w) ? ws0.filter((x) => x !== w) : [...ws0, w].slice(0, 8)))
  const addWord = () => { const w = word.trim().toLowerCase(); if (!approved.includes(w)) { setNote(`"${w}" is not an approved word. Add it with: python -m selfdata approve-words ${w}`); return } setNote(''); toggleWord(w); setWord('') }

  const rate = async (m: (typeof matches)[number], good: boolean) => {
    setRef((r) => refine(r, m, good))
    await record('feedback', `${good ? 'good' : 'poor'} match on ${m.moment.id}; weights adjusted`)
  }
  const applyScene = async () => {
    onScene?.(scene.words.length ? sharedScene : null)
    await record('scene', `${conf.state} confidence; words: ${scene.words.join(' ') || 'none'}; moment ${scene.momentId ?? 'none'}`)
  }
  const paint = async () => {
    if (!prompt || busy) return
    if (!validSpaceId(space.trim())) { setNote('The Space must look like username/space-name.'); return }
    setBusy(true); setNote('Asking the Space to paint it. The first call after a quiet spell can take a minute.')
    try {
      const { Client } = await import('@gradio/client')
      const client = await Client.connect(space.trim())
      const res = await (client as unknown as { predict: (e: string, d: Record<string, unknown>) => Promise<{ data: unknown[] }> }).predict('/render', { prompt, seed: Math.floor(Math.random() * 2 ** 31), resolution: 768 })
      const img = res.data?.[0] as { url?: string } | undefined
      if (!img?.url) throw new Error('The Space returned no image.')
      setShot({ src: img.url, prompt }); setNote('')
      await record('render', `image requested from words: ${scene.words.join(' ')}`)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setNote(/quota|exceeded|ZeroGPU/i.test(m) ? 'The GPU quota for this account is used up for now. Try again later.' : `Could not generate: ${m.slice(0, 200)}`)
    } finally { setBusy(false) }
  }
  const verify = async () => { const bad = await prov.current.verify(); setLogOk(bad === null ? `Intact (${prov.current.entries.length} entries).` : `Broken at entry ${bad}.`) }

  const btn = 'text-xs rounded-md border border-line px-3 py-1 enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50'
  const sel = 'rounded border border-line bg-canvas px-1 py-0.5'
  return (
    <section className="space-y-3 text-sm" aria-label="EEG and hormone wormhole">
      <h3 className="text-sm font-semibold">Wormhole: find the moments in your own history that match now</h3>
      <p className="text-xs text-muted">
        It compares your present state (live EEG band shares, hormone levels you note, how you feel, the time of day, words you give it) with moments <em>you</em> logged, and shows the closest with how sure it is.
        It cannot read a memory or a scene out of a brain: it only says &ldquo;this looks like that moment you recorded&rdquo;, and the confidence says how much it had to go on. Your log stays on this computer; only approved words are ever sent to an image model.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} className="rounded border border-line bg-canvas px-2 py-1 font-mono w-56" aria-label="Hub address" />
        {status === 'live' || status === 'connecting' ? <button className={btn} onClick={disconnect}>Disconnect</button> : <button className={btn} onClick={connect}>Connect to my hub</button>}
        <span className="text-muted">{status === 'live' ? `Connected. ${moments.length ? `${moments.length} logged moments.` : 'Waiting for your moments (sent every 15 s).'}` : status === 'connecting' ? 'Connecting\u2026' : status === 'error' ? 'Not reachable.' : 'Not connected.'}</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4 text-xs">
        <div className="space-y-2">
          <p className="font-medium">Right now</p>
          <label className="flex items-center gap-1"><input type="checkbox" checked={useEeg} onChange={(e) => setUseEeg(e.target.checked)} />Use live EEG for arousal {eegAffect ? <span className="text-muted">(bridge live; arousal, energy and a faint valence hint, all rough)</span> : <span className="text-muted">(no live EEG)</span>}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={useTime} onChange={(e) => setUseTime(e.target.checked)} />Use the time of day</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={useDay} onChange={(e) => setUseDay(e.target.checked)} />Use how my body metrics read lately {Object.keys(today).length ? <span className="text-muted">({Object.entries(today).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).slice(0, 4).join(', ')})</span> : <span className="text-muted">(none from the hub yet)</span>}</label>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {RATINGS.map((k) => (
              <label key={k} className="flex items-center justify-between gap-2 capitalize">{k}
                <select className={sel} value={feel[k]} onChange={(e) => setFeel((f) => ({ ...f, [k]: e.target.value as Pick }))}>{(['unknown', 'low', 'medium', 'high'] as const).map((o) => <option key={o}>{o}</option>)}</select>
              </label>
            ))}
            {HORMONES.map((k) => (
              <label key={k} className="flex items-center justify-between gap-2 capitalize">{k}
                <select className={sel} value={horm[k]} onChange={(e) => setHorm((h) => ({ ...h, [k]: e.target.value as 'unknown' | Level3 }))}>{(['unknown', 'low', 'typical', 'high'] as const).map((o) => <option key={o}>{o}</option>)}</select>
              </label>
            ))}
          </div>
          <div>
            <p className="text-muted mb-1">Guidance words (up to 8)</p>
            <div className="flex flex-wrap gap-1">{approved.slice(0, 60).map((w) => <button key={w} onClick={() => toggleWord(w)} className={`rounded-full border px-2 py-0.5 ${words.includes(w) ? 'border-accent text-accent' : 'border-line text-muted'}`}>{w}</button>)}</div>
            <div className="mt-1 flex gap-1"><input value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWord()} className="rounded border border-line bg-canvas px-2 py-0.5 w-32" placeholder="another word" aria-label="Another approved word" /><button className={btn} onClick={addWord} disabled={!word.trim()}>Add</button></div>
          </div>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Closest logged moments</p>
          {!moments.length ? <p className="text-muted">No moments yet. Log some in a CSV and run <code className="font-mono">python -m selfdata import-moments FILE</code> (or <code className="font-mono">python -m selfdata demo</code> for a synthetic set), then <code className="font-mono">python -m selfdata serve</code>.</p>
            : !matches.length ? <p className="text-muted">Nothing to compare yet: set at least one thing above.</p>
              : <ul className="space-y-1.5">{matches.map((m) => (
                <li key={m.moment.id} className="rounded border border-line p-2">
                  <div className="flex items-center justify-between gap-2"><span><strong>{m.moment.title || 'Untitled'}</strong> <span className="text-muted">{m.moment.date}{m.moment.time ? ` ${m.moment.time}` : ''}</span></span><span className="font-mono">{Math.round(m.score * 100)}%</span></div>
                  <p className="text-muted">{m.moment.tags.join(', ') || 'no tags'} &middot; compared on {Object.keys(m.components).join(', ')}</p>
                  <div className="mt-1 flex gap-1"><button className={btn} onClick={() => void rate(m, true)} aria-label="Good match">{'\u{1F44D}'}</button><button className={btn} onClick={() => void rate(m, false)} aria-label="Poor match">{'\u{1F44E}'}</button></div>
                </li>))}</ul>}
          <p><span className="font-medium">Reconstruction: {STATE_LABEL[conf.state]}</span> <span className="text-muted">({Math.round(conf.value * 100)}%). {conf.why}.</span></p>
          <p className="text-muted">Weights now: {Object.entries(ref.weights).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}</p>
        </div>
      </div>
      <div className="rounded-md border border-line p-3 text-xs space-y-2">
        <p className="font-medium">Scene</p>
        <p>{scene.words.length ? <>Words: <strong>{scene.words.join(', ')}</strong>{scene.momentId ? '' : ' (from your guidance and mood only: no match was strong enough to borrow from)'}</> : 'No approved words yet.'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={() => void applyScene()} disabled={!scene.words.length}>Use this scene (tell her)</button>
          <input value={space} onChange={(e) => setSpace(e.target.value)} className="rounded border border-line bg-canvas px-2 py-1 font-mono w-56" aria-label="Hugging Face Space" />
          <button className={btn} onClick={() => void paint()} disabled={!prompt || busy}>{busy ? 'Painting\u2026' : 'Paint this scene'}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={saveScene} disabled={!scene.words.length}>Save scene to a file</button>
          <button className={btn} onClick={saveState}>Save weights and log to a file</button>
          <label className={`${btn} cursor-pointer`}>Load a saved state<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { void loadState(e.target.files?.[0]); e.target.value = '' }} /></label>
          <span className="text-muted">Share the scene with other twins and agents from the Twin network panel.</span>
        </div>
        {prompt && <p className="text-muted">Sent to the image model: &ldquo;{prompt}&rdquo;</p>}
        {note && <p className="text-muted">{note}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shot && <img src={shot.src} alt={`Generated scene: ${shot.prompt}`} className="w-full max-w-sm rounded-md border border-line" />}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">Provenance log ({log.length})</summary>
        <div className="mt-2 space-y-1">
          <button className={btn} onClick={() => void verify()}>Verify chain</button> <span className="text-muted">{logOk}</span>
          <ul className="font-mono space-y-0.5">{log.map((e) => <li key={e.seq}>{e.seq} {e.kind} {e.hash.slice(0, 10)} <span className="text-muted">{e.detail}</span></li>)}</ul>
          <p className="text-muted">Ids, counts and approved words only. Saved in this browser (with your feedback weights) so it survives closing the tab. <button className="underline" onClick={forget}>Forget it all</button></p>
        </div>
      </details>
    </section>
  )
}
