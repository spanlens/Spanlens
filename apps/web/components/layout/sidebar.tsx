'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useStatsOverview } from '@/lib/queries/use-stats'
import { useQuota } from '@/lib/queries/use-billing'
import { useSidebar } from '@/lib/sidebar-context'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import { useAlerts } from '@/lib/queries/use-alerts'
import { useRecommendations } from '@/lib/queries/use-recommendations'
import { useIsAdmin } from '@/lib/queries/use-current-role'
import { useOrganization } from '@/lib/queries/use-organization'
import { useProjects } from '@/lib/queries/use-projects'
import { useWorkspaces, useCreateWorkspace } from '@/lib/queries/use-workspaces'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCurrentProjectId, useSetCurrentProjectId } from '@/lib/project-context'
import { writeWorkspaceCookie } from '@/lib/workspace-cookie'

/* ── Logo mark ── */
function LogoMark() {
  return (
    <Link
      href="/"
      aria-label="Spanlens home"
      className="flex items-center gap-2 px-1 py-1 hover:opacity-80 transition-opacity"
    >
      <img src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" />
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">
        spanlens
      </span>
    </Link>
  )
}

/* ── Workspace + project switcher ──
 *
 * One dropdown that exposes two scopes:
 *   - Top section: workspaces the user belongs to (switches `sb-ws` cookie +
 *     reloads so middleware/authJwt pick up the new scope).
 *   - Bottom section: projects within the current workspace (client-side
 *     state — no reload needed).
 *
 * Workspace switch requires a full reload because the server resolves the
 * active org from the cookie for every request, and TanStack caches are
 * keyed by queries that silently assumed org A's data. Reload wipes everything.
 */
