'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/lib/sidebar-context'

/* ── Logo ── */
function LogoMark() {
  return (
    <Link
      href="/"
      aria-label="Spanlens home"
      className="flex items-center gap-2 px-1 py-1 hover:opacity-80 transition-opacity"
    >
      <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" priority />
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
    </Link>
  )
}

/* ── Workspace switcher (demo: popover opens with dummy data) ── */
const DEMO_WORKSPACES = [
  { id: 'ws-1', name: 'Acme Corp', role: 'owner', selected: true },
  { id: 'ws-2', name: 'Beta Org', role: 'member', selected: false },
  { id: 'ws-3', name: 'Internal Sandbox', role: 'admin', selected: false },
]

function DemoWorkspaceSwitcher() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-[10px] py-[7px] rounded-[5px] border border-border bg-bg-muted text-[12px] font-mono text-text-muted hover:bg-bg-muted/80 transition-colors"
      >
        <span className="truncate text-text">Acme Corp</span>
        <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.05em] px-[5px] py-[2px] rounded-[3px] bg-accent/10 text-accent border border-accent/20">demo</span>
        <span className="text-text-faint text-[10px] shrink-0 ml-auto pl-2">⌄</span>
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 mt-1 z-20 rounded-[6px] border border-border-strong bg-bg-elev shadow-lg overflow-hidden"
          role="menu"
        >
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint px-[10px] pt-[7px] pb-[3px]">
            Workspaces
          </div>
          {DEMO_WORKSPACES.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setOpen(false)}
              className={cn(
                'w-full text-left px-[10px] py-[6px] text-[12px] font-mono transition-colors flex items-center justify-between',
                w.selected ? 'bg-bg-muted text-text' : 'text-text-muted hover:bg-bg-muted hover:text-text',
              )}
              role="menuitem"
            >
              <span className="truncate">
                {w.name} <span className="text-text-faint">· {w.role}</span>
              </span>
              {w.selected && <span className="text-accent ml-2">✓</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full text-left px-[10px] py-[6px] text-[12px] font-mono text-text-faint hover:bg-bg-muted hover:text-text transition-colors"
            role="menuitem"
          >
            + New workspace
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Nav groups (mirrors live sidebar) ── */
type NavItem = { href: string; label: string; badge?: string; badgeWarn?: boolean; badgeGood?: boolean }

const DEMO_NAV: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: '/demo/dashboard', label: 'Dashboard' },
      { href: '/demo/requests', label: 'Requests', badge: '2.4k' },
      { href: '/demo/traces', label: 'Traces' },
      { href: '/demo/users', label: 'Users', badge: '4' },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/demo/anomalies', label: 'Anomalies', badge: '2', badgeWarn: true },
      { href: '/demo/security', label: 'Security' },
      { href: '/demo/savings', label: 'Savings', badge: '$412', badgeGood: true },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/demo/prompts', label: 'Prompts' },
      { href: '/demo/evals', label: 'Evals', badge: '4' },
      { href: '/demo/datasets', label: 'Datasets', badge: '3' },
      { href: '/demo/experiments', label: 'Experiments' },
      { href: '/demo/alerts', label: 'Alerts', badge: '1', badgeWarn: true },
    ],
  },
  {
    label: 'Review',
    items: [{ href: '/demo/annotation', label: 'Annotation', badge: '2', badgeWarn: true }],
  },
  {
    label: 'Admin',
    items: [
      { href: '/demo/projects', label: 'Projects & Keys' },
      { href: '/demo/settings', label: 'Settings' },
      { href: '/docs', label: 'Docs' },
    ],
  },
]

/* ── Theme toggle (matches live: icon + "Theme · system" label) ── */
type ThemeOption = 'system' | 'light' | 'dark'
const THEME_CYCLE: ThemeOption[] = ['system', 'light', 'dark']

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme()

  function cycleTheme() {
    const current = (theme ?? 'system') as ThemeOption
    const idx = THEME_CYCLE.indexOf(current)
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? 'system'
    setTheme(next)
  }

  const current = (theme ?? 'system') as ThemeOption
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor

  return (
    <button
      onClick={cycleTheme}
      className="flex w-full items-center gap-2 px-[10px] py-[6px] rounded-[5px] text-[13px] text-text-muted hover:bg-bg-muted hover:text-text transition-colors"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>Theme · {current}</span>
    </button>
  )
}

function SidebarContent() {
  const pathname = usePathname()
  const router = useRouter()

  function handleSignOut() {
    // Demo: "sign out" sends them back to the signup landing
    router.push('/signup')
  }

  return (
    <>
      {/* Logo */}
      <div className="px-[18px] pt-[18px] pb-3">
        <LogoMark />
      </div>

      {/* Workspace switcher */}
      <div className="mx-[14px] mb-3">
        <DemoWorkspaceSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-[14px] space-y-0">
        {DEMO_NAV.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint px-[10px] pt-3 pb-1">
                {group.label}
              </div>
            )}
            {group.items.map(({ href, label, badge, badgeWarn, badgeGood }) => {
              const active =
                pathname === href ||
                (href !== '/demo/dashboard' && pathname.startsWith(href + '/')) ||
                (href !== '/demo/dashboard' && pathname.startsWith(href) && pathname !== '/demo/dashboard')
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  className={cn(
                    'flex items-center justify-between px-[10px] py-[6px] rounded-[5px] text-[13px] transition-colors',
                    'border-l-2',
                    active
                      ? 'bg-bg-muted text-text font-medium border-accent'
                      : 'text-text-muted hover:bg-bg-muted hover:text-text border-transparent',
                  )}
                >
                  <span>{label}</span>
                  {badge && (
                    <span
                      className={cn(
                        'font-mono text-[10px] px-[6px] py-[1px] rounded-[3px] border',
                        badgeWarn
                          ? 'bg-accent-bg text-accent border-accent-border'
                          : badgeGood
                            ? 'bg-good/10 text-good border-good/20'
                            : 'bg-bg text-text-faint border-border',
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Plan / usage widget (static demo values) */}
      <div className="mx-[18px] mb-[14px] mt-2 p-3 rounded-md border border-border bg-bg-muted">
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
          Plan · Free
        </div>
        <div className="text-[13px] text-text mb-1.5">2,400 / 50k requests</div>
        <div className="h-1 rounded-full bg-bg overflow-hidden">
          <div className="h-full rounded-full bg-text transition-all" style={{ width: '4.8%' }} />
        </div>
        <Link
          href="/demo/billing"
          className="mt-2.5 inline-block text-[12px] font-medium text-accent hover:opacity-80 transition-opacity"
        >
          Upgrade →
        </Link>
      </div>

      {/* Theme + Sign out */}
      <div className="px-[14px] pb-[14px] space-y-0.5">
        <ThemeToggleButton />
        <button
          onClick={handleSignOut}
          className="flex w-full items-center px-[10px] py-[6px] rounded-[5px] text-[13px] text-text-muted hover:bg-bg-muted hover:text-text transition-colors"
        >
          Sign out
        </button>
      </div>
    </>
  )
}

export function DemoSidebar() {
  const { isOpen, close } = useSidebar()
  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'flex flex-col bg-bg-elev border-r border-border',
          'fixed inset-y-0 left-0 z-50 w-[272px] h-screen',
          'transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:w-56 md:shrink-0 md:translate-x-0 md:transition-none',
        )}
      >
        {/* Mobile close */}
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3.5 md:hidden p-1.5 rounded-[5px] text-text-faint hover:text-text hover:bg-bg-muted transition-colors"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>

        <SidebarContent />
      </aside>
    </>
  )
}
