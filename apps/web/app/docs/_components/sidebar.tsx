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
    title: 'Features',
    items: [
      { title: 'Requests', href: '/docs/features/requests' },
      { title: 'Traces', href: '/docs/features/traces' },
      { title: 'Prompts', href: '/docs/features/prompts' },
      { title: 'Security', href: '/docs/features/security' },
      { title: 'Anomalies', href: '/docs/features/anomalies' },
      { title: 'Alerts', href: '/docs/features/alerts' },
      { title: 'Savings', href: '/docs/features/savings' },
      { title: 'Cost tracking', href: '/docs/features/cost-tracking' },
      { title: 'Billing & quotas', href: '/docs/features/billing' },
      { title: 'Projects & API keys', href: '/docs/features/projects' },
      { title: 'Provider keys', href: '/docs/features/settings' },
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
          <h4 className="font-semibold text-xs uppercase tracking-wide text-text-faint mb-2">
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
                        ? 'bg-accent-bg text-accent font-medium'
                        : 'text-text-muted hover:bg-bg-elev hover:text-text',
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
