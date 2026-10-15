'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import Link from 'next/link'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import {
  AGENT_PROMPT_MAX, GUIDE, KEY_FIELDS, LIMITS_TEXT, QUICK_START, agentPromptCommand, TERM_FONT, TERM_SCROLLBACK, TERM_STYLES, TERM_STYLE_LABEL, accentColor, cleanKeys, helloFrame, inputChunks,
  inputFrame, normalizeTermStyle, protocols, resizeFrame, sessionClock, sessionError, shellBase, terminalTheme, welcomeBanner, wsUrl,
  type Keys, type TermStyle,
} from '@/lib/public-shell'
import { groupCatalog, publicEntries } from '@/lib/command-catalog'
import { AGENT_LABEL, AGENT_TERMINALS, describePermission } from '@/lib/coding-assistant'
import { useDefaultAgent } from './useDefaultAgent'

// Public CloudShell: a throwaway sandbox per visitor, reached directly at the public-shell Worker (NEXT_PUBLIC_PUBLIC_SHELL_URL).
// Visitor API keys live in this component's memory only and are sent in the first WebSocket frame of the session.

type TurnstileApi = {
  render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void; theme?: string }) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

const SHELL = shellBase(process.env.NEXT_PUBLIC_PUBLIC_SHELL_URL)
const PUBLIC_GROUPS = groupCatalog(publicEntries())
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
type Status = 'idle' | 'starting' | 'connected' | 'ended'

