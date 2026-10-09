import type { ReactNode } from 'react'

export const authInput =
  'w-full rounded-md bg-canvas border border-line px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

export const button = 'w-full rounded-md bg-accent text-white font-medium py-2 text-sm hover:opacity-90'

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="min-h-screen bg-canvas text-fg flex flex-col items-center justify-center p-4">
      <p className="text-2xl font-semibold tracking-tight mb-1">
        <span className="text-accent">Rabbit</span>OS
      </p>
      <p className="text-sm text-muted mb-6">{title}</p>

      <div className="w-full max-w-sm bg-surface border border-line rounded-lg p-6 space-y-4">
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        {children}
      </div>

      {footer && <div className="text-xs text-muted mt-6 text-center space-y-1">{footer}</div>}
    </main>
  )
}

export function Notice({ tone, children }: { tone: 'ok' | 'bad'; children: ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`text-sm rounded-md border px-3 py-2 ${tone === 'ok' ? 'text-ok border-ok/40' : 'text-bad border-bad/40'}`}>
      {children}
    </p>
  )
}
