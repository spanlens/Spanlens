'use client'
import { useMemo, useRef, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useSecurityFlagged,
  useSecuritySummary,
  useSecuritySettings,
  useToggleSecurityAlert,
  useToggleProjectBlock,
} from '@/lib/queries/use-security'
import { Topbar, LiveDot, TimeRangeSelector, type CustomRange } from '@/components/layout/topbar'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn } from '@/lib/utils'

type TimeRange = '1h' | '24h' | '7d' | '30d' | 'custom'
type FlagFilter = 'all' | 'pii' | 'injection'

const PAGE_SIZE = 50

// Hydration-safe "is this the client?" gate, same pattern as users / requests.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

function rangeToHours(r: TimeRange, customRange: CustomRange | null): number {
  if (r === 'custom' && customRange) {
    const diff = new Date(customRange.to).getTime() - new Date(customRange.from).getTime()
    return Math.max(1, Math.round(diff / 3_600_000))
  }
  switch (r) {
    case '1h':  return 1
    case '24h': return 24
    case '7d':  return 24 * 7
    case '30d': return 24 * 30
    default:    return 24
  }
}

function rangeLabel(r: TimeRange, customRange: CustomRange | null): string {
  if (r === 'custom' && customRange) {
    const days = Math.max(1, Math.round((new Date(customRange.to).getTime() - new Date(customRange.from).getTime()) / 86_400_000))
    return `${days}d`
  }
  return r
}

function formatRelative(iso: string): string {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const diff = (Date.now() - ms) / 1000
  if (diff < 0) return 'just now'
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface DetectorDef {
  id: string
  name: string
  description: string
  type: 'pii' | 'injection'
  summaryKey: string
}

const DETECTORS: readonly DetectorDef[] = [
  { id: 'pii.email',    name: 'Email addresses',     description: 'user@example.com',         type: 'pii',       summaryKey: 'email' },
  { id: 'pii.phone',    name: 'Phone numbers',       description: 'E.164 + common formats',   type: 'pii',       summaryKey: 'phone' },
  { id: 'pii.card',     name: 'Credit cards',        description: '13–19 digit PANs',         type: 'pii',       summaryKey: 'credit-card' },
  { id: 'pii.ssn-us',   name: 'US SSN',              description: 'NNN-NN-NNNN',              type: 'pii',       summaryKey: 'ssn-us' },
  { id: 'pii.ssn-kr',   name: 'Korean RRN',          description: 'YYMMDD-NNNNNNN',           type: 'pii',       summaryKey: 'ssn-kr' },
  { id: 'pii.iban',     name: 'IBAN',                description: 'EU + UK + 30 countries',   type: 'pii',       summaryKey: 'iban' },
  { id: 'pii.passport', name: 'Passport numbers',    description: 'Generic letter+digit',     type: 'pii',       summaryKey: 'passport' },
  { id: 'sec.injection', name: 'Prompt injection',   description: 'Override/reveal/role/jailbreak/smuggle (EN + KO)', type: 'injection', summaryKey: '*' },
]

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // Track and knob both run on tokens so the switch inverts correctly in
        // dark mode; a literal white knob used to read as a hole on dark.
        'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-150 focus-visible:outline-none',
        checked ? 'bg-accent' : 'bg-track',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-[12px] w-[12px] rounded-full shadow-sm transition-transform duration-150 mt-[3px]',
          checked ? 'translate-x-[17px] bg-accent-fg' : 'translate-x-[3px] bg-bg-elev',
        )}
      />
    </button>
  )
}

/* Column templates are shared by each table's head and body so they cannot drift. */
const DETECTOR_GRID = 'grid gap-3 grid-cols-[minmax(104px,1fr)_92px_minmax(104px,1.1fr)_70px_66px]'
const FLAGGED_GRID = 'grid gap-3 grid-cols-[92px_minmax(108px,1fr)_minmax(108px,1fr)_70px]'
const PAGER_BTN =
  'px-3 py-1.5 rounded-full border border-border text-text hover:bg-bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

