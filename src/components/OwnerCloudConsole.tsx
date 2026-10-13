'use client'

import { useState } from 'react'

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
  const shell = service === 'shell'
  const button = 'border border-line rounded px-3 py-2 disabled:opacity-50'

  async function request(path: string, payload?: unknown) {
    setBusy(true); setError(''); setResultNotice('')
    try {
      const response = await fetch(path, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: 'no-store', credentials: 'same-origin',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed.')
      setReport(JSON.stringify(data, null, 2))
      if (shell) {
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
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Request failed.')
    } finally { setBusy(false) }
  }

  async function submit() {
    if (!consent || busy || !configured) return
    setConsent(false)
    if (shell) {
      await request('/api/cloudshell/execute', { command, consent: true })
    } else {
      try {
        const input = JSON.parse(snapshot)
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a snapshot object.')
        await request('/api/vault/jobs', { ...input, consent: true })
      } catch (error) { setError(error instanceof Error ? error.message : 'Invalid snapshot JSON.') }
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
      <p>Bounded Linux bash command console, not an interactive PTY. Each command launches independently (no persistent shell directory or variables). Maximum 4000 UTF-8 bytes, 60 seconds of remote execution, and one command in flight. Startup and teardown may extend the overall wait to 210 seconds. Files are ephemeral and the container is destroyed after each run.</p>
      <p>A failed or timed-out request does not prove the command was canceled. There are no automatic retries. Do not resubmit blindly.</p>
      <p>Commands can delete files and use the network. Network usage may incur costs. Never enter provider credentials, tokens or private data. No app credentials are passed into the sandbox. Commands and output are not uploaded anywhere else by this console.</p>
      <label className="block">Bash command
        <textarea value={command} onChange={event => { setCommand(event.target.value); setConsent(false) }} disabled={busy} rows={5} className="block w-full border border-line rounded p-3 font-mono" spellCheck={false} />
      </label>
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
    <label className="flex gap-2 items-start">
      <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy || !configured} />
      <span>{shell ? 'I approve executing this specific command and its network usage in the ephemeral cloud sandbox.' : 'I approve sending only this selected, share-enabled snapshot and instruction to the cloud vault agent.'}</span>
    </label>
    <button className={button} disabled={busy || !configured || !consent} onClick={submit}>{busy ? 'Waiting…' : shell ? 'Run approved command' : 'Submit approved snapshot'}</button>
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
