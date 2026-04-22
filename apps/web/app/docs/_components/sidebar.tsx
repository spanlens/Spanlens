'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem {
  title: string
  href: string
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    title: 'Getting started',
    items: [
      { title: 'Overview', href: '/docs' },
      { title: 'Quick start', href: '/docs/quick-start' },
    ],
  },
  {
    title: 'SDK',
    items: [
      { title: '@spanlens/sdk', href: '/docs/sdk' },
    ],
  },
  {
    title: 'API',
    items: [
      { title: 'Direct proxy (any language)', href: '/docs/proxy' },
    ],
  },
  {
    title: 'Self-hosting',
    items: [
      { title: 'Docker', href: '/docs/self-host' },
    ],
  },
]

export function DocsSidebar() {
  const pathname = usePathname()
  return (
    <nav className="space-y-6 text-sm">
      {NAV.map((group) => (
        <div key={group.title}>
          <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-2">
            {group.title}
          </h4>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'block rounded px-2.5 py-1.5 transition-colors',
                      active
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-muted-foreground hover:bg-gray-50 hover:text-foreground',
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
