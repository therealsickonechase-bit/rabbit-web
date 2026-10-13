'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import BrainExplorer from '@/components/BrainExplorer'
import GuideEditor from '@/components/GuideEditor'
import { WORKSPACE_SECTIONS, type WorkspaceSection } from '@/lib/account-free'
import { QWEN_ENDPOINT } from '@/lib/qwen'
import { emptyWorkspace, feedSchema, publicLink, readWorkspace, researchContext, WORKSPACE_STORAGE_KEY, type LocalWorkspace, type PublicFeed } from '@/lib/workspace'

const LABELS: Record<WorkspaceSection, string> = {
  dashboard: 'Overview', research: 'Research', ask: 'Ask RabbitOS', brain: 'Brain & Body',
  twin: 'Twin model', connections: 'Connections', memory: 'Memory & Files', collections: 'Collections',
  tasks: 'Local tasks', settings: 'Settings', chain: 'Public proof', agents: 'Agents', crispr: 'CRISPR Explorer',
}
const field = 'w-full rounded border border-line bg-canvas px-3 py-2 text-sm'
const button = 'rounded border border-line px-3 py-2 text-sm disabled:opacity-50'

export default function PublicWorkspace({ section }: { section: WorkspaceSection }) {
  const [local, setLocal] = useState<LocalWorkspace>(emptyWorkspace)
  const [loaded, setLoaded] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [feed, setFeed] = useState<PublicFeed | null>(null)
  const [feedError, setFeedError] = useState('')
  const [question, setQuestion] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setLocal(readWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)))
        setLoaded(true)
      } catch {
        setStorageError('The browser workspace could not be loaded. Storage may be blocked or saved data invalid. Export or clear it in Settings; it has not been overwritten.')
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(local)) }
    catch { setTimeout(() => setStorageError('Browser storage failed. New changes remain in this tab only; export them before closing.'), 0) }
  }, [local, loaded])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch('/api/public/research-feed', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setFeed(feedSchema.parse(await response.json()))
      } catch {
        if (!controller.signal.aborted) setFeedError('The public research feed is unavailable. Local tools still work; reload to retry.')
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  async function ask() {
    if (busy || !consent || !question.trim()) return
    const text = question.trim()
    setBusy(true); setConsent(false); setChatError('')
    const history = local.messages.slice(-6)
    setLocal((previous) => ({ ...previous, messages: [...previous.messages, { role: 'user' as const, text }].slice(-100) }))
    setQuestion('')
    try {
      const context = researchContext(feed, text)
      const response = await fetch(QWEN_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are RabbitOS, a research and education assistant. Not medical advice. Never invent sources. Use the supplied public record titles as pointers, not full papers. Clearly distinguish general knowledge from these records. No private account data is available.' },
            ...history.map((entry) => ({ role: entry.role, content: entry.text.slice(0, 2000) })),
            { role: 'user', content: `${context ? `Recent public research pointers:\n${context}\n\n` : ''}${text}` },
          ],
          max_tokens: 700, temperature: 0.2,
        }),
      })
      const data: { error?: string; choices?: { message?: { content?: string } }[] } = await response.json()
      if (!response.ok) throw new Error(data.error || `Hosted Qwen returned HTTP ${response.status}.`)
      const answer = data.choices?.[0]?.message?.content
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Hosted Qwen returned no answer.')
      setLocal((previous) => ({ ...previous, messages: [...previous.messages, { role: 'assistant' as const, text: answer.slice(0, 12000) }].slice(-100) }))
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Hosted Qwen could not answer. No other provider was contacted.')
    } finally { setBusy(false) }
  }

  const kind = section === 'tasks' ? 'task' : section === 'collections' ? 'collection' : 'note'
  function addItem() {
    if (!draft.trim()) return
    if (local.items.length >= 100) { setStorageError('The workspace has 100 items. Remove or export some before adding more.'); return }
    setLocal((previous) => ({ ...previous, items: [...previous.items, { id: crypto.randomUUID(), text: draft.trim(), kind, done: false }] }))
    setDraft('')
  }
  function exportWorkspace() {
    let contents = JSON.stringify(local, null, 2)
    try { if (!loaded) contents = localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? contents }
    catch { setStorageError('Saved browser data cannot be read. Exporting the current tab instead.') }
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'rabbitos-workspace.json'; anchor.click()
    URL.revokeObjectURL(url)
  }
  function clearWorkspace() {
    if (!window.confirm('Clear chats, notes and settings in this browser? Existing server account data is not changed.')) return
    try {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY)
      localStorage.removeItem('rabbitos.local-summary.v1')
      setLocal(emptyWorkspace()); setLoaded(true); setStorageError('')
    } catch { setStorageError('Browser storage cannot be cleared. Check browser permissions.') }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="bg-surface border-r border-line p-4">
        <Link href="/dashboard" className="text-lg font-semibold">RabbitOS</Link>
        <p className="text-xs text-muted mt-1">Account-free workspace</p>
        <nav aria-label="Workspace" className="flex flex-wrap md:flex-col gap-2 mt-5">
          {WORKSPACE_SECTIONS.map((key) => <Link key={key} href={`/${key}`} aria-current={key === section ? 'page' : undefined} className={`text-sm rounded px-2 py-1 ${key === section ? 'bg-accent-soft text-accent' : 'text-muted'}`}>{LABELS[key]}</Link>)}
          <Link href="/downloads" className="text-sm px-2 py-1">Downloads</Link>
          <Link href="/guide" className="text-sm px-2 py-1">Guide</Link>
          <Link href="/cloudshell" className="text-sm px-2 py-1">Owner cloud tools</Link>
        </nav>
      </aside>
      <main className="min-w-0 p-4 sm:p-6 space-y-5">
        <header>
          <p className="text-xs text-muted">{loaded ? local.name : 'Browser workspace'}</p>
          <h1 className="text-2xl font-semibold">{LABELS[section]}</h1>
          <p className="text-sm text-muted mt-2">No account, email or CAPTCHA. Chats, notes and settings stay in this browser. Hosted AI receives only what you approve. Existing private account data is not accessible.</p>
        </header>
        {storageError && <p role="alert" className="text-sm text-bad">{storageError}</p>}
        {feedError && <p role="alert" className="text-sm text-warn">{feedError}</p>}
        {section === 'dashboard' && <section className="space-y-3 text-sm">
          <h2 className="font-semibold">Get started</h2>
          <p><Link href="/ask" className="text-accent underline">Chat with hosted Qwen</Link>, <Link href="/brain" className="text-accent underline">explore the brain and walking avatar</Link>, or <Link href="/research" className="text-accent underline">browse public research</Link>.</p>
          <p>Local models and device bridges are opt-in. No device or file is connected automatically. This is research and education, not medical advice.</p>
          <p>Saved account chats, personal twin readings, API keys and owner controls are retired from this public workspace, not made public. Local tasks are a checklist, not remote agent jobs.</p>
        </section>}
        {['brain', 'twin', 'connections'].includes(section) && <BrainExplorer initial={[]} graph={{ mentions: {}, records: {}, edges: [] }} chemicals={[]} storedEeg={false} />}
        {section === 'ask' && <section className="space-y-3 max-w-3xl">
          <p className="text-xs text-muted">Cloudflare-hosted Qwen3. Uses up to four titles from the latest public research feed, not the full private corpus. Shared gateway quotas apply. No personal API key needed.</p>
          <div className="space-y-3" aria-live="polite">{local.messages.map((entry, index) => <article key={index} className="rounded border border-line p-3 whitespace-pre-wrap text-sm"><strong>{entry.role === 'user' ? 'You' : 'Qwen'}</strong><p>{entry.text}</p></article>)}</div>
          {chatError && <p role="alert" className="text-bad text-sm">{chatError}</p>}
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void ask() }}>
            <textarea aria-label="Question" className={field} maxLength={4000} value={question} disabled={busy} onChange={(event) => { setQuestion(event.target.value); setConsent(false) }} placeholder="Ask a research question..." />
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />Send this question, recent chat and public record titles to Cloudflare-hosted Qwen. Do not include private health data.</label>
            <button className={button} disabled={busy || !consent || !question.trim()}>{busy ? 'Asking Qwen...' : 'Ask Qwen'}</button>
          </form>
        </section>}
        {section === 'research' && <section className="space-y-3">
          <p className="text-sm text-muted">The latest 20 already-public literature titles. Private records and account notes are excluded.</p>
          {!feed && !feedError && <p role="status">Loading public research...</p>}
          {feed?.recent.map((record) => <article key={record.id} className="border border-line rounded p-3"><h2 className="font-medium">{record.title}</h2><p className="text-xs text-muted">{record.source}</p>{publicLink(record.url) && <a href={publicLink(record.url)!} target="_blank" rel="noopener noreferrer" className="text-accent text-sm underline">Read public source</a>}</article>)}
        </section>}
        {['memory', 'collections', 'tasks'].includes(section) && <section className="space-y-3 max-w-3xl">
          <p className="text-xs text-muted">Browser-local only. These items do not sync to GitHub, another device or a remote agent.</p>
          <form onSubmit={(event) => { event.preventDefault(); addItem() }} className="flex gap-2">
            <textarea aria-label="New item" disabled={!loaded} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} className={field} />
            <button className={button} disabled={!draft.trim() || !loaded}>Add</button>
          </form>
          {local.items.filter((item) => item.kind === kind).map((item) => <article key={item.id} className="rounded border border-line p-3 flex gap-3">
            {kind === 'task' && <input type="checkbox" aria-label="Complete task" checked={item.done} onChange={() => setLocal((previous) => ({ ...previous, items: previous.items.map((value) => value.id === item.id ? { ...value, done: !value.done } : value) }))} />}
            <p className="flex-1 whitespace-pre-wrap text-sm">{item.text}</p>
            <button className={button} onClick={() => setLocal((previous) => ({ ...previous, items: previous.items.filter((value) => value.id !== item.id) }))}>Remove</button>
          </article>)}
          {section === 'memory' && <>
            <label className="block text-sm">View a local text file (up to 1 MB; not uploaded)
              <input type="file" accept=".txt,.md,.json,.csv,.py,.js,.ts" className="block mt-2" onChange={async (event) => {
                const selected = event.target.files?.[0]
                if (!selected) return
                if (selected.size > 1000000) { setStorageError('Choose a text file no larger than 1 MB.'); return }
                try { setFile({ name: selected.name, text: await selected.text() }) }
                catch { setStorageError('The selected file could not be read.') }
              }} />
            </label>
            {file && <article><h2>{file.name}</h2><pre className="text-xs whitespace-pre-wrap break-all border border-line p-3 max-h-96 overflow-auto">{file.text}</pre><button className={button} onClick={() => setFile(null)}>Close file</button></article>}
          </>}
        </section>}
        {section === 'settings' && <section className="space-y-3 max-w-xl">
          <label className="block text-sm">Workspace name<input className={field} maxLength={80} disabled={!loaded} value={local.name} onChange={(event) => setLocal((previous) => ({ ...previous, name: event.target.value }))} /></label>
          <p className="text-xs text-muted">Browser storage is not encrypted and can be read by someone using this browser profile. Clearing browser data removes it. Export before switching browsers. No cloud account or API keys are used.</p>
          <button className={button} onClick={exportWorkspace}>Export workspace</button>{' '}
          <button className={button} onClick={clearWorkspace}>Clear browser workspace</button>
        </section>}
        {section === 'chain' && <section className="space-y-3 text-sm">
          <p>Only the already-public audit head is shown. Private audit entries and owner sealing controls are unavailable.</p>
          {feed && <dl><dt>Public head sequence</dt><dd>{feed.chain.audit_head_seq ?? 'Not published'}</dd><dt>Hash</dt><dd className="font-mono break-all">{feed.chain.audit_head_hash ?? 'Not published'}</dd></dl>}
        </section>}
        {section === 'agents' && <p className="text-sm">Remote agent credentials and account task execution are not available in the account-free workspace. Existing machine-to-machine integrations still require their own signed credentials. Use Local tasks for a browser-only checklist.</p>}
        {section === 'crispr' && <section className="space-y-3 text-sm"><p>Educational text-only editor. Private guide records are not loaded; no candidates are available in this workspace. No lab procedures or medical guidance.</p><GuideEditor guides={[]} /></section>}
      </main>
    </div>
  )
}
