import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSessionRole } from '@/lib/auth/session'
import Sidebar from '@/components/Sidebar'
import AutoRefresh from '@/components/AutoRefresh'

async function signOut() {
  'use server'
  const sb = await createClient()
  await sb.auth.signOut()
  redirect('/login')
}

const OWNER_NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/research', label: 'Research' },
  { href: '/ask', label: 'Ask RabbitOS' },
  { href: '/collections', label: 'Collections' },
  { href: '/agents', label: 'Agents' },
  { href: '/chain', label: 'Chain & Audit' },
  { href: '/members', label: 'Members' },
]
const MEMBER_NAV = [
  { href: '/research', label: 'Research' },
  { href: '/ask', label: 'Ask RabbitOS' },
  { href: '/collections', label: 'Collections' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isOwner } = await getSessionRole()

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="bg-surface border-b md:border-b-0 md:border-r border-line md:min-h-screen">
        <div className="px-5 pt-4 md:pt-5 pb-1 md:pb-3">
          <p className="text-lg font-semibold tracking-tight">
            <span className="text-accent">Rabbit</span>OS
          </p>
          <p className="text-xs text-muted">rabbitsoftware.io</p>
        </div>
        <Sidebar items={isOwner ? OWNER_NAV : MEMBER_NAV} />
      </aside>

      <div className="min-w-0">
        <header className="bg-surface border-b border-line px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <AutoRefresh intervalMs={30_000} />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted hidden sm:inline">{user?.email}</span>
            <span className="text-xs rounded border border-line px-2 py-0.5 text-muted">{isOwner ? 'Owner' : 'Member'}</span>
            <Link href="/settings" className="rounded-md border border-line px-3 py-1 text-sm hover:bg-canvas">Settings</Link>
            <form action={signOut}>
              <button className="rounded-md border border-line px-3 py-1 text-sm hover:bg-canvas">Sign out</button>
            </form>
          </div>
        </header>
        <main className="p-4 sm:p-6 max-w-6xl">{children}</main>
      </div>
    </div>
  )
}
