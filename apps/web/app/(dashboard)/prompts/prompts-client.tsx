'use client'
import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, FlaskConical } from 'lucide-react'
import {
  usePrompts,
  useCreatePromptVersion,
} from '@/lib/queries/use-prompts'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { cn, formatDate } from '@/lib/utils'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

function QualityBadge({ score }: { score: number | null | undefined }) {
  // Was rendering a stray comma (`<span>,</span>`) when null — that looked
  // like punctuation noise next to real numbers. Use an em-dash like every
  // other "no data" cell on the page.
  if (score == null) return <span className="text-text-faint">—</span>
  const color = score >= 90 ? 'text-good' : score >= 70 ? 'text-warn' : 'text-bad'
  return <span className={cn('font-mono tabular-nums', color)}>{score}</span>
}

type FilterType = 'all' | 'ab'
type MinCalls = 0 | 1 | 10 | 100
type DateRange = '24h' | '7d' | '30d'
type ViewMode = 'all' | 'active'

const DATE_RANGE_HOURS: Record<DateRange, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }

const GRID = '20px 1.5fr 0.55fr 0.55fr 0.8fr 0.8fr 0.8fr 0.7fr 0.5fr 0.5fr'

export function PromptsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  // URL-backed filter state — shareable, survives reload.
  const search    = sp.get('q') ?? ''
  const filter    = (sp.get('filter') ?? 'all') as FilterType
  const minCalls  = (parseInt(sp.get('minCalls') ?? '0', 10) || 0) as MinCalls
  const dateRange = (sp.get('range') ?? '24h') as DateRange
  const viewMode  = (sp.get('view') ?? 'all') as ViewMode

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/prompts?${next.toString()}`)
  }

  // Local search input — debounced to URL after 300ms so each keystroke
  // doesn't push a history entry.
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // searchInput intentionally only — URL change re-mounts the input via key=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const [callsMenuOpen, setCallsMenuOpen] = useState(false)
  const [dateMenuOpen, setDateMenuOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const callsMenuRef = useRef<HTMLDivElement>(null)
  const dateMenuRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!callsMenuOpen && !dateMenuOpen && !exportOpen) return
    const handler = (e: PointerEvent) => {
      if (callsMenuOpen && !callsMenuRef.current?.contains(e.target as Node)) setCallsMenuOpen(false)
      if (dateMenuOpen && !dateMenuRef.current?.contains(e.target as Node)) setDateMenuOpen(false)
      if (exportOpen && !exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCallsMenuOpen(false); setDateMenuOpen(false); setExportOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [callsMenuOpen, dateMenuOpen, exportOpen])

  const hours = DATE_RANGE_HOURS[dateRange]
  const { data: prompts, isLoading, isFetching, refetch } = usePrompts(undefined, hours)
  const createMutation = useCreatePromptVersion()

  const all = prompts ?? []
  const totalVersions = all.reduce((s, p) => s + (p.versionCount ?? p.version), 0)
  const totalCalls = all.reduce((s, p) => s + (p.stats?.calls ?? 0), 0)
  const totalSpend = all.reduce((s, p) => s + (p.stats?.totalCostUsd ?? 0), 0)
  const abCount = all.filter((p) => p.activeExperiment != null).length
  const avgQuality = (() => {
    const scores = all.map((p) => p.qualityScore).filter((s): s is number => s != null)
    return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  })()

  const filtered = all.filter(
    (p) =>
      (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'all' || (p.versionCount ?? p.version) > 1 || p.activeExperiment != null) &&
      (minCalls === 0 || (p.stats?.calls ?? 0) >= minCalls) &&
      (viewMode === 'all' || (p.stats?.calls ?? 0) > 0),
  )

  async function handleCreate() {
    setFormError(null)
    if (!form.name.trim() || !form.content.trim()) {
      setFormError('Name and content are required.')
      return
    }
    try {
      await createMutation.mutateAsync({ name: form.name.trim(), content: form.content })
      setForm({ name: '', content: '' })
      setFormOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  // CSV / JSON export — RFC 4180 escaping, same pattern as savings/users.
  function csvField(v: string | number): string {
    const s = String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  function csvRow(cells: (string | number)[]): string {
    return cells.map(csvField).join(',')
  }
  function downloadFile(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spanlens-prompts-${dateRange}-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    const lines: string[] = []
    lines.push(csvRow([`Prompts (${dateRange})`]))
    lines.push(csvRow(['Name', 'Active Version', 'Versions', `Calls ${dateRange}`, 'Avg Cost USD', 'Avg Latency ms', `Quality ${dateRange}`, 'A/B Running', 'Updated']))
    for (const p of filtered) {
      lines.push(csvRow([
        p.name,
        `v${p.version}`,
        p.versionCount ?? p.version,
        p.stats?.calls ?? 0,
        p.stats?.avgCostUsd != null ? p.stats.avgCostUsd.toFixed(5) : '',
        p.stats?.avgLatencyMs != null ? Math.round(p.stats.avgLatencyMs) : '',
        p.qualityScore ?? '',
        p.activeExperiment ? 'yes' : 'no',
        p.created_at,
      ]))
    }
    downloadFile(lines.join('\n'), 'text/csv', 'csv')
  }
  function exportJson() {
    downloadFile(JSON.stringify({ range: dateRange, prompts: filtered }, null, 2), 'application/json', 'json')
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Prompts' }]}
          right={
            <div className="flex items-center gap-2">
              <LiveDot refetching={isFetching} />
              {/* Search, desktop only; mobile search lives in the filter bar.
                  Debounced 300ms to the URL `?q=` param. */}
              <div className="hidden md:flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[6px] bg-bg-elev w-[240px]">
                <span className="text-text-faint text-[14px] leading-none">⌕</span>
                <input
                  key={search}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchInput('')
                      updateQuery({ q: null })
                    }
                  }}
                  placeholder="Search prompts…"
                  className="flex-1 bg-transparent font-mono text-[12px] text-text-muted placeholder:text-text-faint focus:outline-none"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                    className="text-text-faint hover:text-text transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', isFetching && 'animate-spin')}>↻</span>
              </button>
              <PermissionGate need="edit">
                <button
                  type="button"
                  onClick={() => setFormOpen((v) => !v)}
                  className="font-mono text-[11px] text-text px-[10px] py-[5px] border border-border-strong rounded-[5px] bg-bg-elev hover:bg-bg-muted transition-colors whitespace-nowrap shrink-0"
                >
                  + register prompt
                </button>
              </PermissionGate>
            </div>
          }
        />
        <h1 className="sr-only">Prompts</h1>
      </div>

      {/* Info banner */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-[22px] py-[10px] bg-bg-muted border-b border-border text-[12px] text-text-muted shrink-0">
        <span className="font-mono text-[10px] text-accent uppercase tracking-[0.04em] px-[7px] py-[2px] rounded-[3px] bg-accent-bg border border-accent-border shrink-0">
          code = source
        </span>
        <span>
          Prompts are defined in code. Versions tracked via{' '}
          <code className="font-mono text-[11px] px-1 rounded border border-border bg-bg text-text">
            X-Spanlens-Prompt-Version
          </code>{' '}
          header.
        </span>
        <Link
          href="/docs/features/prompts"
          className="font-mono text-[11px] text-text hover:opacity-80 transition-opacity ml-auto"
        >
          View setup guide →
        </Link>
      </div>

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            { label: 'Prompts',              value: String(all.length)                                         },
            { label: 'Versions',             value: String(totalVersions)                                      },
            { label: `Calls · ${dateRange}`, value: totalCalls > 0 ? totalCalls.toLocaleString() : '—'        },
            { label: `Avg quality`,          value: avgQuality != null ? String(avgQuality) : '—'              },
            { label: `Spend · ${dateRange}`, value: totalSpend > 0 ? fmtUsd(totalSpend) : '—'                 },
          ].map((s, i) => (
            <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className="text-[24px] font-medium leading-none tracking-[-0.6px] text-text">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col gap-[6px] px-[22px] py-[10px] border-b border-border shrink-0">
      {/* Mobile search, shown only on small screens */}
      <div className="md:hidden flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[6px] bg-bg-elev">
        <span className="text-text-faint text-[14px] leading-none">⌕</span>
        <input
          key={`mobile-${search}`}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchInput('')
              updateQuery({ q: null })
            }
          }}
          placeholder="Search prompts…"
          className="flex-1 bg-transparent font-mono text-[12px] text-text-muted placeholder:text-text-faint focus:outline-none"
        />
        {searchInput && (
          <button type="button" onClick={() => { setSearchInput(''); updateQuery({ q: null }) }} className="text-text-faint hover:text-text transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-[6px] flex-wrap">
        <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
          {([['all', 'All', String(all.length)], ['ab', 'A/B', String(abCount)]] as [FilterType, string, string][]).map(([v, l, c]) => (
            <button
              key={v}
              type="button"
              onClick={() => updateQuery({ filter: v === 'all' ? null : v })}
              className={cn(
                'px-[10px] py-[3px] rounded-[3px] flex items-center gap-1.5 transition-colors',
                filter === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text',
              )}
            >
              {l}
              <span className={cn('text-[10px]', filter === v ? 'opacity-60' : 'text-text-faint')}>{c}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => updateQuery({ view: viewMode === 'all' ? 'active' : null })}
          className={cn(
            'flex items-center gap-1.5 px-[10px] py-[4px] rounded-[5px] border font-mono text-[11px] tracking-[0.03em] transition-colors',
            viewMode === 'active'
              ? 'border-border-strong bg-text text-bg'
              : 'border-border-strong bg-bg-elev text-text',
          )}
        >
          <span className={viewMode === 'active' ? 'opacity-60' : 'text-text-faint'}>☰</span>
          {' '}views ·{' '}
          <span className={viewMode === 'active' ? 'opacity-80' : 'text-text-muted'}>
            {viewMode === 'active' ? 'active only' : 'all prompts'}
          </span>
        </button>

        <div className="relative" ref={callsMenuRef}>
          <button
            type="button"
            onClick={() => setCallsMenuOpen((v) => !v)}
            className={cn(
              'font-mono text-[11px] px-[9px] py-[4px] border rounded-[5px] transition-colors',
              minCalls > 0
                ? 'border-border-strong bg-text text-bg'
                : 'border-border text-text-muted hover:text-text',
            )}
          >
            calls ≥ {minCalls === 0 ? 'all' : minCalls} ⌄
          </button>
          {callsMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded-[6px] shadow-lg overflow-hidden py-1 w-28">
              {([0, 1, 10, 100] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { updateQuery({ minCalls: n === 0 ? null : String(n) }); setCallsMenuOpen(false) }}
                  className={cn(
                    'w-full text-left px-[10px] py-[5px] font-mono text-[11px] transition-colors',
                    minCalls === n ? 'text-text bg-bg-muted' : 'text-text-muted hover:text-text hover:bg-bg-muted',
                  )}
                >
                  {n === 0 ? 'All' : `≥ ${n}`}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative" ref={dateMenuRef}>
          <button
            type="button"
            onClick={() => setDateMenuOpen((v) => !v)}
            className={cn(
              'font-mono text-[11px] px-[9px] py-[4px] border rounded-[5px] transition-colors',
              dateRange !== '24h'
                ? 'border-border-strong bg-text text-bg'
                : 'border-border text-text-muted hover:text-text',
            )}
          >
            {dateRange} ⌄
          </button>
          {dateMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded-[6px] shadow-lg overflow-hidden py-1 w-20">
              {(['24h', '7d', '30d'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { updateQuery({ range: r === '24h' ? null : r }); setDateMenuOpen(false) }}
                  className={cn(
                    'w-full text-left px-[10px] py-[5px] font-mono text-[11px] transition-colors',
                    dateRange === r ? 'text-text bg-bg-muted' : 'text-text-muted hover:text-text hover:bg-bg-muted',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="flex-1" />

        <div className="relative" ref={exportRef}>
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={filtered.length === 0}
            className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded-[5px] px-2.5 py-1 transition-colors disabled:opacity-40"
          >
            Export ▾
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded-md shadow-lg py-1 min-w-[110px]">
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportCsv() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >CSV</button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportJson() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >JSON</button>
            </div>
          )}
        </div>

        <span className="font-mono text-[11px] text-text-faint">
          {mounted ? (filtered.length === all.length ? `${all.length} prompts` : `${filtered.length} of ${all.length} prompts`) : ' '}
        </span>
      </div>
      </div>

      {/* Create form panel, outside scroll container so it stays pinned */}
      {formOpen && (
        <div className="px-[22px] py-[14px] bg-bg-elev border-b border-border-strong shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-text">Register prompt / version</span>
            <button type="button" onClick={() => setFormOpen(false)} className="text-text-faint hover:text-text transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="chatbot-system"
                className="w-full h-8 px-3 rounded-[4px] border border-border bg-bg font-mono text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
              />
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Content preview</label>
              <input
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="You are a helpful assistant…"
                className="w-full h-8 px-3 rounded-[4px] border border-border bg-bg font-mono text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
              />
            </div>
          </div>
          {formError && <p className="font-mono text-[11.5px] text-bad">{formError}</p>}
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] text-text-faint">Existing name → new version. New name → starts at v1.</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[4px] text-text-muted hover:text-text transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={createMutation.isPending}
                className="font-mono text-[11.5px] px-3 py-[5px] rounded-[4px] bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {createMutation.isPending ? 'Saving…' : 'Save version'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table: header + rows */}
      <div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-muted">
            <p className="text-[13px]">{search ? 'No prompts match your search.' : 'No prompts registered yet.'}</p>
            {!search && (
              <PermissionGate need="edit">
                <button type="button" onClick={() => setFormOpen(true)} className="font-mono text-[11.5px] px-3 py-[5px] rounded-[4px] bg-text text-bg font-medium hover:opacity-90 transition-opacity">
                  + Register first prompt
                </button>
              </PermissionGate>
            )}
          </div>
        ) : (
          <div className="min-w-[700px]">
            {/* Column headers, sticky so they stay visible on vertical scroll */}
            <div
              className="grid sticky top-[52px] z-10 font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[22px] py-[9px] bg-bg-muted border-b border-border"
              style={{ gridTemplateColumns: GRID }}
            >
              <span />
              <span>Prompt</span>
              <span>Active</span>
              <span>Versions</span>
              <span>Calls · {dateRange}</span>
              <span>Avg cost</span>
              <span>Avg lat</span>
              <span>Quality · {dateRange}</span>
              <span>A/B</span>
              <span className="text-right">Updated</span>
            </div>
            {filtered.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/prompts/${encodeURIComponent(p.name)}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  router.push(`/prompts/${encodeURIComponent(p.name)}`)
                }
              }}
              className={cn(
                'w-full grid items-center px-[22px] py-[11px] border-b border-border font-mono text-[12.5px] text-left hover:bg-bg-elev transition-colors group cursor-pointer focus:outline-none focus:bg-bg-elev',
              )}
              style={{ gridTemplateColumns: GRID }}
            >
              {/* Status dot */}
              <span>
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full block',
                  (p.stats?.calls ?? 0) > 0 ? 'bg-good' : 'bg-border',
                )} />
              </span>

              {/* Name */}
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-text font-sans text-[13px] font-medium truncate group-hover:text-accent transition-colors">
                  {p.name}
                </span>
              </span>

              {/* Active version */}
              <span className="text-text-muted">v{p.version}</span>

              {/* Version count — deep-link to the Versions tab on detail page. */}
              <span>
                <Link
                  href={`/prompts/${encodeURIComponent(p.name)}?tab=versions`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-text-muted hover:text-accent transition-colors"
                >
                  {p.versionCount ?? p.version}
                </Link>
              </span>

              {/* Calls */}
              <span className={cn(p.stats && p.stats.calls > 0 ? 'text-text' : 'text-text-faint')}>
                {p.stats?.calls ? p.stats.calls.toLocaleString() : '—'}
              </span>

              {/* Avg cost */}
              <span className={cn(p.stats?.avgCostUsd != null ? 'text-text' : 'text-text-faint')}>
                {p.stats?.avgCostUsd != null ? fmtUsd(p.stats.avgCostUsd) : '—'}
              </span>

              {/* Avg latency */}
              <span className={cn(p.stats?.avgLatencyMs != null ? 'text-text' : 'text-text-faint')}>
                {p.stats?.avgLatencyMs != null ? fmtMs(p.stats.avgLatencyMs) : '—'}
              </span>

              {/* Quality score */}
              <QualityBadge score={p.qualityScore} />

              {/* A/B badge — pulses while a test is running so the eye lands
                  on the active one in a list of many prompts. */}
              <span>
                {p.activeExperiment ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.05em] px-[5px] py-[2px] rounded-[3px] bg-accent-bg border border-accent-border text-accent animate-pulse">
                    <FlaskConical className="h-2.5 w-2.5" />
                    A/B
                  </span>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </span>

              {/* Updated date */}
              <span className="text-text-faint text-right text-[11px]">
                {formatDate(p.created_at)}
              </span>
            </div>
          ))}
          </div>
        )}
      </div>
    </div>
  )
}
