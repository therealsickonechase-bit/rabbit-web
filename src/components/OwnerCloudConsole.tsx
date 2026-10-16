'use client'

import { useEffect, useRef, useState } from 'react'
import { CATALOG, PROJECTS, findEntry, runsIn } from '@/lib/command-catalog'
import {
  OWNER_HELP, appendScroll, freshCursor, isHelpCommand, outputText, pushHistory, statusText, stepHistory, type HistoryCursor, type ScrollEntry,
} from '@/lib/terminal-history'
import AiCoderPanel, { type ShellOutcome } from './AiCoderPanel'
import { SESSION_DEFAULT_TIMEOUT, SESSION_TIMEOUTS, sessionLine, sessionView, shellPayload, type SessionView } from '@/lib/cloud-session'

const MONO = 'Cascadia Mono, Consolas, Menlo, monospace'

export default function OwnerCloudConsole({ service, configured, roots = [] }: {
  service: 'shell' | 'vault'; configured: boolean; roots?: string[]
}) {
  const [command, setCommand] = useState('')
  const [snapshot, setSnapshot] = useState('{\n  "mode": "task",\n  "instruction": "",\n  "notes": []\n}')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState('')
  const [resultNotice, setResultNotice] = useState('')
  const [job, setJob] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState<HistoryCursor>(freshCursor)
  const [scroll, setScroll] = useState<ScrollEntry[]>([])
  const [showHelp, setShowHelp] = useState(true)
  const [keepSession, setKeepSession] = useState(false)
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(SESSION_DEFAULT_TIMEOUT)
  const [session, setSession] = useState<SessionView | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const nextId = useRef(1)
  const logEl = useRef<HTMLDivElement>(null)
  const shell = service === 'shell'
  useEffect(() => { const el = logEl.current; if (el) el.scrollTop = el.scrollHeight }, [scroll, showHelp])
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (!shell || !configured) return
    let cancelled = false
    fetch('/api/cloudshell/session', { cache: 'no-store', credentials: 'same-origin' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (!cancelled && data) { const view = sessionView(data.session); setSession(view); if (view.active) setKeepSession(true) } })
      .catch(() => { /* the status line simply stays at "no session" */ })
    return () => { cancelled = true }
  }, [shell, configured])

  /** Adds a finished run to the in-memory history and scrollback. Display only: it never submits anything. */
  function record(ran: string, outcome: ShellOutcome) {
    setHistory(previous => pushHistory(previous, ran)); setCursor(freshCursor)
    const entry: ScrollEntry = outcome.ok
      ? { id: nextId.current++, command: ran, output: outputText(outcome.data), status: statusText(outcome.data) }
      : { id: nextId.current++, command: ran, output: '', status: `not run or failed: ${outcome.error}` }
    setScroll(previous => appendScroll(previous, entry)); setShowHelp(false)
  }
  const button = 'border border-line rounded px-3 py-2 disabled:opacity-50'

  async function request(path: string, payload?: unknown): Promise<ShellOutcome> {
    setBusy(true); setError(''); setResultNotice('')
    let status: number | undefined
    try {
      const response = await fetch(path, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: 'no-store', credentials: 'same-origin',
      })
      status = response.status
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed.')
      setReport(JSON.stringify(data, null, 2))
      if (shell && data.session) setSession(sessionView(data.session))
      if (shell && typeof data.exitCode === 'number') {
        setResultNotice(data.timedOut ? 'Command timed out; this is not a successful run.' :
          data.exitCode !== 0 ? `Command failed with exit code ${data.exitCode}.` :
          data.truncated ? 'Output was truncated; the report is incomplete.' : 'Command returned exit code 0.')
        if (data.truncated && (data.timedOut || data.exitCode !== 0)) {
          setResultNotice(previous => `${previous} Output was also truncated.`)
        }
      }
      if (!shell && payload !== undefined) {
        const id = data.id ?? data.jobId ?? data.job_id
        if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) setJob(id)
      }
      return { ok: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      setError(message)
      return { ok: false, status, error: message }
    } finally { setBusy(false) }
  }

  /** The AI coder panel runs a command through exactly the same request as the "Run approved command" button. */
  const executeForAssistant = async (assembled: string) => {
    const outcome = await request('/api/cloudshell/execute', shellPayload(assembled, keepSession, timeoutSeconds))
    record(assembled, outcome)
    return outcome
  }

  async function submit() {
    if (!consent || busy || !configured) return
    setConsent(false)
    if (shell) {
      record(command, await request('/api/cloudshell/execute', shellPayload(command, keepSession, timeoutSeconds)))
    } else {
      try {
        const input = JSON.parse(snapshot)
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a snapshot object.')
        await request('/api/vault/jobs', { ...input, consent: true })
      } catch (error) { setError(error instanceof Error ? error.message : 'Invalid snapshot JSON.') }
    }
  }

  /** Opens or ends the working session. Clicking the button is the approval; nothing else is sent. */
  async function sessionAct(action: 'start' | 'end') {
    if (busy || !configured) return
    const outcome = await request('/api/cloudshell/session', { action, consent: true })
    if (outcome.ok) {
      const data = outcome.data as { session?: unknown }
      setSession(sessionView(data.session))
      setKeepSession(action === 'start')
      setResultNotice(action === 'start' ? 'Session opened.' : 'Session ended and its sandbox destroyed.')
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = shell ? 'rabbitos-shell-report.txt' : 'rabbitos-vault-job.txt'
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="space-y-4">
    <p className="rounded border border-line p-3" role="status">
      {configured ? 'Server configuration is present; service availability has not been verified. Nothing runs until you approve and submit.' : 'Service is not deployed/configured yet. Remote submission is disabled.'}
    </p>
    {shell ? <>
      {keepSession
        ? <p>Bounded Linux bash command console in a <strong>working session</strong>, not an interactive PTY. Commands share one sandbox, so files, installs and background jobs (for example <code>nohup npm run build &gt; build.log 2&gt;&amp;1 &amp;</code>, then <code>tail build.log</code> in a later command) stay between commands. Each command: at most 4000 UTF-8 bytes, up to {timeoutSeconds} seconds (150 at most), 128 KiB of output, one command in flight. The session ends after 20 idle minutes, after 2 hours in all, or when you end it; the sandbox is then destroyed and its files are gone. Shell directory and variables are not kept: each command starts in /workspace.</p>
        : <p>Bounded Linux bash command console, not an interactive PTY. Each command launches independently (no persistent shell directory or variables). Maximum 4000 UTF-8 bytes, 60 seconds of remote execution, and one command in flight. Startup and teardown may extend the overall wait to 210 seconds. Files are ephemeral and the container is destroyed after each run. Turn on <em>Keep a working session</em> below to keep files and installs between commands.</p>}
      <p>A failed or timed-out request does not prove the command was canceled. There are no automatic retries. Do not resubmit blindly.</p>
      <p>Commands can delete files and use the network. Network usage may incur costs. Never enter provider credentials, tokens or private data. No app credentials are passed into the sandbox. Commands and output are not uploaded anywhere else by this console.</p>
      <label className="block">Command catalog (fills the box below; nothing runs until you approve and click Run)
        <select value="" onChange={event => { const entry = findEntry(event.target.value); if (entry) { setCommand(entry.command); setConsent(false) } }} disabled={busy} className="block w-full border border-line rounded p-2 bg-transparent">
          <option value="">Pick a catalog command…</option>
          {PROJECTS.map(project => <optgroup key={project} label={project}>
            {CATALOG.filter(entry => entry.project === project).map(entry => <option key={entry.id} value={entry.id}>
              {entry.label} [{entry.scope}{runsIn(entry) === 'computer' ? ', repo root on your computer' : ''}]
            </option>)}
          </optgroup>)}
        </select>
      </label>
      <div className="rounded-lg border border-line overflow-hidden bg-black text-[#cccccc]" style={{ fontFamily: MONO }}>
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-[#1b1b1b] border-b border-line">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: busy ? '#f5a623' : '#16c60c' }} />
          <span className="font-semibold">owner@cloudshell: ~ ({keepSession ? 'bash, working session' : 'bash, one command per run'})</span>
          <button type="button" onClick={() => setShowHelp(h => !h)} aria-expanded={showHelp} className="ml-auto rounded border border-[#555] px-2 py-0.5">{showHelp ? 'Hide help' : 'help'}</button>
        </div>
        <div ref={logEl} role="log" aria-label="Terminal output" className="max-h-80 overflow-auto px-3 py-2 text-sm space-y-2">
          {showHelp && <div role="note" aria-label="help" className="border border-[#333] rounded p-2 text-[#9cdcfe]">
            <p className="font-semibold">help</p>
            <ul className="list-disc pl-5">{OWNER_HELP.map(line => <li key={line}>{line}</li>)}</ul>
          </div>}
          {scroll.length === 0 && !showHelp && <p className="text-[#888]">No commands run yet in this tab.</p>}
          {scroll.map(entry => <div key={entry.id}>
            <p><span className="text-[#16c60c]">owner@cloudshell:~$</span> <span className="whitespace-pre-wrap break-words">{entry.command}</span></p>
            {entry.output && <pre className="whitespace-pre-wrap break-words">{entry.output}</pre>}
            <p className="text-xs text-[#888]">[{entry.status}]</p>
          </div>)}
        </div>
        <label className="flex gap-2 items-start px-3 py-2 border-t border-[#333] text-sm">
          <span className="text-[#16c60c] shrink-0 pt-0.5" aria-hidden>owner@cloudshell:~$</span>
          <span className="sr-only">Bash command</span>
          <textarea value={command} disabled={busy} rows={2} spellCheck={false} autoComplete="off" aria-label="Bash command"
            placeholder="type a command; Enter does not run it (approve below, then Run). Up/Down: history. help: guide"
            onChange={event => { setCommand(event.target.value); setConsent(false); setCursor(freshCursor) }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && isHelpCommand(command)) {
                event.preventDefault(); setCommand(''); setConsent(false); setShowHelp(true)
              } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !command.includes('\n')) {
                event.preventDefault()
                const next = stepHistory(history, cursor, event.key === 'ArrowUp' ? 'up' : 'down', command)
                setCursor(next.cursor); setCommand(next.value); setConsent(false)
              }
            }}
            className="grow bg-transparent text-[#cccccc] outline-none resize-y placeholder:text-[#666]" />
        </label>
      </div>
    </> : <>
      <p>Manually enter or upload an approved snapshot JSON object with mode (task, answer or organize), instruction, and notes (path, content). This page never reads your vault filesystem or discovers private notes. Only these selected contents leave your browser when you approve submission.</p>
      <p>Permitted roots: {roots.join(', ') || 'not configured'}. Every note must have top-level <code>cloud-agent-share: true</code> frontmatter (trailing whitespace accepted). Maximum 40 notes, 16000 UTF-8 bytes per note, 240 characters per path, 4000 UTF-8 bytes for the trimmed instruction, and 64 KiB normalized upstream payload. Private-key/GitHub/AWS credential patterns in notes are rejected; this is not a comprehensive secret detector. Results are proposals only; nothing is automatically written to your vault.</p>
      <label className="block">Select an approved JSON snapshot
        <input type="file" accept=".json,application/json" disabled={busy} className="block" onChange={async event => {
          const file = event.target.files?.[0]
          if (!file) return
          setConsent(false)
          if (file.size > 70_000) { setError('Snapshot file exceeds 70000 bytes.'); return }
          try { setSnapshot(await file.text()); setError('') }
          catch { setError('Could not read the selected file.') }
        }} />
      </label>
      <label className="block">Approved snapshot JSON
        <textarea value={snapshot} onChange={event => { setSnapshot(event.target.value); setConsent(false) }} disabled={busy} rows={12} className="block w-full border border-line rounded p-3 font-mono" spellCheck={false} />
      </label>
    </>}
    {shell && <div className="rounded border border-line p-3 space-y-2">
      <label className="flex gap-2 items-start">
        <input type="checkbox" checked={keepSession} onChange={event => setKeepSession(event.target.checked)} disabled={busy || !configured} />
        <span>Keep a working session (files, installs and background jobs stay between commands; up to 20 idle minutes or 2 hours; commands may run up to 150 seconds).</span>
      </label>
      {keepSession && <label className="block">Time limit per command
        <select value={timeoutSeconds} onChange={event => setTimeoutSeconds(Number(event.target.value))} disabled={busy} className="ml-2 border border-line rounded p-1 bg-transparent">
          {SESSION_TIMEOUTS.map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
        </select>
      </label>}
      <p role="status" className="text-sm">{sessionLine(session, clock)}</p>
      <div className="flex gap-2">
        <button type="button" className={button} disabled={busy || !configured || !!session?.active} onClick={() => sessionAct('start')}>Open session now (approve)</button>
        <button type="button" className={button} disabled={busy || !configured || !session?.active} onClick={() => sessionAct('end')}>End session and destroy its sandbox</button>
      </div>
    </div>}
    <label className="flex gap-2 items-start">
      <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy || !configured} />
      <span>{shell ? (keepSession ? 'I approve executing this specific command and its network usage in the persistent session sandbox.' : 'I approve executing this specific command and its network usage in the ephemeral cloud sandbox.') : 'I approve sending only this selected, share-enabled snapshot and instruction to the cloud vault agent.'}</span>
    </label>
    <button className={button} disabled={busy || !configured || !consent} onClick={submit}>{busy ? 'Waiting…' : shell ? 'Run approved command' : 'Submit approved snapshot'}</button>
    {shell && <AiCoderPanel configured={configured} busy={busy} execute={executeForAssistant} />}
    {!shell && <div className="space-y-2">
      <label className="block">Job ID (64 lowercase hexadecimal characters)
        <input value={job} onChange={event => setJob(event.target.value)} className="block w-full border border-line rounded p-2 font-mono" />
      </label>
      <div className="flex gap-2">
        <button className={button} disabled={busy || !configured || !/^[a-f0-9]{64}$/.test(job)} onClick={() => request(`/api/vault/jobs/${job}`)}>Refresh status</button>
        <button className={button} disabled={busy || !configured || !/^[a-f0-9]{64}$/.test(job)} onClick={() => request(`/api/vault/jobs/${job}/result`)}>Get result</button>
      </div>
    </div>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {report && <div className="space-y-2">
      <h2 className="font-semibold">Owner-only report</h2>
      {resultNotice && <p role="status">{resultNotice}</p>}
      <pre className="whitespace-pre-wrap break-words border border-line rounded p-3 max-h-96 overflow-auto">{report}</pre>
      <div className="flex gap-2">
        <button className={button} onClick={async () => { try { await navigator.clipboard.writeText(report) } catch { setError('Clipboard unavailable; select the report text or download it.') } }}>Copy report</button>
        <button className={button} onClick={download}>Download text</button>
        <button className={button} onClick={() => { setReport(''); setResultNotice('') }}>Clear report</button>
      </div>
      <p className="text-sm text-muted">Held in this tab only, never saved to browser storage. Copy/download creates your own local copy; review before sharing.</p>
    </div>}
  </section>
}
