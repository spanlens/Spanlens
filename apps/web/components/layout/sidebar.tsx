'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useStatsOverview } from '@/lib/queries/use-stats'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import { useAlerts } from '@/lib/queries/use-alerts'
import { useRecommendations } from '@/lib/queries/use-recommendations'

/* ── Logo mark (SVG lens ring + wordmark) ── */
function LogoMark() {
  return (
    <Link
      href="/"
      aria-label="Spanlens home"
      className="flex items-center gap-2 px-1 py-1 hover:opacity-80 transition-opacity"
    >
      <svg width="17" height="17" viewBox="0 0 20 20" className="shrink-0">
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--text)" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="3.5" fill="var(--accent)" />
      </svg>
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">
        spanlens
      </span>
    </Link>
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
      { href: '/recommendations', label: 'Savings' },
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
      { href: '/billing',   label: 'Billing' },
      { href: '/settings',  label: 'Settings' },
      { href: '/docs',      label: 'Docs' },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const overview = useStatsOverview()
  const anomalies = useAnomalies()
  const alerts = useAlerts()
  const recommendations = useRecommendations()

  const reqCount = overview.data?.totalRequests
  const anomalyCount = (anomalies.data?.data ?? []).length
  const alertCount = (alerts.data ?? []).filter((a) => a.is_active).length
  const savingsTotal = (recommendations.data ?? []).reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)

  const BADGES: Record<string, { label?: string; warn?: boolean }> = {
    '/requests':   reqCount != null ? { label: reqCount > 999 ? (reqCount / 1000).toFixed(0) + 'k' : String(reqCount) } : {},
    '/anomalies':  anomalyCount > 0 ? { label: String(anomalyCount), warn: true } : {},
    '/security':   {},
    '/recommendations': savingsTotal > 0 ? { label: '$' + (savingsTotal >= 1000 ? (savingsTotal / 1000).toFixed(0) + 'k' : savingsTotal.toFixed(0)) } : {},
    '/alerts':     alertCount > 0 ? { label: String(alertCount), warn: true } : {},
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col bg-bg-elev border-r border-border">
      {/* Logo */}
      <div className="px-[18px] pt-[18px] pb-3">
        <LogoMark />
      </div>

      {/* Workspace switcher */}
      <div className="mx-[14px] mb-3">
        <button className="w-full flex items-center justify-between px-[10px] py-[7px] rounded-[5px] border border-border bg-bg-muted text-[12px] font-mono text-text-muted hover:bg-bg-muted/80 transition-colors">
          <span>
            <span className="text-text-faint">workspace /</span> prod
          </span>
          <span className="text-text-faint text-[10px]">⌄</span>
        </button>
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
          Plan · free
        </div>
        <div className="text-[13px] text-text mb-1.5">— / 50k requests</div>
        <div className="h-1 rounded-full bg-bg overflow-hidden">
          <div className="h-full w-0 rounded-full bg-text" />
        </div>
        <button
          onClick={() => router.push('/billing')}
          className="mt-2.5 text-[12px] font-medium text-accent hover:opacity-80 transition-opacity"
        >
          Upgrade →
        </button>
      </div>

      {/* Sign out */}
      <div className="px-[14px] pb-[14px]">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center px-[10px] py-[6px] rounded-[5px] text-[13px] text-text-muted hover:bg-bg-muted hover:text-text transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
