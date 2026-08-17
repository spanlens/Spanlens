'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/components/providers/theme-provider'
import {
  Sun, Moon, Monitor, X, MessageSquarePlus, LogOut, ChevronDown,
  LayoutDashboard, ArrowLeftRight, Waypoints, Users, Activity, ShieldCheck,
  PiggyBank, FileText, ClipboardCheck, Database, FlaskConical, Bell,
  Highlighter, KeyRound, Settings, BookOpen,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/lib/sidebar-context'

/* ── Logo ── */
function LogoMark() {
  return (
    <Link
      href="/"
      aria-label="Spanlens home"
      className="flex items-center gap-2 pl-1.5 hover:opacity-80 transition-opacity"
    >
      <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-md" priority />
      <span className="font-display text-[15px] tracking-[-0.02em] text-text">spanlens</span>
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
        className="w-full h-9 flex items-center gap-2 px-[10px] rounded-md border border-border bg-bg-elev hover:border-border-strong transition-colors"
      >
        <span
          aria-hidden="true"
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-chip bg-text text-[10px] font-semibold text-bg"
        >
          A
        </span>
        <span className="truncate text-[13px] font-medium text-text">Acme Corp</span>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] px-[5px] py-[2px] rounded-full bg-accent-bg text-accent">demo</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-faint ml-auto" aria-hidden="true" />
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
type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  badge?: string
  badgeWarn?: boolean
  badgeGood?: boolean
}

const DEMO_NAV: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: '/demo/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/demo/requests', label: 'Requests', icon: ArrowLeftRight, badge: '2.4k' },
      { href: '/demo/traces', label: 'Traces', icon: Waypoints },
      { href: '/demo/users', label: 'Users', icon: Users, badge: '4' },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/demo/anomalies', label: 'Anomalies', icon: Activity, badge: '2', badgeWarn: true },
      { href: '/demo/security', label: 'Security', icon: ShieldCheck },
      { href: '/demo/savings', label: 'Savings', icon: PiggyBank, badge: '$412', badgeGood: true },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/demo/prompts', label: 'Prompts', icon: FileText },
      { href: '/demo/evals', label: 'Evals', icon: ClipboardCheck, badge: '4' },
      { href: '/demo/datasets', label: 'Datasets', icon: Database, badge: '3' },
      { href: '/demo/experiments', label: 'Experiments', icon: FlaskConical },
      { href: '/demo/alerts', label: 'Alerts', icon: Bell, badge: '1', badgeWarn: true },
    ],
  },
  {
    label: 'Review',
    items: [{ href: '/demo/annotation', label: 'Annotation', icon: Highlighter, badge: '2', badgeWarn: true }],
  },
  {
    label: 'Admin',
    items: [
      { href: '/demo/projects', label: 'Projects & Keys', icon: KeyRound },
      { href: '/demo/settings', label: 'Settings', icon: Settings },
      { href: '/docs', label: 'Docs', icon: BookOpen },
    ],
  },
]

/* ── Theme toggle (mirrors the live sidebar's segmented pill) ── */
type ThemeOption = 'system' | 'light' | 'dark'

const THEME_OPTIONS: { value: ThemeOption; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
  { value: 'system', label: 'Match system theme', Icon: Monitor },
]

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme()
  const current = (theme ?? 'system') as ThemeOption

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-[2px] rounded-full bg-bg-chip p-[3px]"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const selected = current === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full transition-colors',
              selected ? 'bg-bg-elev text-text shadow-card' : 'text-text-faint hover:text-text-muted',
            )}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
          </button>
        )
      })}
    </div>
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
      <div className="px-[14px] pt-4 pb-3.5">
        <LogoMark />
      </div>

      {/* Workspace switcher */}
      <div className="mx-[14px] mb-3.5">
        <DemoWorkspaceSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-[14px] space-y-0">
        {DEMO_NAV.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint px-[10px] pt-4 pb-2">
                {group.label}
              </div>
            )}
            {group.items.map(({ href, label, icon: Icon, badge, badgeWarn, badgeGood }) => {
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
                    'flex items-center justify-between gap-[10px] pl-[10px] pr-2 py-[6px] rounded text-[13px] leading-[18px] border transition-colors',
                    active
                      ? 'bg-bg-elev text-text font-semibold border-border'
                      : 'text-text-muted border-transparent hover:bg-bg-muted/60 hover:text-text',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-[10px]">
                    <Icon
                      aria-hidden="true"
                      className={cn('h-[13px] w-[13px] shrink-0', active ? 'text-text' : 'text-text-faint')}
                    />
                    <span className="truncate">{label}</span>
                  </span>
                  {badge && (
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[11px] leading-[15px] px-[7px] py-[2px] rounded-full',
                        badgeWarn
                          ? 'bg-accent-bg text-bad'
                          : badgeGood
                            ? 'bg-good-bg text-good'
                            : 'bg-bg-chip text-text-faint',
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
      <div className="mx-[14px] mb-2.5 mt-2 p-3 rounded-lg border border-border bg-bg-elev">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-text">Free</span>
          <span className="font-mono text-[11.5px] text-text-faint">2.4k / 50k</span>
        </div>
        <div className="mt-2 h-[5px] rounded-full bg-track overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: '4.8%' }} />
        </div>
        <Link
          href="/demo/billing"
          className="mt-2.5 inline-block text-[12px] font-medium text-accent hover:text-accent-strong transition-colors"
        >
          Upgrade →
        </Link>
      </div>

      {/* Footer strip: Feedback, sign out, theme (mirrors the live sidebar) */}
      <div className="flex items-center gap-2 px-[14px] pb-[14px] pl-[18px]">
        <Link
          href="/demo/feedback"
          prefetch={false}
          className={cn(
            'inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors',
            pathname === '/demo/feedback' || pathname.startsWith('/demo/feedback/')
              ? 'text-text'
              : 'text-text-faint hover:text-text',
          )}
        >
          <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Feedback</span>
        </Link>
        <div className="flex-1" />
        <button
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-chip hover:text-text transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <ThemeToggleButton />
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
          // Band surface, matching the live sidebar. Keep these two in sync.
          'flex flex-col bg-bg-muted border-r border-border',
          // Mobile: fixed overlay drawer. `inset-y-0` already pins to the full
          // viewport height — no `h-screen` needed.
          'fixed inset-y-0 left-0 z-50 w-[272px]',
          'transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:w-[232px] md:shrink-0 md:translate-x-0 md:transition-none',
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
