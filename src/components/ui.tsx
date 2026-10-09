import type { ReactNode } from 'react'

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

export function Card({ title, action, children, flush }: { title?: string; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="bg-surface border border-line rounded-lg">
      {title && (
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'ok' | 'warn' | 'bad' | 'info' }) {
  const color = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info' }[tone ?? 'ok'] ?? ''
  const shown = tone ? color : ''
  return (
    <div className="bg-surface border border-line rounded-lg p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-semibold font-mono mt-1 ${shown}`}>{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  )
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'muted' }) {
  const map = {
    ok: 'text-ok border-ok/40',
    warn: 'text-warn border-warn/40',
    bad: 'text-bad border-bad/40',
    info: 'text-info border-info/40',
    accent: 'text-accent border-accent/40',
    muted: 'text-muted border-line',
  }
  return <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded border ${map[tone]}`}>{children}</span>
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode[] | ReactNode; empty: string }) {
  const rows = Array.isArray(children) ? children : [children]
  return rows.length === 0 ? (
    <p className="text-sm text-muted p-6 text-center">{empty}</p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            {head.map((h) => (
              <th key={h} className="font-medium px-4 py-2 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{rows}</tbody>
      </table>
    </div>
  )
}

export const Td = ({ children, mono, className = '' }: { children: ReactNode; mono?: boolean; className?: string }) => (
  <td className={`px-4 py-2 align-top ${mono ? 'font-mono text-xs' : ''} ${className}`}>{children}</td>
)

export function short(s: string | null | undefined, n = 12) {
  if (!s) return '—'
  return s.length > n ? `${s.slice(0, n)}…` : s
}

export function ago(iso: string | null | undefined) {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '—'
}
