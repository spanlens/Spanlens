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
  { id: 'pii.ssn-kr',   name: 'Korean RRN',          description: '주민등록번호 XXXXXX-XXXXXXX', type: 'pii',    summaryKey: 'ssn-kr' },
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
        'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border transition-colors duration-150 focus-visible:outline-none',
        checked ? 'bg-accent border-accent' : 'bg-bg-elev border-border',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-[12px] w-[12px] rounded-full bg-white shadow-sm transition-transform duration-150 mt-[2px]',
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

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
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Security' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={isFetching} />
              <TimeRangeSelector
                value={rangeParam}
                onChange={(v) => updateQuery({ range: v === '24h' ? null : v, from: null, to: null, page: null })}
                customRange={customRange}
                onCustomRange={(r) => updateQuery({ range: 'custom', from: r.from, to: r.to, page: null })}
              />
              <button
                type="button"
                onClick={refreshAll}
                disabled={isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', isFetching && 'animate-spin')}>↻</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Security</h1>
      </div>

      {/* Stat strip — buttons when enabled (non-zero); the Detectors card
          always jumps to the table. Others stay static. */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            { label: `Events · ${rangeShort}`,    value: statsReady ? String(totalHits) : '—',  warn: statsReady && totalHits > 0, ref: detectorsRef, enabled: statsReady && totalHits > 0 },
            { label: 'PII hits',                  value: statsReady ? String(piiHits)  : '—',  warn: statsReady && piiHits > 0,   ref: flaggedRef,   enabled: statsReady && piiHits > 0,   onClick: () => { updateQuery({ flagType: 'pii', page: null }); setTimeout(() => scrollTo(flaggedRef), 80) } },
            { label: 'Injection attempts',        value: statsReady ? String(injHits)  : '—',  warn: statsReady && injHits > 0,   ref: flaggedRef,   enabled: statsReady && injHits > 0,   onClick: () => { updateQuery({ flagType: 'injection', page: null }); setTimeout(() => scrollTo(flaggedRef), 80) } },
            { label: 'Recent flagged',            value: flaggedReady ? String(flaggedTotal) : '—', warn: flaggedReady && flaggedTotal > 0, ref: flaggedRef, enabled: flaggedReady && flaggedTotal > 0 },
            { label: 'Detectors',                 value: String(detectors.length),              warn: false, ref: detectorsRef, enabled: true },
          ].map((s, i) => {
            const onClick = s.onClick ?? (() => scrollTo(s.ref!))
            const Wrap: React.ElementType = s.enabled ? 'button' : 'div'
            return (
              <Wrap
                key={s.label}
                {...(s.enabled ? { type: 'button', onClick } : {})}
                className={cn(
                  'px-[18px] py-[14px] text-left',
                  i < 4 && 'border-r border-border',
                  s.enabled && 'hover:bg-bg-elev transition-colors cursor-pointer',
                )}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
                <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
                  {s.value}
                </span>
              </Wrap>
            )
          })}
        </div>
      </div>

      <div>
        <div className="px-[22px] pt-[18px] pb-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div className="border border-border rounded-[6px] px-[16px] py-[14px]">
              <div className="flex items-center justify-between mb-[6px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Alert emails
                </span>
                <Toggle
                  checked={settingsData?.alertEnabled ?? false}
                  disabled={!settingsReady || toggleAlert.isPending}
                  onChange={(enabled) => toggleAlert.mutate(enabled)}
                />
              </div>
              <p className="text-[11.5px] text-text-faint leading-relaxed">
                Email workspace owner when security flags are detected.
                Rate-limited to one email per 5 minutes.
              </p>
            </div>

            <div className="border border-border rounded-[6px] px-[16px] py-[14px]">
              <div className="mb-[8px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Injection blocking, per project
                </span>
              </div>
              {settings.isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="h-6 bg-bg-elev rounded animate-pulse" />)}
                </div>
              ) : settings.isError ? (
                <p className="text-[11.5px] text-accent">Failed to load projects.</p>
              ) : (settingsData?.projects ?? []).length === 0 ? (
                <p className="text-[11.5px] text-text-faint">No projects found.</p>
              ) : (
                <div className="space-y-[6px]">
                  {(settingsData?.projects ?? []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <span className="font-mono text-[11.5px] text-text truncate pr-3">{p.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.blockEnabled && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border border-accent-border bg-accent-bg text-accent">
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
              <p className="text-[11px] text-text-faint mt-[8px] leading-relaxed">
                When ON, injection attempts return 422, request never reaches the LLM.
              </p>
            </div>
          </div>
        </div>

        <div ref={detectorsRef} className="px-[22px] pt-[14px] pb-0">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Detectors, {detectors.length} active · flag-only (no blocking unless enabled above)
            </span>
            <ExportDropdown
              filename="spanlens-security"
              buildUrl={(fmt) => `/api/v1/exports/security?format=${fmt}`}
            />
          </div>

          <div className="overflow-x-auto">
          <div
            className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border border-border rounded-t-[6px] border-b-0 min-w-[520px]"
            style={{ gridTemplateColumns: '1fr 110px 1.4fr 100px 100px' }}
          >
            <span>Detector</span>
            <span>ID</span>
            <span>Description</span>
            <span>Type</span>
            <span className="text-right">Hits · {rangeShort}</span>
          </div>

          <div className="border border-border rounded-b-[6px] overflow-hidden min-w-[520px]">
            {detectors.map((d, i) => (
              <div
                key={d.id}
                className={cn(
                  'grid items-center px-[14px] py-[11px] font-mono text-[12px] min-w-[520px] hover:bg-bg-elev transition-colors',
                  i < detectors.length - 1 && 'border-b border-border',
                )}
                style={{ gridTemplateColumns: '1fr 110px 1.4fr 100px 100px' }}
              >
                <span className="text-text text-[12.5px]">{d.name}</span>
                <span className="text-text-muted text-[10.5px] truncate" title={`SDK detector ID: ${d.id}`}>{d.id}</span>
                <span className="text-text-faint text-[11px] truncate pr-4">{d.description}</span>
                <span>
                  <span
                    className={cn(
                      'font-mono text-[10px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
                      d.type === 'injection'
                        ? 'text-accent border-accent-border bg-accent-bg'
                        : 'text-text-muted border-border',
                    )}
                  >
                    {d.type}
                  </span>
                </span>
                <span className={cn('text-right', statsReady && d.hits > 0 ? 'text-accent font-medium' : 'text-text-faint')}>
                  {statsReady ? d.hits : '—'}
                </span>
              </div>
            ))}
          </div>
          </div>
        </div>

        <div ref={flaggedRef} className="px-[22px] py-[18px]">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Recent flagged requests
            </span>
            <div className="flex items-center gap-2">
              {(['all', 'pii', 'injection'] as FlagFilter[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => updateQuery({ flagType: v === 'all' ? null : v, page: null })}
                  className={cn(
                    'font-mono text-[11px] px-[9px] py-[3px] rounded-[4px] border transition-colors',
                    flagFilter === v
                      ? 'border-border-strong bg-bg-elev text-text'
                      : 'border-border text-text-muted hover:text-text',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {flagged.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />)}
            </div>
          ) : flagged.isError ? (
            <div className="rounded-md border border-accent-border bg-accent-bg px-[14px] py-[18px] text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-accent mb-1.5">Error</div>
              <p className="text-[12.5px] text-text-faint">Failed to load flagged requests.</p>
            </div>
          ) : flaggedData.length === 0 ? (
            <div className="rounded-md border border-border bg-bg-elev px-[14px] py-[18px] text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-good mb-1.5">All clear</div>
              <p className="text-[12.5px] text-text-faint mb-1">
                {flagFilter === 'all'
                  ? 'No flagged requests found.'
                  : `No ${flagFilter} flags in the current page.`}
              </p>
              {mounted && (
                <p className="text-[10.5px] text-text-faint opacity-70 mb-3" title={summary.dataUpdatedAt ? formatAbsolute(new Date(summary.dataUpdatedAt).toISOString()) : undefined}>
                  Last checked {summary.dataUpdatedAt ? formatRelative(new Date(summary.dataUpdatedAt).toISOString()) : 'just now'}
                </p>
              )}
              <Link
                href="/docs/features/security"
                className="inline-flex font-mono text-[11px] mt-1 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
              >
                How detectors work →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border border-border rounded-t-[6px] border-b-0 min-w-[420px]"
                style={{ gridTemplateColumns: '110px 1fr 1fr 80px' }}
              >
                <span>When</span>
                <span>Model</span>
                <span>Flags</span>
                <span className="text-right">→</span>
              </div>
              <div className="border border-border rounded-b-[6px] overflow-hidden min-w-[420px]">
                {flaggedData.map((r, i) => {
                  const reqFlags = r.flags ?? []
                  const resFlags = r.response_flags ?? []
                  return (
                    <div
                      key={r.id}
                      className={cn(
                        'grid items-center px-[14px] py-[10px] min-w-[420px]',
                        i < flaggedData.length - 1 && 'border-b border-border',
                        'hover:bg-bg-elev transition-colors',
                      )}
                      style={{ gridTemplateColumns: '110px 1fr 1fr 80px' }}
                    >
                      <span
                        className="font-mono text-[11.5px] text-text-muted"
                        title={formatAbsolute(r.created_at)}
                      >
                        {mounted ? formatRelative(r.created_at) : '—'}
                      </span>
                      <span className="font-mono text-[12px] text-text">{r.provider} / {r.model}</span>
                      <div className="flex flex-wrap gap-1">
                        {reqFlags.map((f, fi) => (
                          <span
                            key={`req:${f.type}:${f.pattern}:${fi}`}
                            className={cn(
                              'font-mono text-[10px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border',
                              f.type === 'injection'
                                ? 'border-accent-border bg-accent-bg text-accent'
                                : 'border-border text-text-muted',
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
                              'font-mono text-[10px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border',
                              f.type === 'injection'
                                ? 'border-accent-border bg-accent-bg text-accent'
                                : 'border-border text-text-muted',
                              'opacity-70',
                            )}
                          >
                            ↩ {f.pattern}
                          </span>
                        ))}
                      </div>
                      <div className="text-right">
                        <Link href={`/requests/${r.id}`} className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity">
                          Details →
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Pagination — Page X of N · 50 / total. Same shape as users / traces. */}
          {mounted && !flagged.isLoading && flaggedTotal > 0 && (
            <div className="flex items-center justify-between mt-3 font-mono text-[11px] flex-wrap gap-3">
              <div className="text-text-faint">
                Page {page} of {lastPage} · {Math.min(PAGE_SIZE, flaggedAll.length)} / {flaggedTotal.toLocaleString()}
              </div>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => updateQuery({ page: null })}
                  className="px-2.5 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  First
                </button>
                <button
                  disabled={page <= 1}
                  onClick={() => updateQuery({ page: String(page - 1) })}
                  className="px-3 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Prev
                </button>
                <button
                  disabled={page >= lastPage}
                  onClick={() => updateQuery({ page: String(page + 1) })}
                  className="px-3 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
                <button
                  disabled={page >= lastPage}
                  onClick={() => updateQuery({ page: String(lastPage) })}
                  className="px-2.5 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
