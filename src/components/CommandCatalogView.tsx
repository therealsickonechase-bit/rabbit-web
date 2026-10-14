'use client'
import Link from 'next/link'

import { useMemo, useState } from 'react'
import { PROJECTS, RISK_TEXT, groupCatalog, runsIn, searchCatalog, type CatalogEntry } from '@/lib/command-catalog'

// Read-only list of the catalog. Copy puts text on your clipboard; nothing here runs a command.
export default function CommandCatalogView({ entries }: { entries: CatalogEntry[] }) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState('')
  const [note, setNote] = useState('')
  const groups = useMemo(() => groupCatalog(searchCatalog(entries, query)), [entries, query])
  const shown = groups.reduce((n, g) => n + g.entries.length, 0)

  async function copy(e: CatalogEntry) {
    try { await navigator.clipboard.writeText(e.command); setCopied(e.id); setNote(''); setTimeout(() => setCopied(''), 1500) }
    catch { setNote('Clipboard unavailable; select the command text instead.') }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line bg-surface p-4 text-sm text-muted space-y-1" role="note">
        <p><strong className="text-fg">Public</strong> commands need no secret and write nothing remote. They can be typed into the <Link className="underline" href="/cloudshell-public">public CloudShell</Link> from its Commands drawer (nothing runs until you press Enter).</p>
        <p><strong className="text-fg">Owner</strong> commands deploy, use secrets or the owner&apos;s vault and data, or need a private checkout. They are listed here to read only and run only in the owner CloudShell or on the owner&apos;s own computer. Commands without a <code>cd /workspace</code> prefix are written for the repo root on that computer.</p>
        <p>Placeholders such as <code>&lt;vault-path&gt;</code> must be replaced before running. Environment variables are listed by name only.</p>
      </div>
      <label className="block text-sm">
        <span className="sr-only">Search commands</span>
        <input type="search" value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search commands (for example: test, ledger, vault, crispr)"
          className="w-full rounded-md border border-line bg-surface px-3 py-2" />
      </label>
      <p className="text-xs text-muted" role="status">{shown} of {entries.length} commands. {note}</p>
      {PROJECTS.map((p) => {
        const mine = groups.filter((g) => g.project === p)
        if (!mine.length) return null
        return (
          <section key={p} className="space-y-4" aria-labelledby={`proj-${p}`}>
            <h2 id={`proj-${p}`} className="text-lg font-semibold">{p}</h2>
            {mine.map((g) => (
              <div key={g.group} className="rounded-lg border border-line bg-surface">
                <h3 className="px-4 py-2 border-b border-line text-sm font-semibold">{g.group}</h3>
                <ul className="divide-y divide-line">
                  {g.entries.map((e) => (
                    <li key={e.id} className="p-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{e.label}</span>
                        <span className={`text-xs rounded border px-2 py-0.5 ${e.scope === 'public' ? 'border-ok text-ok' : 'border-warn text-warn'}`}>{e.scope === 'public' ? 'Public' : 'Owner only'}</span>
                        <span className="text-xs rounded border border-line px-2 py-0.5 text-muted" title={RISK_TEXT[e.risk]}>{e.risk}</span>
                        {runsIn(e) === 'computer' && <span className="text-xs text-muted">repo root, on the owner&apos;s computer</span>}
                      </div>
                      <p className="text-sm text-muted">{e.description}</p>
                      <div className="flex items-start gap-2">
                        <pre className="grow whitespace-pre-wrap break-all rounded bg-canvas border border-line px-3 py-2 text-xs font-mono">{e.command}</pre>
                        <button type="button" onClick={() => copy(e)} className="shrink-0 rounded-md border border-line px-3 py-1 text-xs hover:bg-canvas">{copied === e.id ? 'Copied' : 'Copy'}</button>
                      </div>
                      {e.scope === 'owner' && <p className="text-xs text-muted">Runs only in the owner CloudShell (with consent) or on the owner&apos;s computer. Not available here.</p>}
                      {e.needs && e.needs.length > 0 && <p className="text-xs text-muted">Reads environment variables: {e.needs.join(', ')}</p>}
                      <p className="text-xs text-muted">Source: {e.source}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
