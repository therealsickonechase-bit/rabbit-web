import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import AutoRefresh from '@/components/AutoRefresh'

// Open access: no login, no roles. Everyone sees the same navigation.
const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/twin', label: 'Twin Atlas' },
  { href: '/brain', label: 'Brain Network' },
  { href: '/connections', label: 'Chemistry & DNA' },
  { href: '/research', label: 'Research' },
  { href: '/ask', label: 'Ask RabbitOS' },
  { href: '/memory', label: 'Memory' },
  { href: '/crispr', label: 'CRISPR Explorer' },
  { href: '/collections', label: 'Collections' },
  { href: '/tasks', label: 'Agent tasks' },
  { href: '/agents', label: 'Agents' },
  { href: '/chain', label: 'Chain & Audit' },
  { href: '/downloads', label: 'Downloads' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="bg-surface border-b md:border-b-0 md:border-r border-line md:min-h-screen">
        <div className="px-5 pt-4 md:pt-5 pb-1 md:pb-3">
          <p className="text-lg font-semibold tracking-tight">
            <span className="text-accent">Rabbit</span>OS
          </p>
          <p className="text-xs text-muted">rabbitsoftware.io</p>
        </div>
        <Sidebar items={NAV} />
      </aside>

      <div className="min-w-0">
        <header className="bg-surface border-b border-line px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <AutoRefresh intervalMs={30_000} />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-xs rounded border border-line px-2 py-0.5 text-muted">Open to everyone</span>
            <Link href="/guide" className="rounded-md border border-line px-3 py-1 text-sm hover:bg-canvas">Guide</Link>
          </div>
        </header>
        <main className="p-4 sm:p-6 max-w-6xl">{children}</main>
      </div>
    </div>
  )
}
