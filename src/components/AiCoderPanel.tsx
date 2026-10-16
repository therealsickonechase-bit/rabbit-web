'use client'

import { useRef, useState } from 'react'
import { aiContext } from '@/lib/command-catalog'
import {
  DEFAULT_CLAUDE_MODEL, GEMINI_MODEL_PLACEHOLDER, MAX_STEPS, buildCommand, checkProviderConfig, completeWithProvider,
  feedbackFor, hasStepsLeft, initialMessages, invalidMessage, refusalMessage, resultMessage, safetyReview, scrub,
  COPILOT_API_NOTE, apiProviderFor, describePermission, fetchGeminiModels, normalizeDefaultAgent, shellFailureStop, validateProposal, type ChatMessage, type Proposal,
} from '@/lib/coding-assistant'
import { useDefaultAgent } from './useDefaultAgent'

export type ShellOutcome =
  | { ok: true; data: { stdout?: unknown; stderr?: unknown; exitCode?: unknown; timedOut?: unknown; truncated?: unknown } }
  | { ok: false; status?: number; error: string }

type Phase = 'idle' | 'thinking' | 'review' | 'running' | 'stopped'
interface Review { proposal: Proposal; full: string; warn: string | null }

// The API key lives only in this component's React state. It is never written to storage or cookies, never sent to RabbitOS,
// and never logged; it goes straight from the browser to the chosen provider in a request header.
export default function AiCoderPanel({ configured, busy, execute }: {
  configured: boolean; busy: boolean; execute: (command: string) => Promise<ShellOutcome>
}) {
  const [task, setTask] = useState('')
  const [agent, setAgent] = useDefaultAgent()
  const provider = apiProviderFor(agent)
  const [geminiModels, setGeminiModels] = useState<string[]>([])
  const [modelsNote, setModelsNote] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [geminiModel, setGeminiModel] = useState('')
  const [claudeModel, setClaudeModel] = useState(DEFAULT_CLAUDE_MODEL)
  const [apiKey, setApiKey] = useState('')
  const [shareCatalog, setShareCatalog] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [review, setReview] = useState<Review | null>(null)
  const [consent, setConsent] = useState(false)
  const [warnConsent, setWarnConsent] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [stopReason, setStopReason] = useState('')
  const messages = useRef<ChatMessage[]>([])
  const calls = useRef(0)
  const invalid = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const button = 'border border-line rounded px-3 py-2 disabled:opacity-50'
  const model = provider === 'gemini' ? geminiModel : claudeModel
  const secrets = () => [apiKey.trim()]
  const note = (line: string) => setLog(previous => [...previous, scrub(line, secrets())])

  async function loadModels() {
    setLoadingModels(true); setModelsNote('')
    try {
      const ids = await fetchGeminiModels(apiKey)
      setGeminiModels(ids)
      setModelsNote(`Loaded ${ids.length} models that support generateContent.`)
      if (!ids.includes(geminiModel)) setGeminiModel('')
    } catch (error) {
      setGeminiModels([])
      setModelsNote(scrub(error instanceof Error ? error.message : 'Could not load models.', secrets()))
    } finally { setLoadingModels(false) }
  }

  function stop(reason: string) {
    abort.current?.abort(); abort.current = null
    setStopReason(reason); setPhase('stopped'); setReview(null); setConsent(false); setWarnConsent(false)
  }

  async function advance() {
    for (;;) {
      if (!hasStepsLeft(calls.current)) { stop('step limit reached'); return }
      calls.current += 1
      setPhase('thinking'); setReview(null)
      const controller = new AbortController()
      abort.current = controller
      let raw: string
      try {
        raw = await completeWithProvider({ provider, apiKey, model }, messages.current, fetch, controller.signal)
      } catch (error) {
        if (controller.signal.aborted) return
        stop(`provider failed: ${scrub(error instanceof Error ? error.message : 'error', secrets())}`); return
      }
      if (controller.signal.aborted) return
      let proposal: Proposal
      try { proposal = validateProposal(raw) } catch (error) {
        const why = scrub(error instanceof Error ? error.message : 'invalid reply', secrets())
        note(`Model reply rejected: ${why}`)
        // one re-ask is allowed; two invalid replies in a row stop the task
        invalid.current += 1
        if (invalid.current >= 2) { stop('repeated invalid replies'); return }
        messages.current.push({ role: 'assistant', content: '(invalid reply)' }, invalidMessage(why))
        continue
      }
      invalid.current = 0
      messages.current.push({ role: 'assistant', content: raw })
      if (proposal.done) { note(`Done: ${proposal.explanation}`); stop('done'); return }
      let full: string
      try { full = buildCommand(proposal.files, proposal.command) } catch (error) {
        const why = error instanceof Error ? error.message : 'rejected'
        note(`Rejected locally: ${why}`)
        messages.current.push({ role: 'user', content: `Rejected locally: ${why}` })
        continue
      }
      const { refuse, warn } = safetyReview(proposal, full)
      if (refuse) {
        note(`Refused by local safety policy (${refuse}). Not run.`)
        messages.current.push(refusalMessage(refuse))
        continue
      }
      setReview({ proposal, full, warn })
      setConsent(false); setWarnConsent(false)
      setPhase('review')
      return
    }
  }

  async function start() {
    const problem = checkProviderConfig({ provider, apiKey, model })
    if (problem) { setStopReason(problem); setPhase('stopped'); return }
    if (!task.trim()) { setStopReason('Describe a task first.'); setPhase('stopped'); return }
    messages.current = initialMessages(shareCatalog ? `${task}

${aiContext()}` : task, secrets())
    calls.current = 0; invalid.current = 0
    setLog([]); setStopReason('')
    await advance()
  }

  async function run() {
    if (!review || !consent || (review.warn && !warnConsent) || busy || !configured || phase !== 'review') return
    const { full } = review
    setConsent(false); setWarnConsent(false); setPhase('running')
    const outcome = await execute(full)
    if (!outcome.ok) {
      note(`CloudShell call failed: ${outcome.error}`)
      stop(shellFailureStop(outcome.status)); return
    }
    const feedback = feedbackFor(outcome.data, secrets())
    note(`Result: exit ${String(outcome.data.exitCode)}${outcome.data.timedOut === true ? ' (timed out)' : ''}${outcome.data.truncated === true ? ' (truncated)' : ''}`)
    messages.current.push(resultMessage(feedback))
    await advance()
  }

  const working = phase === 'thinking' || phase === 'running'
  return <section aria-labelledby="ai-coder" className="space-y-3 border border-line rounded p-4">
    <h2 id="ai-coder" className="font-semibold">AI coder</h2>
    <p className="text-sm">
      The assistant proposes one command at a time; nothing runs until you tick the approval box and click Run, every time, through the same
      approval-gated path as above (an active approved grant is required). At most {MAX_STEPS} steps per task; it stops on done, deny, an expired
      grant or any shell error, and never retries. Your API key stays in this tab&apos;s memory only: it is not stored and not sent to RabbitOS,
      only to the provider you choose. Command output is sent to that provider after credential patterns and your key are removed (16 KB cap).
    </p>
    <label className="block">Task
      <textarea value={task} onChange={event => setTask(event.target.value)} disabled={working} rows={3} className="block w-full border border-line rounded p-3" />
    </label>
    <div className="flex flex-wrap gap-4 items-end">
      <label className="block">Default coding agent
        <select value={agent} onChange={event => setAgent(normalizeDefaultAgent(event.target.value))} disabled={working} className="block border border-line rounded p-2 bg-transparent">
          <option value="gemini">Gemini</option>
          <option value="claude">Claude</option>
          <option value="copilot">Copilot (terminal only)</option>
        </select>
      </label>
      {agent === 'copilot' && <p className="text-sm basis-full" role="note">{COPILOT_API_NOTE}: this panel uses Gemini. Copilot is started from the public CloudShell.</p>}
      {provider === 'gemini' && geminiModels.length > 0 && <label className="block">Model (from your key)
        <select value={geminiModels.includes(geminiModel) ? geminiModel : ''} onChange={event => setGeminiModel(event.target.value)} disabled={working} className="block border border-line rounded p-2 bg-transparent">
          <option value="">Pick a model…</option>
          {geminiModels.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>}
      <label className="block grow">Model name{provider === 'gemini' && geminiModels.length > 0 ? ' (or type one)' : ''}
        <input value={model} onChange={event => provider === 'gemini' ? setGeminiModel(event.target.value) : setClaudeModel(event.target.value)}
          placeholder={provider === 'gemini' ? GEMINI_MODEL_PLACEHOLDER : DEFAULT_CLAUDE_MODEL} disabled={working}
          className="block w-full border border-line rounded p-2 font-mono" spellCheck={false} autoComplete="off" />
      </label>
    </div>
    <p className="text-sm" data-testid="permission-rule">{describePermission('owner')} Your choice is saved in this browser only.</p>
    <label className="block">{provider === 'gemini' ? 'Gemini' : 'Anthropic'} API key (this tab only)
      <input type="password" value={apiKey} onChange={event => { setApiKey(event.target.value); setGeminiModels([]); setModelsNote('') }} disabled={working} autoComplete="off" spellCheck={false}
        className="block w-full border border-line rounded p-2 font-mono" />
    </label>
    <label className="flex gap-2 items-start text-sm">
      <input type="checkbox" checked={shareCatalog} onChange={event => setShareCatalog(event.target.checked)} disabled={working} />
      <span>Also send the command catalog (ids and labels only, no command text) to the provider as context.</span>
    </label>
    <div className="flex gap-2">
      <button className={button} disabled={working || busy || !configured || !task.trim() || !apiKey.trim()} onClick={start}>Ask AI coder</button>
      {provider === 'gemini' && <button className={button} disabled={working || loadingModels || !apiKey.trim()} onClick={loadModels}>{loadingModels ? 'Loading…' : 'Load models from my key'}</button>}
      <button className={button} disabled={!apiKey} onClick={() => { setApiKey(''); setGeminiModels([]); setModelsNote('') }}>Forget key</button>
      {working && <button className={button} onClick={() => stop('stopped by you')}>Stop</button>}
    </div>
    {modelsNote && <p role="status" className="text-sm">{modelsNote}</p>}
    {phase === 'thinking' && <p role="status">Waiting for the model…</p>}
    {phase === 'running' && <p role="status">Running in CloudShell…</p>}
    {phase === 'review' && review && <div className="space-y-2" role="group" aria-label="Proposed command">
      <p><strong>Step {calls.current} of at most {MAX_STEPS}.</strong> {review.proposal.explanation}</p>
      {review.proposal.files.map(file => <div key={file.path}>
        <p className="font-mono text-sm">File: {file.path}</p>
        <pre className="whitespace-pre-wrap break-words border border-line rounded p-3 max-h-48 overflow-auto">{file.content}</pre>
      </div>)}
      <p className="text-sm">Exact text that will be sent to CloudShell (files are written by this script):</p>
      <pre className="whitespace-pre-wrap break-words border border-line rounded p-3 max-h-64 overflow-auto">{review.full}</pre>
      {review.warn && <>
        <p role="alert" className="text-red-500">WARNING: {review.warn}</p>
        <label className="flex gap-2 items-start">
          <input type="checkbox" checked={warnConsent} onChange={event => setWarnConsent(event.target.checked)} />
          <span>I understand this downloads and runs unreviewed code, and I still want to run it.</span>
        </label>
      </>}
      <label className="flex gap-2 items-start">
        <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy || !configured} />
        <span>I approve executing this specific command and its network usage in the cloud sandbox (the working session, if it is on above).</span>
      </label>
      <div className="flex gap-2">
        <button className={button} disabled={busy || !configured || !consent || (Boolean(review.warn) && !warnConsent)} onClick={run}>Run in CloudShell</button>
        <button className={button} onClick={() => { note('Denied by you.'); stop('denied') }}>Deny</button>
      </div>
    </div>}
    {log.length > 0 && <ul className="list-disc pl-5 text-sm">{log.map((line, i) => <li key={i} className="whitespace-pre-wrap break-words">{line}</li>)}</ul>}
    {phase === 'stopped' && stopReason && <p role="status">Stopped: {stopReason}.</p>}
  </section>
}