function WorkspaceSwitcher() {
  const org = useOrganization()
  const workspaces = useWorkspaces()
  const projects = useProjects()
  const currentProjectId = useCurrentProjectId()
  const setProjectId = useSetCurrentProjectId()
  const createWorkspace = useCreateWorkspace()
  const [open, setOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  function switchWorkspace(id: string) {
    if (id === org.data?.id) { setOpen(false); return }
    writeWorkspaceCookie(id)
    // Full reload so SSR middleware re-resolves the workspace and every
    // TanStack query starts fresh. Avoids stale org A data flashing while
    // org B queries refetch.
    window.location.href = '/dashboard'
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault()
    setNewError('')
    const trimmed = newName.trim()
    if (!trimmed) return
    try {
      const created = await createWorkspace.mutateAsync(trimmed)
      // Switch to the new workspace — cookie + hard reload mirrors the
      // existing switch path so there's exactly one code path for "active
      // workspace changed".
      writeWorkspaceCookie(created.id)
      window.location.href = '/dashboard'
    } catch (err) {
      setNewError(err instanceof Error ? err.message : 'Failed to create workspace')
    }
  }

  const orgName = org.data?.name ?? 'workspace'
  const allProjects = projects.data ?? []
  const allWorkspaces = workspaces.data ?? []

  const current = currentProjectId
    ? allProjects.find((p) => p.id === currentProjectId)
    : null
  const label = current?.name ?? 'All projects'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-[10px] py-[7px] rounded-[5px] border border-border bg-bg-muted text-[12px] font-mono text-text-muted hover:bg-bg-muted/80 transition-colors"
      >
        <span className="truncate">
          <span className="text-text-faint">{orgName} /</span>{' '}
          <span className="text-text">{label}</span>
        </span>
        <span className="text-text-faint text-[10px] shrink-0 ml-2">⌄</span>
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 mt-1 z-20 rounded-[6px] border border-border-strong bg-bg-elev shadow-lg overflow-hidden"
          role="menu"
        >
          {/* Workspaces section: always renders the list — even with a
              single workspace — so the user sees "I am here" instead of an
              empty list with just a "+ New workspace" button (which used to
              read as "my workspace disappeared"). The current workspace
              shows a check mark; switching is a no-op when only one exists. */}
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint px-[10px] pt-[7px] pb-[3px]">
            Workspaces
          </div>
          {allWorkspaces.map((w) => {
            const selected = w.id === org.data?.id
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => switchWorkspace(w.id)}
                className={cn(
                  'w-full text-left px-[10px] py-[6px] text-[12px] font-mono transition-colors flex items-center justify-between',
                  selected ? 'bg-bg-muted text-text' : 'text-text-muted hover:bg-bg-muted hover:text-text',
                )}
                role="menuitem"
              >
                <span className="truncate">
                  {w.name}{' '}
                  <span className="text-text-faint">· {w.role}</span>
                </span>
                {selected && <span className="text-accent ml-2">✓</span>}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => { setOpen(false); setNewName(''); setNewError(''); setNewOpen(true) }}
            className="w-full text-left px-[10px] py-[6px] text-[12px] font-mono text-text-faint hover:bg-bg-muted hover:text-text transition-colors"
            role="menuitem"
          >
            + New workspace
          </button>
          <div className="h-px bg-border mx-[6px] my-[3px]" />

          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint px-[10px] pt-[7px] pb-[3px]">
            Projects
          </div>
          {allProjects.length > 1 && (
            <button
              type="button"
              onClick={() => { setProjectId(null); setOpen(false) }}
              className={cn(
                'w-full text-left px-[10px] py-[6px] text-[12px] font-mono transition-colors flex items-center justify-between',
                currentProjectId === null ? 'bg-bg-muted text-text' : 'text-text-muted hover:bg-bg-muted hover:text-text',
              )}
              role="menuitem"
            >
              <span>All projects</span>
              {currentProjectId === null && <span className="text-accent">✓</span>}
            </button>
          )}
          {allProjects.map((p) => {
            const selected = p.id === currentProjectId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setProjectId(p.id); setOpen(false) }}
                className={cn(
                  'w-full text-left px-[10px] py-[6px] text-[12px] font-mono transition-colors flex items-center justify-between',
                  selected ? 'bg-bg-muted text-text' : 'text-text-muted hover:bg-bg-muted hover:text-text',
                )}
                role="menuitem"
              >
                <span className="truncate">{p.name}</span>
                {selected && <span className="text-accent">✓</span>}
              </button>
            )
          })}
          <div className="h-px bg-border mx-[6px]" />
          <Link
            href="/projects"
            onClick={() => setOpen(false)}
            className="w-full text-left px-[10px] py-[7px] text-[12px] font-mono text-text-faint hover:bg-bg-muted hover:text-text transition-colors flex items-center"
            role="menuitem"
          >
            + New project
          </Link>
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateWorkspace(e)} className="mt-3 space-y-3">
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Acme Inc."
                autoFocus
                required
                className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg text-[13px] outline-none focus:border-accent"
              />
              <p className="text-[11.5px] text-text-faint mt-1.5">
                Creates a new isolated workspace with its own projects, keys, and billing.
              </p>
            </div>
            {newError && <p className="text-[12.5px] text-bad">{newError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createWorkspace.isPending || !newName.trim()}
                className="font-mono text-[11.5px] px-3 py-[5px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {createWorkspace.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ── Nav groups ── */
const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: '/dashboard',  label: 'Dashboard' },
      { href: '/requests',   label: 'Requests' },
      { href: '/traces',     label: 'Traces' },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/anomalies',       label: 'Anomalies' },
      { href: '/security',        label: 'Security' },
      { href: '/savings', label: 'Savings' },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/prompts', label: 'Prompts' },
      { href: '/alerts',  label: 'Alerts' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/projects',  label: 'Projects & Keys' },
      { href: '/settings',  label: 'Settings' },
      { href: '/docs',      label: 'Docs' },
    ],
  },
]

