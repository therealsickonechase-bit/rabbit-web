'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Manifest, ManifestEntry, Page } from '@/lib/data-hub'
import { curlCommand } from '@/lib/data-hub'
import { Badge, Card } from '@/components/ui'

// Interactive explorer for GET /api/data. Everything it shows comes from the public read-only API on this origin.
type Row = Record<string, unknown>
const SOURCE_TONE: Record<string, 'accent' | 'info' | 'ok' | 'warn' | 'muted'> = { pubmed: 'accent', trial: 'info', fda: 'warn', stjude: 'ok' }
const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}...` : s)

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState<boolean | null>(null)
  return (
    <button type="button" className="rounded border border-line px-2 py-1 text-xs hover:bg-canvas"
      onClick={async () => { setDone(await copy(text)); setTimeout(() => setDone(null), 1500) }}>
      {done === null ? label : done ? 'Copied' : 'Copy failed'}
    </button>
  )
}

function LedgerHead() {
  const [head, setHead] = useState<{ length: number; headHash: string; updatedAt: string | null } | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading')
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (document.hidden) return
      try {
        const r = await fetch('/api/chain/head', { cache: 'no-store' })
        if (!r.ok) throw new Error('bad')
        const j = await r.json()
        if (live) { setHead(j); setState('ok') }
      } catch { if (live) setState('down') }
    }
    const loop = () => { timer = setTimeout(async () => { await tick(); if (live) loop() }, 15_000) }
    const onVis = () => { if (!document.hidden) tick() }
    tick(); loop()
    document.addEventListener('visibilitychange', onVis)
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return (
    <div className="bg-surface border border-line rounded-lg p-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Ledger head (refreshes every 15 s while this tab is visible)</p>
        <Link href="/ledger" className="text-xs text-info hover:underline">Open the public ledger</Link>
      </div>
      {state === 'down' && !head && <p className="text-sm text-bad mt-2">The ledger head could not be read right now.</p>}
      {state === 'loading' && <p className="text-sm text-muted mt-2">Loading...</p>}
      {head && (
        <p className="mt-2 text-sm"><span className="font-semibold">{head.length}</span> events
          <span className="font-mono text-xs text-muted break-all"> {head.headHash}</span></p>
      )}
    </div>
  )
}

export default function DataExplorer({ origin, initial }: { origin: string; initial: Manifest | null }) {
  const [manifest, setManifest] = useState<Manifest | null>(initial)
  const [id, setId] = useState('research_records')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [sort, setSort] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [stack, setStack] = useState<string[]>([])           // cursors of the pages before this one
  const [cursor, setCursor] = useState('')
  const [page, setPage] = useState<Page | null>(null)
  const [limit, setLimit] = useState(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [view, setView] = useState<'table' | 'research'>('table')
  const [shell, setShell] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (manifest) return
    fetch('/api/data').then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad')))).then(setManifest).catch(() => setError('The data hub manifest could not be read.'))
  }, [manifest])

  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t) }, [q])

  const entry: ManifestEntry | undefined = manifest?.datasets.find((d) => d.id === id)

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit) })
    if (dq) p.set('q', dq)
    if (sort) p.set('sort', sort)
    if (cursor) p.set('cursor', cursor)
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v)
    return p
  }, [limit, dq, sort, cursor, filters])

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true); setError('')
    try {
      const r = await fetch(`/api/data/${id}?${params}`)
      const body = await r.json().catch(() => null)
      if (mine !== seq.current) return
      if (!r.ok) { setError(body?.error ?? `The server answered ${r.status}.`); setPage(null) } else { setPage(body as Page); setOpen(new Set()) }
    } catch {
      if (mine === seq.current) { setError('The data hub could not be reached. Check your connection and try again.'); setPage(null) }
    } finally { if (mine === seq.current) setLoading(false) }
  }, [id, params])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const reset = () => { setCursor(''); setStack([]) }
  const pick = (next: string) => { setId(next); setQ(''); setDq(''); setSort(''); setFilters({}); reset(); setView(next === 'research_records' ? 'research' : 'table') }
  const link = (format: 'json' | 'csv' | 'ndjson') => {
    const p = new URLSearchParams(params); p.set('format', format); p.set('download', '1')
    return `/api/data/${id}?${p}`
  }
  const toggleSort = (c: string) => {
    if (!entry?.sortable.includes(c)) return
    setSort((s) => (s === c ? `-${c}` : c)); reset()
  }
  const sortMark = (c: string) => (sort === c ? ' ^' : sort === `-${c}` ? ' v' : '')
  const cols = page?.columns ?? entry?.columns ?? []
  const rows = (page?.rows ?? []) as Row[]
  const askHref = (r: Row) => `/ask?q=${encodeURIComponent(`What does the research say about: ${cell(r.title)}`.slice(0, 300))}`

  return (
    <div className="space-y-6">
      <LedgerHead />

      <section aria-label="Datasets" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(manifest?.datasets ?? []).map((d) => (
          <button key={d.id} type="button" onClick={() => pick(d.id)} aria-pressed={d.id === id}
            className={`text-left rounded-lg border p-3 hover:bg-canvas ${d.id === id ? 'border-accent bg-canvas' : 'border-line bg-surface'}`}>
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{d.title}</span>
              <Badge tone={d.rows ? 'accent' : 'muted'}>{d.rows === null ? '?' : d.rows}</Badge>
            </span>
            <span className="block text-xs text-muted mt-1">{d.description}</span>
          </button>
        ))}
        {!manifest && !error && <p className="text-sm text-muted">Loading datasets...</p>}
      </section>

      <Card title={entry?.title ?? id}
        action={<div className="flex flex-wrap gap-2">
          {id === 'research_records' && (
            <button type="button" className="rounded border border-line px-2 py-1 text-xs hover:bg-canvas" onClick={() => setView(view === 'table' ? 'research' : 'table')}>
              {view === 'table' ? 'Research view' : 'Table view'}
            </button>)}
          <button type="button" className="rounded border border-line px-2 py-1 text-xs hover:bg-canvas" onClick={() => setShell((s) => !s)} aria-expanded={shell}>Open in CloudShell</button>
        </div>}>
        <div className="space-y-4">
          {shell && (
            <div className="rounded-md border border-line bg-canvas p-3 space-y-2">
              <p className="text-xs text-muted">In the public CloudShell, set the origin once, then run the command. The sandbox may read this API (GET only).</p>
              <div className="flex flex-wrap items-center gap-2"><code className="font-mono text-xs break-all">export ORIGIN={origin}</code><CopyButton text={`export ORIGIN=${origin}`} /></div>
              <div className="flex flex-wrap items-center gap-2"><code className="font-mono text-xs break-all">{curlCommand(id)}</code><CopyButton text={curlCommand(id)} /></div>
              <Link href="/cloudshell-public" className="text-xs text-info hover:underline">Open CloudShell</Link>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">Search
              <input value={q} onChange={(e) => { setQ(e.target.value); reset() }} maxLength={80} disabled={!entry?.searchable.length}
                placeholder={entry?.searchable.length ? entry.searchable.join(', ') : 'not searchable'}
                className="block mt-1 w-56 rounded-md border border-line bg-canvas px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">Sort
              <select value={sort.replace(/^-/, '')} onChange={(e) => { setSort(e.target.value); reset() }} className="block mt-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm">
                <option value="">default</option>
                {(entry?.sortable ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button type="button" className="rounded border border-line px-2 py-1 text-xs hover:bg-canvas"
              onClick={() => { const c = sort.replace(/^-/, ''); if (c) { setSort(sort.startsWith('-') ? c : `-${c}`); reset() } }} disabled={!sort}>
              {sort.startsWith('-') ? 'Descending' : 'Ascending'}
            </button>
            {(entry?.filterable ?? []).slice(0, 3).map((c) => (
              <label key={c} className="text-xs">{c}
                <input value={filters[c] ?? ''} onChange={(e) => { setFilters((f) => ({ ...f, [c]: e.target.value.trim() })); reset() }} maxLength={120}
                  placeholder="exact match" className="block mt-1 w-32 rounded-md border border-line bg-canvas px-2 py-1 text-sm" />
              </label>
            ))}
            <label className="text-xs">Rows
              <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); reset() }} className="block mt-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm">
                {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          {error && <p role="alert" className="text-sm text-bad border border-bad/40 rounded-md px-3 py-2">{error} <button type="button" className="underline" onClick={load}>Retry</button></p>}
          {loading && <p className="text-xs text-muted" role="status">Loading...</p>}

          {view === 'research' && id === 'research_records' ? (
            <ul className="space-y-3">
              {rows.map((r, i) => (
                <li key={i} className="border-b border-line pb-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SOURCE_TONE[String(r.source)] ?? 'muted'}>{cell(r.source)}</Badge>
                    {typeof r.url === 'string' && /^https?:\/\//.test(r.url)
                      ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm text-info hover:underline">{cell(r.title)}</a>
                      : <span className="text-sm">{cell(r.title)}</span>}
                  </div>
                  <p className="text-xs text-muted mt-1 font-mono">{cell(r.id)} · {cell(r.first_seen_at)}</p>
                  <div className="flex gap-3 mt-1 text-xs">
                    <Link href={askHref(r)} className="text-accent hover:underline">Ask RabbitOS about this</Link>
                    <button type="button" className="underline" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}>{open.has(i) ? 'Hide JSON' : 'Show JSON'}</button>
                  </div>
                  {open.has(i) && <pre className="mt-2 max-h-72 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(r, null, 2)}</pre>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted border-b border-line">
                  <th className="py-1 pr-2 w-8"><span className="sr-only">Expand</span></th>
                  {cols.map((c) => (
                    <th key={c} className="py-1 pr-3 font-medium whitespace-nowrap">
                      {entry?.sortable.includes(c) ? <button type="button" onClick={() => toggleSort(c)} className="hover:underline">{c}{sortMark(c)}</button> : c}
                    </th>))}
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <FragmentRow key={i} cols={cols} row={r} open={open.has(i)}
                      toggle={() => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })} />
                  ))}
                  {!rows.length && !loading && <tr><td colSpan={cols.length + 1} className="py-4 text-sm text-muted">{error ? '' : 'No rows for this search.'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2 items-center">
              <button type="button" disabled={!stack.length || loading} className="rounded border border-line px-3 py-1 text-xs disabled:opacity-40"
                onClick={() => { const prev = stack[stack.length - 1]; setStack(stack.slice(0, -1)); setCursor(prev) }}>Previous</button>
              <button type="button" disabled={!page?.nextCursor || loading} className="rounded border border-line px-3 py-1 text-xs disabled:opacity-40"
                onClick={() => { if (page?.nextCursor) { setStack([...stack, cursor]); setCursor(page.nextCursor) } }}>Next</button>
              <span className="text-xs text-muted">page {stack.length + 1}{page ? `, ${page.count} rows` : ''}</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <CopyButton text={JSON.stringify(rows, null, 2)} label="Copy JSON" />
              <a className="rounded border border-line px-2 py-1 text-xs hover:bg-canvas" href={link('json')}>Download JSON</a>
              <a className="rounded border border-line px-2 py-1 text-xs hover:bg-canvas" href={link('csv')}>Download CSV</a>
              <a className="rounded border border-line px-2 py-1 text-xs hover:bg-canvas" href={link('ndjson')}>NDJSON</a>
            </div>
          </div>
          <p className="text-xs text-muted">Downloads are this page of results. Page through with the cursor, or use the API from CloudShell for more.</p>
        </div>
      </Card>
    </div>
  )
}

function FragmentRow({ cols, row, open, toggle }: { cols: string[]; row: Row; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr className="border-b border-line align-top">
        <td className="py-1 pr-2"><button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? 'Collapse row' : 'Expand row'} className="text-xs text-muted">{open ? '-' : '+'}</button></td>
        {cols.map((c) => <td key={c} className="py-1 pr-3 max-w-xs break-words text-xs sm:text-sm">{clip(cell(row[c]))}</td>)}
      </tr>
      {open && <tr><td /><td colSpan={cols.length}><pre className="max-h-72 overflow-auto rounded bg-canvas p-2 text-xs">{JSON.stringify(row, null, 2)}</pre></td></tr>}
    </>
  )
}
