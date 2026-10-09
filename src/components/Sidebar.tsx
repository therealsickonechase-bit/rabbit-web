'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Sidebar({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname()
  return (
    <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible px-3 md:px-3 py-2 md:py-4">
      {items.map((i) => {
        const active = path === i.href
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm border-l-2 ${
              active
                ? 'bg-accent-soft text-accent border-accent font-medium'
                : 'text-muted border-transparent hover:text-fg hover:bg-canvas'
            }`}
          >
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}