export default function PublicShell() {
  const termEl = useRef<HTMLDivElement>(null)
  const turnstileEl = useRef<HTMLDivElement>(null)
  const widget = useRef<string | undefined>(undefined)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const token = useRef('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [humanOk, setHumanOk] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [ask, setAsk] = useState('')
  const [commands, setCommands] = useState(false)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [style, setStyle] = useState<TermStyle>('linux')
  const [guide, setGuide] = useState(true)
  const [clock, setClock] = useState<ReturnType<typeof sessionClock> | null>(null)
  const startedAt = useRef(0)
  const lastInput = useRef(0)
  const styleRef = useRef<TermStyle>('linux')
  const statusRef = useRef<Status>('idle')

  // Terminal
  useEffect(() => {
    let disposed = false
    let observer: ResizeObserver | null = null
    ;(async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
      if (disposed || !termEl.current) return
      const t = new Terminal({
        cursorBlink: true, fontSize: 14, convertEol: false, scrollback: TERM_SCROLLBACK, fontFamily: TERM_FONT,
        theme: terminalTheme(styleRef.current),
      })
      const f = new FitAddon()
      t.loadAddon(f)
      t.open(termEl.current)
      f.fit()
      for (const line of welcomeBanner(styleRef.current)) t.writeln(line)
      t.onData((data) => {
        lastInput.current = Date.now()
        const ws = socket.current
        if (ws?.readyState === WebSocket.OPEN) for (const chunk of inputChunks(data)) ws.send(inputFrame(chunk))
      })
      t.onResize(({ cols, rows }) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(resizeFrame(cols, rows)) })
      term.current = t
      fit.current = f
      observer = new ResizeObserver(() => { try { f.fit() } catch { /* hidden */ } })
      observer.observe(termEl.current)
    })()
    return () => { disposed = true; observer?.disconnect(); socket.current?.close(); term.current?.dispose(); term.current = null }
  }, [])

  // Style: colors and banner only. The banner is rewritten only while no session is running.
  useEffect(() => {
    styleRef.current = style
    const t = term.current
    if (!t) return
    t.options.theme = terminalTheme(style)
    if (statusRef.current !== 'connected') { t.reset(); for (const line of welcomeBanner(style)) t.writeln(line) }
  }, [style])

  useEffect(() => { statusRef.current = status }, [status])

  // Session clock (estimate from this browser's clock; the server is the authority).
  useEffect(() => {
    if (status !== 'connected') return
    const id = setInterval(() => setClock(sessionClock(startedAt.current, lastInput.current, Date.now())), 1000)
    return () => clearInterval(id)
  }, [status])

  // Turnstile
  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false
    const mount = () => {
      if (cancelled || !turnstileEl.current || !window.turnstile) return
      widget.current = window.turnstile.render(turnstileEl.current, {
        sitekey: SITE_KEY, theme: 'auto',
        callback: (t) => { token.current = t; setHumanOk(true) },
        'expired-callback': () => { token.current = ''; setHumanOk(false) },
        'error-callback': () => { token.current = ''; setHumanOk(false) },
      })
    }
    if (window.turnstile) mount()
    else {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.onload = mount
      document.head.appendChild(s)
    }
    return () => { cancelled = true; if (widget.current) window.turnstile?.remove(widget.current) }
  }, [])

  const start = useCallback(async () => {
    if (!SHELL || !token.current) return
    const cleaned = cleanKeys(keys)
    if (cleaned.error) { setMessage(cleaned.error); setDrawer(true); return }
    setStatus('starting'); setMessage('')
    const human = token.current
    token.current = ''; setHumanOk(false)
    try {
      const res = await fetch(`${SHELL}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstile: human }), cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!res.ok || !body.token) throw new Error(sessionError(res.status, body.error))
      term.current?.reset()
      const ws = new WebSocket(wsUrl(SHELL), protocols(body.token))
      ws.binaryType = 'arraybuffer'
      socket.current = ws
      ws.onopen = () => {
        startedAt.current = Date.now(); lastInput.current = startedAt.current; setClock(sessionClock(startedAt.current, lastInput.current, startedAt.current))
        fit.current?.fit()
        const t = term.current
        ws.send(helloFrame(t?.cols ?? 80, t?.rows ?? 24, cleaned.keys as Keys))
        setStatus('connected'); t?.focus()
      }
      ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) term.current?.write(new Uint8Array(e.data)) }
      ws.onclose = (e) => {
        setStatus('ended')
        setMessage(e.reason ? `Session closed: ${e.reason}` : 'Session closed.')
        if (widget.current) window.turnstile?.reset(widget.current)
        socket.current = null
      }
      ws.onerror = () => setMessage('The connection failed.')
    } catch (e) {
      setStatus('idle'); setMessage(e instanceof Error ? e.message : 'The sandbox could not be started.')
      if (widget.current) window.turnstile?.reset(widget.current)
    }
  }, [keys])

  const stop = () => socket.current?.close(1000, 'closed by you')
  const type = (command: string) => {
    const ws = socket.current
    if (ws?.readyState === WebSocket.OPEN) { ws.send(inputFrame(command + '\r')); term.current?.focus() }
  }

  // Types the command into the terminal WITHOUT Enter, so the visitor can read and edit it first.
  const fill = (command: string) => {
    const ws = socket.current
    if (ws?.readyState === WebSocket.OPEN) { for (const chunk of inputChunks(command)) ws.send(inputFrame(chunk)); term.current?.focus() }
  }

  const live = status === 'connected'
  const [agent, setAgent] = useDefaultAgent()
  const accent = accentColor(style)
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-warn/40 bg-surface p-4 text-sm" role="note">
        <p className="font-semibold mb-1">Read this first</p>
        <ul className="list-disc pl-5 space-y-1 text-muted">{LIMITS_TEXT.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>

      {!SHELL && <p className="text-sm text-bad">The public sandbox is not configured on this deployment (NEXT_PUBLIC_PUBLIC_SHELL_URL is not set).</p>}
      {SHELL && !SITE_KEY && <p className="text-sm text-bad">The human check is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set).</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div ref={turnstileEl} />
        <button type="button" onClick={start} disabled={!SHELL || !humanOk || status === 'starting' || live}
          className="rounded-md bg-accent text-white px-4 py-2 text-sm disabled:opacity-50">
          {status === 'starting' ? 'Starting…' : live ? 'Running' : 'Start sandbox'}
        </button>
        <button type="button" onClick={stop} disabled={!live} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">End session</button>
        <button type="button" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} className="rounded-md border border-line px-3 py-2 text-sm">API keys</button>
        <button type="button" onClick={() => setCommands((d) => !d)} aria-expanded={commands} className="rounded-md border border-line px-3 py-2 text-sm">Commands</button>
        {QUICK_START.map((q) => (
          <button key={q.command} type="button" onClick={() => type(q.command)} disabled={!live} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-canvas disabled:opacity-50">{q.label}</button>
        ))}
      </div>
      <div className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Default coding agent">
          <span className="font-semibold">Default coding agent</span>
          {AGENT_TERMINALS.map((a) => (
            <button key={a} type="button" onClick={() => setAgent(a)} aria-pressed={agent === a}
              className={`rounded-md border px-3 py-1 ${agent === a ? 'border-accent bg-canvas font-semibold' : 'border-line'}`}>{AGENT_LABEL[a]}</button>
          ))}
          <button type="button" onClick={() => fill(agent)} disabled={!live} className="rounded-md border border-line px-3 py-1 disabled:opacity-50">Start my default agent</button>
          <button type="button" onClick={() => fill('pwsh')} disabled={!live} className="rounded-md border border-line px-3 py-1 disabled:opacity-50">Start PowerShell</button>
          <span className="inline-flex items-center gap-2 ml-2">
            <span>Style:</span>
            {TERM_STYLES.map((st) => (
              <button key={st} type="button" onClick={() => setStyle(normalizeTermStyle(st))} aria-pressed={style === st}
                className={`rounded-md border px-3 py-1 ${style === st ? 'border-accent bg-canvas font-semibold' : 'border-line'}`}>{TERM_STYLE_LABEL[st]}</button>
            ))}
          </span>
        </div>
        <p className="text-muted">{describePermission('public')} The button only types <code>{agent}</code>; press Enter yourself. Saved in this browser only. The style toggle changes colors and the banner only. Start PowerShell types <code>pwsh</code> (PowerShell 7, press Enter yourself); the login shell is bash, and PowerShell uses the normal connection through the sandbox allowlist. ping, DNS tools, traceroute and port scanners are intentionally not installed here.</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
        <label className="block font-semibold" htmlFor="agent-ask">Ask the {AGENT_LABEL[agent]} coding agent</label>
        <textarea id="agent-ask" value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={AGENT_PROMPT_MAX} rows={3} placeholder="Describe the task, for example: build a small script that reads the public ledger and checks every hash link."
          className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!live || !agentPromptCommand(agent, ask)} onClick={() => { const c = agentPromptCommand(agent, ask); if (c) fill(c) }}
            className="rounded-md bg-accent text-white px-3 py-1 disabled:opacity-50">Put prompt in terminal</button>
          <button type="button" disabled={!live} onClick={() => fill('rabbit-save')} className="rounded-md border border-line px-3 py-1 disabled:opacity-50">Save my files</button>
          <button type="button" disabled={!live} onClick={() => fill('rabbit-restore')} className="rounded-md border border-line px-3 py-1 disabled:opacity-50">Restore my files</button>
        </div>
        <p className="text-muted">The prompt is typed into the terminal as <code>{agent}</code> with your text; press Enter yourself to run it. Needs your API key (or <code>copilot</code> login) first. Save prints your <code>~/work</code> files as one text block you can keep; Restore reads it back in a new session. Nothing is stored on the server.</p>
      </div>
      {message && <p className="text-sm text-muted" role="status">{message}</p>}

      {drawer && (
        <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
          <p className="text-sm text-muted">Optional. Keys stay in this tab&apos;s memory (gone on reload), are sent once when a session starts, and are given only to your sandbox process. Use a low-limit key. Changes apply to the next session.</p>
          {KEY_FIELDS.map((f) => (
            <label key={f.name} className="block text-sm">
              <span className="block mb-1">{f.label}</span>
              <input type={showKeys ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={keys[f.name] ?? ''} onChange={(e) => setKeys((k) => ({ ...k, [f.name]: e.target.value }))}
                className="w-full rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm" />
            </label>
          ))}
          <p className="text-sm text-muted">
            Copilot (<code>copilot</code>) needs a GitHub Copilot subscription. Alternative to the token: leave it empty, start the sandbox, run <code>copilot</code> and
            type <code>/login</code>; it prints a one-time code and a URL to open in your own browser (device flow). The token must be a fine-grained personal access
            token with the &quot;Copilot Requests&quot; permission, and is used only inside your sandbox process.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowKeys((v) => !v)} aria-pressed={showKeys} className="rounded-md border border-line px-3 py-1 text-sm">{showKeys ? 'Hide keys' : 'Show keys'}</button>
            <button type="button" onClick={() => setKeys({})} className="rounded-md border border-line px-3 py-1 text-sm">Clear keys</button>
          </div>
        </div>
      )}

      {commands && (
        <div className="rounded-lg border border-line bg-surface p-4 space-y-3 max-h-80 overflow-auto">
          <p className="text-sm text-muted">Public commands only. Choosing one types it into the terminal without pressing Enter: read it, edit it, then press Enter yourself.{live ? '' : ' Start the sandbox first.'} The full list, with owner-only commands, is on the <Link className="underline" href="/commands">Commands page</Link>.</p>
          {PUBLIC_GROUPS.map((g) => (
            <div key={`${g.project}/${g.group}`}>
              <p className="text-xs font-semibold text-muted mb-1">{g.project} / {g.group}</p>
              <div className="flex flex-wrap gap-2">
                {g.entries.map((e) => (
                  <button key={e.id} type="button" title={e.command} onClick={() => fill(e.command)} disabled={!live}
                    className="rounded-md border border-line px-3 py-1 text-sm hover:bg-canvas disabled:opacity-50">{e.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="min-w-0 grow overflow-hidden rounded-lg border border-line bg-black" style={{ boxShadow: `0 0 0 1px ${accent}33` }}>
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-line bg-[#1b1b1b] text-[#cccccc]" style={{ fontFamily: TERM_FONT }}>
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: live ? accent : '#6b6b6b' }} />
            <span className="font-semibold">visitor@rabbitos: ~ (bash)</span>
            <span className="ml-auto" role="timer" aria-label="Session clock">
              {live && clock ? `session ${clock.elapsed}  idle ends ${clock.idle}  hard stop ${clock.left}` : status === 'ended' ? 'session ended' : 'not connected'}
            </span>
            <button type="button" onClick={() => setGuide((g) => !g)} aria-expanded={guide} className="rounded border border-[#555] px-2 py-0.5">{guide ? 'Hide guide' : 'Guide'}</button>
          </div>
          <div ref={termEl} className="h-[28rem] w-full bg-black p-2 overflow-hidden" aria-label="Terminal" />
        </div>
        {guide && (
          <aside className="lg:w-80 shrink-0 rounded-lg border border-line bg-surface p-3 text-sm space-y-3 max-h-[31rem] overflow-auto" aria-label="Guide">
            <p className="font-semibold">Guide</p>
            {GUIDE.map((g) => (
              <div key={g.title}>
                <p className="font-semibold">{g.title}</p>
                <ul className="list-disc pl-5 text-muted space-y-1">{g.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  )
}
