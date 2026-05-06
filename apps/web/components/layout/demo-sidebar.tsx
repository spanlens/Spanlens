'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/lib/sidebar-context'

function LogoMark() {
  return (
    <Link href="/" aria-label="Spanlens home" className="flex items-center gap-2 px-1 py-1 hover:opacity-80 transition-opacity">
      <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" priority />
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
    </Link>
  )
}

const DEMO_NAV = [
  {
    label: null,
    items: [
      { href: '/demo/dashboard', label: 'Dashboard', badge: null },
      { href: '/demo/requests',  label: 'Requests',  badge: '2.4k' },
      { href: '/demo/traces',    label: 'Traces',    badge: null },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/demo/anomalies', label: 'Anomalies', badge: '2', badgeWarn: true },
      { href: '/demo/security',  label: 'Security',  badge: null },
      { href: '/demo/savings',   label: 'Savings',   badge: '$412', badgeGood: true },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/demo/prompts', label: 'Prompts', badge: null },
      { href: '/demo/alerts',  label: 'Alerts',  badge: '1', badgeWarn: true },
    ],
  },
]

type ThemeOption = 'system' | 'light' | 'dark'
const THEME_CYCLE: ThemeOption[] = ['system', 'light', 'dark']

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme()
  const current = (theme as ThemeOption) ?? 'system'
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length] ?? 'system'
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Theme: ${current}`}
      className="p-1.5 rounded-[5px] text-text-faint hover:text-text hover:bg-bg-muted transition-colors"
    >
      <Icon className="h-[14px] w-[14px]" />
    </button>
  )
}

function SidebarContent() {
  const pathname = usePathname()
  return (
    <div className="flex flex-col h-full py-3 px-2">
      <div className="px-1 mb-4">
        <LogoMark />
      </div>

      {/* Workspace badge */}
      <div className="mx-1 mb-4 px-[10px] py-[7px] rounded-[5px] border border-border bg-bg-muted">
        <span className="font-mono text-[12px]">
          <span className="text-text-faint">Acme Corp /</span>{' '}
          <span className="text-text">Production</span>
        </span>
        <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.05em] px-[5px] py-[2px] rounded-[3px] bg-accent/10 text-accent border border-accent/20">demo</span>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 space-y-4 overflow-y-auto">
        {DEMO_NAV.map((group) => (
          <div key={group.label ?? 'root'}>
            {group.label && (
              <div className="px-2 mb-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== '/demo/dashboard' && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center justify-between px-[10px] py-[6px] rounded-[5px] text-[13px] transition-colors',
                      active ? 'bg-bg-elev text-text font-medium' : 'text-text-muted hover:bg-bg-elev hover:text-text',
                    )}
                  >
                    <span>{item.label}</span>
                    {item.badge && (
                      <span className={cn(
                        'font-mono text-[10px] px-[6px] py-[1px] rounded-[3px]',
                        (item as { badgeWarn?: boolean }).badgeWarn
                          ? 'bg-accent/10 text-accent'
                          : (item as { badgeGood?: boolean }).badgeGood
                            ? 'bg-good/10 text-good'
                            : 'bg-bg-muted text-text-faint',
                      )}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-2 pt-3 border-t border-border mx-1 flex items-center justify-between">
        <Link
          href="/signup"
          className="font-mono text-[11.5px] px-3 py-[5px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity"
        >
          Sign up free
        </Link>
        <ThemeToggleButton />
      </div>
    </div>
  )
}

export function DemoSidebar() {
  const { isOpen, close } = useSidebar()
  return (
    <>
      {/* Desktop */}
      <aside className="hidden md:flex w-[210px] shrink-0 flex-col border-r border-border bg-bg h-screen overflow-hidden">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <aside className="relative z-10 w-[240px] h-full bg-bg border-r border-border flex flex-col overflow-hidden">
            <button
              type="button"
              onClick={close}
              className="absolute top-3 right-3 p-1.5 text-text-muted hover:text-text transition-colors"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  )
}