/* ── Theme toggle ── */
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

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const overview = useStatsOverview()
  const isAdmin = useIsAdmin()
  const anomalies = useAnomalies()
  const alerts = useAlerts()
  const recommendations = useRecommendations()
  const { isOpen, close } = useSidebar()

  // Close sidebar when navigating on mobile
  useEffect(() => {
    close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const quota = useQuota()

  const reqCount = overview.data?.totalRequests
  const anomalyCount = (anomalies.data?.data ?? []).length
  // Firing = active rule whose last_triggered_at is within the past hour.
  // Matches the Firing group on the Alerts page.
  const firingCount = (alerts.data ?? []).filter(
    (a) =>
      a.is_active &&
      a.last_triggered_at &&
      Date.now() - new Date(a.last_triggered_at).getTime() < 60 * 60 * 1000,
  ).length
  const savingsTotal = (recommendations.data ?? []).reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)

  const BADGES: Record<string, { label?: string; warn?: boolean }> = {
    '/requests':   reqCount != null ? { label: reqCount > 999 ? (reqCount / 1000).toFixed(0) + 'k' : String(reqCount) } : {},
    '/anomalies':  anomalyCount > 0 ? { label: String(anomalyCount), warn: true } : {},
    '/security':   {},
    '/savings': savingsTotal > 0 ? { label: '$' + (savingsTotal >= 1000 ? (savingsTotal / 1000).toFixed(0) + 'k' : savingsTotal.toFixed(0)) } : {},
    '/alerts':     firingCount > 0 ? { label: String(firingCount), warn: true } : {},
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

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
          // Base
          'flex flex-col bg-bg-elev border-r border-border',
          // Mobile: fixed overlay drawer
          'fixed inset-y-0 left-0 z-50 w-[272px] h-screen',
          'transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: back in flow, always visible
          'md:relative md:w-56 md:shrink-0 md:translate-x-0 md:transition-none',
        )}
      >
      {/* Mobile close button */}
      <button
        type="button"
        onClick={close}
        className="absolute right-3 top-3.5 md:hidden p-1.5 rounded-[5px] text-text-faint hover:text-text hover:bg-bg-muted transition-colors"
        aria-label="Close navigation"
      >
        <X size={16} />
      </button>

      {/* Logo */}
      <div className="px-[18px] pt-[18px] pb-3">
        <LogoMark />
      </div>

      {/* Workspace / project switcher */}
      <div className="mx-[14px] mb-3">
        <WorkspaceSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-[14px] space-y-0">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint px-[10px] pt-3 pb-1">
                {group.label}
              </div>
            )}
            {group.items.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              const badge = BADGES[href]
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center justify-between px-[10px] py-[6px] rounded-[5px] text-[13px] transition-colors',
                    'border-l-2',
                    active
                      ? 'bg-bg-muted text-text font-medium border-accent'
                      : 'text-text-muted hover:bg-bg-muted hover:text-text border-transparent',
                  )}
                >
                  <span>{label}</span>
                  {badge?.label && (
                    <span className={cn(
                      'font-mono text-[10px] px-[6px] py-[1px] rounded-[3px] border',
                      badge.warn
                        ? 'bg-accent-bg text-accent border-accent-border'
                        : 'bg-bg text-text-faint border-border',
                    )}>
                      {badge.label}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Usage + upgrade widget */}
      <div className="mx-[18px] mb-[14px] mt-2 p-3 rounded-md border border-border bg-bg-muted">
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
          Plan · {quota.data?.plan ?? 'free'}
        </div>
        <div className="text-[13px] text-text mb-1.5">
          {quota.data
            ? `${quota.data.usedThisMonth.toLocaleString()} / ${
                quota.data.limit != null
                  ? quota.data.limit >= 1000
                    ? `${(quota.data.limit / 1000).toFixed(0)}k`
                    : String(quota.data.limit)
                  : '∞'
              } requests`
            : '— / — requests'}
        </div>
        <div className="h-1 rounded-full bg-bg overflow-hidden">
          <div
            className="h-full rounded-full bg-text transition-all"
            style={{
              width: quota.data?.limit != null && quota.data.limit > 0
                ? `${Math.min(100, (quota.data.usedThisMonth / quota.data.limit) * 100).toFixed(1)}%`
                : '0%',
            }}
          />
        </div>
        {isAdmin && (
          <button
            onClick={() => router.push('/settings')}
            className="mt-2.5 text-[12px] font-medium text-accent hover:opacity-80 transition-opacity"
          >
            Upgrade →
          </button>
        )}
      </div>

      {/* Theme toggle + Sign out */}
      <div className="px-[14px] pb-[14px] space-y-0.5">
        <ThemeToggleButton />
        <button
          onClick={handleSignOut}
          className="flex w-full items-center px-[10px] py-[6px] rounded-[5px] text-[13px] text-text-muted hover:bg-bg-muted hover:text-text transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
    </>
  )
}