export function SecurityClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  // URL-backed filter state.
  const rangeParam = (sp.get('range') ?? '24h') as TimeRange
  const customFrom = sp.get('from')
  const customTo   = sp.get('to')
  const customRange: CustomRange | null =
    rangeParam === 'custom' && customFrom && customTo ? { from: customFrom, to: customTo } : null
  const flagFilter = (sp.get('flagType') ?? 'all') as FlagFilter
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/security?${next.toString()}`)
  }

  const hours = rangeToHours(rangeParam, customRange)
  const rangeShort = rangeLabel(rangeParam, customRange)

  const summary = useSecuritySummary(hours)
  const flagged = useSecurityFlagged({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
  const settings = useSecuritySettings()
  const toggleAlert = useToggleSecurityAlert()
  const toggleBlock = useToggleProjectBlock()

  const summaryData = summary.data ?? []
  const flaggedAll = useMemo(() => flagged.data?.data ?? [], [flagged.data])
  const flaggedTotal = flagged.data?.total ?? 0
  const settingsData = settings.data

  // Client-side filter (pii vs injection) layered on the page the server
  // already returned. Page size stays the same; the displayed count drops.
  const flaggedData = useMemo(() => {
    if (flagFilter === 'all') return flaggedAll
    return flaggedAll.filter((r) => {
      const all = [...(r.flags ?? []), ...(r.response_flags ?? [])]
      return all.some((f) => f.type === flagFilter)
    })
  }, [flaggedAll, flagFilter])

  const detectors = DETECTORS.map((d) => {
    const hits = d.summaryKey === '*'
      ? summaryData.filter((s) => s.type === d.type).reduce((sum, r) => sum + r.count, 0)
      : summaryData
          .filter((s) => s.type === d.type && s.pattern === d.summaryKey)
          .reduce((sum, r) => sum + r.count, 0)
    return { ...d, hits }
  })

  const statsReady = mounted && !summary.isLoading && !summary.isError
  const flaggedReady = mounted && !flagged.isLoading && !flagged.isError
  const settingsReady = !settings.isLoading && !settings.isError
  const totalHits = summaryData.reduce((s, r) => s + r.count, 0)
  const piiHits = summaryData.filter((s) => s.type === 'pii').reduce((s, r) => s + r.count, 0)
  const injHits = summaryData.filter((s) => s.type === 'injection').reduce((s, r) => s + r.count, 0)
  const lastPage = Math.max(1, Math.ceil(flaggedTotal / PAGE_SIZE))

  const isFetching = summary.isFetching || flagged.isFetching || settings.isFetching
  function refreshAll() {
    void summary.refetch()
    void flagged.refetch()
    void settings.refetch()
  }

  // Stat-card anchors — clicking a non-zero stat scrolls the user to the
  // matching section instead of hunting by eye. Matches anomalies UX.
  const detectorsRef = useRef<HTMLDivElement>(null)
  const flaggedRef = useRef<HTMLDivElement>(null)
  function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[{ label: 'Security' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={isFetching} />
              <button
                type="button"
                onClick={refreshAll}
                disabled={isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', isFetching && 'animate-spin')}>&#8631;</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Security</h1>
      </div>

      {/* 20px above the first row, 16px between rows, per the Figma content
          frame. Side and bottom gutters come from `DashboardContent`. */}
      <div className="pt-4 md:pt-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <TimeRangeSelector
            value={rangeParam}
            onChange={(v) => updateQuery({ range: v === '24h' ? null : v, from: null, to: null, page: null })}
            customRange={customRange}
            onCustomRange={(r) => updateQuery({ range: 'custom', from: r.from, to: r.to, page: null })}
          />
          <span className="font-mono text-[11px] text-text-faint">
            Detectors flag only, unless project blocking is on
          </span>
          <div className="ml-auto">
            <ExportDropdown
              filename="spanlens-security"
              buildUrl={(fmt) => `/api/v1/exports/security?format=${fmt}`}
            />
          </div>
        </div>

        {/* Stat cards double as jump links: clicking a non-zero stat scrolls to
            the matching section, and the two flag stats also set the filter. */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: `Events \u00b7 ${rangeShort}`, value: statsReady ? String(totalHits) : '\u2014', note: 'across all detectors', warn: statsReady && totalHits > 0, ref: detectorsRef, enabled: statsReady && totalHits > 0 },
            { label: 'PII hits', value: statsReady ? String(piiHits) : '\u2014', note: 'redacted at rest', warn: statsReady && piiHits > 0, ref: flaggedRef, enabled: statsReady && piiHits > 0, onClick: () => { updateQuery({ flagType: 'pii', page: null }); setTimeout(() => scrollTo(flaggedRef), 80) } },
            { label: 'Injection attempts', value: statsReady ? String(injHits) : '\u2014', note: 'flagged in the window', warn: statsReady && injHits > 0, ref: flaggedRef, enabled: statsReady && injHits > 0, onClick: () => { updateQuery({ flagType: 'injection', page: null }); setTimeout(() => scrollTo(flaggedRef), 80) } },
            { label: 'Recent flagged', value: flaggedReady ? String(flaggedTotal) : '\u2014', note: 'requests on record', warn: flaggedReady && flaggedTotal > 0, ref: flaggedRef, enabled: flaggedReady && flaggedTotal > 0 },
            { label: 'Detectors', value: String(detectors.length), note: 'workspace default', warn: false, ref: detectorsRef, enabled: true },
          ].map((s) => {
            const onClick = s.onClick ?? (() => scrollTo(s.ref!))
            const Wrap: React.ElementType = s.enabled ? 'button' : 'div'
            return (
              <Wrap
                key={s.label}
                {...(s.enabled ? { type: 'button', onClick } : {})}
                className={cn(
                  'rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px] text-left',
                  s.enabled && 'hover:bg-bg-muted transition-colors cursor-pointer',
                )}
              >
                <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">{s.label}</div>
                <div className={cn('font-display text-[22px] track-h3 leading-[1.05] mt-[7px]', s.warn ? 'text-accent' : 'text-text')}>
                  {s.value}
                </div>
                <div className={cn('text-[11.5px] font-medium mt-[7px]', s.warn ? 'text-accent' : 'text-text-faint')}>
                  {s.note}
                </div>
              </Wrap>
            )
          })}
        </div>

        {/* Workspace-level controls. D8 does not draw these, but they are live
            settings, so they get the same card language. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13.5px] font-semibold text-text">Alert emails</h2>
              <Toggle
                checked={settingsData?.alertEnabled ?? false}
                disabled={!settingsReady || toggleAlert.isPending}
                onChange={(enabled) => toggleAlert.mutate(enabled)}
              />
            </div>
            <p className="text-[11.5px] text-text-muted leading-relaxed mt-2">
              Email workspace owner when security flags are detected.
              Rate-limited to one email per 5 minutes.
            </p>
          </div>

          <div className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]">
            <h2 className="text-[13.5px] font-semibold text-text">Injection blocking, per project</h2>
            <div className="mt-3">
              {settings.isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="h-6 bg-bg-muted rounded animate-pulse" />)}
                </div>
              ) : settings.isError ? (
                <p className="text-[11.5px] text-accent">Failed to load projects.</p>
              ) : (settingsData?.projects ?? []).length === 0 ? (
                <p className="text-[11.5px] text-text-faint">No projects found.</p>
              ) : (
                <div className="divide-y divide-border">
                  {(settingsData?.projects ?? []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                      <span className="font-mono text-[12px] text-text truncate pr-3">{p.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.blockEnabled && (
                          <span className="inline-flex items-center rounded-full bg-accent-bg px-2 py-[3px] font-mono text-[10.5px] text-accent">
                            blocking
                          </span>
                        )}
                        <Toggle
                          checked={p.blockEnabled}
                          disabled={toggleBlock.isPending}
                          onChange={(enabled) =>
                            toggleBlock.mutate({ projectId: p.id, enabled })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11.5px] text-text-muted mt-3 leading-relaxed">
              When ON, injection attempts return 422 and the request never reaches the LLM.
            </p>
          </div>
        </div>

        {/* Detectors on the left, recent flagged on the right, per D8. Each
            table keeps its own horizontal scroller so the page never does. */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <div ref={detectorsRef} className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 px-5 pt-[18px] pb-3.5">
              <h2 className="text-[13.5px] font-semibold text-text">Detectors</h2>
              <span className="font-mono text-[11px] text-text-faint">{detectors.length} active</span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                <div className={cn(DETECTOR_GRID, 'bg-bg-muted border-y border-border px-5 py-2.5')}>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Detector</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">ID</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Description</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Type</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint text-right">
                    Hits &#183; {rangeShort}
                  </span>
                </div>
                {detectors.map((d) => (
                  <div
                    key={d.id}
                    className={cn(DETECTOR_GRID, 'items-center px-5 py-3 border-b border-border last:border-b-0 hover:bg-bg-muted transition-colors')}
                  >
                    <span className="text-[12.5px] text-text truncate">{d.name}</span>
                    <span className="font-mono text-[11px] text-text-muted truncate" title={`SDK detector ID: ${d.id}`}>{d.id}</span>
                    <span className="text-[11.5px] text-text-faint truncate pr-3">{d.description}</span>
                    <span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]',
                          d.type === 'injection' ? 'bg-accent-bg text-accent' : 'bg-bg-chip text-text-muted',
                        )}
                      >
                        {d.type}
                      </span>
                    </span>
                    <span className={cn('font-mono text-[12px] text-right', statsReady && d.hits > 0 ? 'text-accent font-medium' : 'text-text-faint')}>
                      {statsReady ? d.hits : '\u2014'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div ref={flaggedRef} className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-3.5">
              <h2 className="text-[13.5px] font-semibold text-text">Recent flagged</h2>
              <div className="inline-flex items-center gap-0.5 rounded-full bg-bg-chip p-[3px]">
                {(['all', 'pii', 'injection'] as FlagFilter[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={flagFilter === v}
                    onClick={() => updateQuery({ flagType: v === 'all' ? null : v, page: null })}
                    className={cn(
                      'rounded-full px-[11px] py-[5px] text-[12px] font-medium transition-colors',
                      flagFilter === v ? 'bg-bg-elev text-text shadow-card' : 'text-text-faint hover:text-text',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {flagged.isLoading ? (
              <div className="px-5 pb-[18px] space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-bg-muted rounded-md animate-pulse" />)}
              </div>
            ) : flagged.isError ? (
              <div className="mx-5 mb-[18px] rounded-lg border border-accent-border bg-accent-bg px-4 py-[18px] text-center">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent mb-1.5">Error</div>
                <p className="text-[12.5px] text-text-muted">Failed to load flagged requests.</p>
              </div>
            ) : flaggedData.length === 0 ? (
              <div className="mx-5 mb-[18px] rounded-lg border border-border bg-bg-muted px-4 py-[18px] text-center">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-good mb-1.5">All clear</div>
                <p className="text-[12.5px] text-text-muted mb-1">
                  {flagFilter === 'all'
                    ? 'No flagged requests found.'
                    : `No ${flagFilter} flags in the current page.`}
                </p>
                {mounted && (
                  <p className="text-[11px] text-text-faint mb-3" title={summary.dataUpdatedAt ? formatAbsolute(new Date(summary.dataUpdatedAt).toISOString()) : undefined}>
                    Last checked {summary.dataUpdatedAt ? formatRelative(new Date(summary.dataUpdatedAt).toISOString()) : 'just now'}
                  </p>
                )}
                <Link
                  href="/docs/features/security"
                  className="inline-flex rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors"
                >
                  How detectors work &#8594;
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[432px]">
                  <div className={cn(FLAGGED_GRID, 'bg-bg-muted border-y border-border px-5 py-2.5')}>
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">When</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Model</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Flags</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint text-right">Action</span>
                  </div>
                  {flaggedData.map((r) => {
                    const reqFlags = r.flags ?? []
                    const resFlags = r.response_flags ?? []
                    return (
                      <div
                        key={r.id}
                        className={cn(FLAGGED_GRID, 'items-center px-5 py-3 border-b border-border last:border-b-0 hover:bg-bg-muted transition-colors')}
                      >
                        <span className="font-mono text-[12px] text-text-muted" title={formatAbsolute(r.created_at)}>
                          {mounted ? formatRelative(r.created_at) : '\u2014'}
                        </span>
                        <span className="font-mono text-[12px] text-text truncate">{r.provider} / {r.model}</span>
                        <div className="flex flex-wrap gap-1">
                          {reqFlags.map((f, fi) => (
                            <span
                              key={`req:${f.type}:${f.pattern}:${fi}`}
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]',
                                f.type === 'injection' ? 'bg-accent-bg text-accent' : 'bg-bg-chip text-text-muted',
                              )}
                            >
                              {f.pattern}
                            </span>
                          ))}
                          {resFlags.map((f, fi) => (
                            <span
                              key={`res:${f.type}:${f.pattern}:${fi}`}
                              title="Detected in LLM response"
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]',
                                f.type === 'injection' ? 'bg-accent-bg text-accent' : 'bg-bg-chip text-text-muted',
                                'opacity-70',
                              )}
                            >
                              &#8617; {f.pattern}
                            </span>
                          ))}
                        </div>
                        <div className="text-right">
                          <Link href={`/requests/${r.id}`} className="font-mono text-[12px] text-accent hover:opacity-80 transition-opacity">
                            Details &#8594;
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Pagination: Page X of N. Same shape as users / traces. */}
            {mounted && !flagged.isLoading && flaggedTotal > 0 && (
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-border font-mono text-[11px] flex-wrap gap-3">
                <div className="text-text-faint">
                  Page {page} of {lastPage} &#183; {Math.min(PAGE_SIZE, flaggedAll.length)} / {flaggedTotal.toLocaleString()}
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => updateQuery({ page: null })}
                    className={PAGER_BTN}
                  >
                    First
                  </button>
                  <button
                    disabled={page <= 1}
                    onClick={() => updateQuery({ page: String(page - 1) })}
                    className={PAGER_BTN}
                  >
                    Prev
                  </button>
                  <button
                    disabled={page >= lastPage}
                    onClick={() => updateQuery({ page: String(page + 1) })}
                    className={PAGER_BTN}
                  >
                    Next
                  </button>
                  <button
                    disabled={page >= lastPage}
                    onClick={() => updateQuery({ page: String(lastPage) })}
                    className={PAGER_BTN}
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
