'use client'

import { useEffect, useState } from 'react'
import { STATUS_LABEL, ageText, judge, merge, summary, type ConnStatus } from '@/lib/connections'
import { useConnectionReport, useConnectionReports } from '@/components/ConnectionsContext'

// One list of everything that feeds this page: where each source runs, whether it is live, what the page uses it for, what (if anything) leaves your computer
// because of it, and how to start it. The numbers update about once a second.

const TONE: Record<ConnStatus, string> = {
  live: 'text-ok border-ok/40', idle: 'text-info border-info/40', connecting: 'text-warn border-warn/40', stale: 'text-warn border-warn/40', error: 'text-bad border-bad/40', off: 'text-muted border-line',
}

export default function ConnectionsPanel() {
  const { reports } = useConnectionReports()
  const [now, setNow] = useState(0)
  const [server, setServer] = useState<{ ok: boolean; ms: number | null; at: number } | null>(null)

  // the RabbitOS server is the one source this panel checks itself
  useEffect(() => {
    let stop = false
    const check = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' })
        const j = (await r.json()) as { status?: string; database_ms?: number }
        if (!stop) setServer({ ok: r.ok && j.status === 'ok', ms: typeof j.database_ms === 'number' ? j.database_ms : null, at: Date.now() })
      } catch { if (!stop) setServer({ ok: false, ms: null, at: Date.now() }) }
    }
    const first = setTimeout(check, 0), id = setInterval(check, 30_000)
    return () => { stop = true; clearTimeout(first); clearInterval(id) }
  }, [])
  useConnectionReport('server', { status: server ? (server.ok ? 'live' : 'error') : 'connecting', detail: server ? (server.ok ? `healthy${server.ms !== null ? `, database ${server.ms} ms` : ''}` : 'not answering') : 'checking…', lastAt: server?.at ?? null })

  useConnectionReport('supabase', { status: server ? (server.ok && server.ms !== null ? 'live' : server.ok ? 'idle' : 'error') : 'connecting', detail: server ? (server.ok ? (server.ms !== null ? `database answered in ${server.ms} ms` : 'reachable') : 'database not answering') : 'checking…', lastAt: server?.at ?? null })

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0), id = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [])

  const infos = merge(reports).map((i) => ({ ...i, status: judge(i.status, i.lastAt, now) }))
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Connections: everything that feeds this page</h3>
        <p className="text-xs text-muted">{summary(infos)}</p>
      </div>
      <p className="text-xs text-muted">Local feeds run on this computer and talk to this page over loopback only. Nothing leaves your computer except what the &quot;Leaves your computer&quot; column says.</p>
      <ul className="space-y-2">
        {infos.map((i) => (
          <li key={i.id} className="rounded-md border border-line">
            <details>
              <summary className="cursor-pointer list-none p-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{i.name}</span>
                <span className={`text-xs rounded-full border px-2 py-0.5 ${TONE[i.status]}`} role="status">{STATUS_LABEL[i.status]}</span>
                <span className="text-xs text-muted">{i.lastAt !== null ? `updated ${ageText(i.lastAt, now)}` : 'no data yet'}</span>
                {i.detail && <span className="text-xs text-muted min-w-0 break-words">{i.detail}</span>}
              </summary>
              <dl className="grid sm:grid-cols-[9rem_1fr] gap-x-4 gap-y-2 px-3 pb-3 text-xs">
                <dt className="text-muted">Where it runs</dt><dd>{i.where}</dd>
                <dt className="text-muted">Used for</dt><dd>{i.uses}</dd>
                <dt className="text-muted">Leaves your computer</dt><dd>{i.leaves}</dd>
                <dt className="text-muted">How to start it</dt><dd className="font-mono break-words">{i.start}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}
