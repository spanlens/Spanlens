'use client'
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { DEMO_REQUESTS, DEMO_SECURITY_SUMMARY, DEMO_TIMESERIES } from '@/lib/demo-data'
import type { RequestRow } from '@/lib/queries/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'ok' | '4xx' | '5xx'
type SortField = 'created_at' | 'latency_ms' | 'cost_usd' | 'total_tokens'
type SortDir = 'asc' | 'desc'
type TimeRange = 'all' | 'today' | '7d' | '30d'

const STATUS_LABELS: Record<StatusFilter, string> = { all: 'All', ok: 'OK', '4xx': '4xx', '5xx': '5xx' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function relAge(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function fmtCost(n: number | null): string {
  if (n == null) return '—'
  return n < 0.001 ? '$' + n.toFixed(5) : '$' + n.toFixed(4)
}

function sparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  const pad = 2
  const step = (w - pad * 2) / (values.length - 1)
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ── InlineSpark ───────────────────────────────────────────────────────────────

function InlineSpark({
  values,
  w = 120,
  h = 18,
  stroke = 'var(--border-strong)',
}: {
  values: number[]
  w?: number
  h?: number
  stroke?: string
}) {
  const path = sparkPath(values, w, h)
  if (!path) return null
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block w-full">
      <path
        d={path}
        stroke={stroke}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── StatStrip (demo: uses DEMO_TIMESERIES + DEMO_REQUESTS) ───────────────────

function StatStrip() {
  const ts = DEMO_TIMESERIES
  const reqs = DEMO_REQUESTS
  const sparkReqs = ts.slice(-10).map((d) => d.requests)
  const sparkCost = ts.slice(-10).map((d) => d.cost)
  const sparkErrors = ts.slice(-10).map((d) => d.errors)

  const totalReqs = reqs.length
  const errReqs = reqs.filter((r) => r.status_code >= 400).length
  const errorRate = totalReqs > 0 ? (errReqs / totalReqs) * 100 : 0
  const avgLatency = Math.round(
    reqs.reduce((s, r) => s + r.latency_ms, 0) / Math.max(1, reqs.length),
  )
  const totalCost = reqs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)

  const summaryData = DEMO_SECURITY_SUMMARY
  const anomalyCount = summaryData.length

  const stats = [
    {
      label: 'Requests · 24h',
      value: totalReqs.toLocaleString(),
      spark: sparkReqs,
      warn: false,
      good: false,
    },
    {
      label: 'Avg latency',
      value: `${avgLatency}ms`,
      spark: [] as number[],
      warn: avgLatency > 1000,
      good: false,
    },
    {
      label: 'Spend · 24h',
      value: '$' + totalCost.toFixed(2),
      spark: sparkCost,
      warn: false,
      good: true,
    },
    {
      label: 'Error rate',
      value: errorRate.toFixed(1) + '%',
      spark: sparkErrors,
      warn: errorRate > 1,
      good: false,
    },
    {
      label: 'Anomalies',
      value: String(anomalyCount),
      spark: [] as number[],
      warn: anomalyCount > 0,
      good: false,
    },
  ]

  return (
    <div className="overflow-x-auto shrink-0 border-b border-border">
      <div className="grid grid-cols-5 min-w-[480px]">
        {stats.map((s, i) => (
          <div
            key={i}
            className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
              {s.label}
            </div>
            <div
              className={cn(
                'text-[24px] font-medium tracking-[-0.6px] leading-none mb-1.5',
                s.warn ? 'text-accent' : 'text-text',
              )}
            >
              {s.value}
            </div>
            <InlineSpark
              values={s.spark}
              stroke={
                s.warn ? 'var(--accent)' : s.good ? 'var(--good)' : 'var(--border-strong)'
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TrafficBars (demo: uses DEMO_TIMESERIES) ──────────────────────────────────

function TrafficBars() {
  const ts = DEMO_TIMESERIES

  const bars = useMemo(() => {
    if (!ts.length)
      return Array.from({ length: 30 }).map(() => ({
        h: 8,
        color: 'var(--border-strong)',
      }))
    const maxReq = Math.max(...ts.map((d) => d.requests), 1)
    return ts.slice(-30).map((d) => {
      const h = Math.max(4, (d.requests / maxReq) * 68)
      const color = d.errors > 0 ? 'var(--bad)' : 'var(--border-strong)'
      return { h, color }
    })
  }, [ts])

  const labels = useMemo(() => {
    const pts = ts.slice(-30)
    if (!pts.length) return ['—', '—', '—', '—', 'NOW']
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const first = pts[0]
    if (!first) return ['—', '—', '—', '—', 'NOW']
    return [
      fmt(first.date),
      fmt((pts[Math.floor(pts.length * 0.25)] ?? first).date),
      fmt((pts[Math.floor(pts.length * 0.5)] ?? first).date),
      fmt((pts[Math.floor(pts.length * 0.75)] ?? first).date),
      'NOW',
    ]
  }, [ts])

  return (
    <div className="px-[22px] py-[14px] border-b border-border shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[13.5px] font-medium">Traffic</span>
          <div className="flex gap-3 font-mono text-[10.5px] text-text-muted tracking-[0.03em]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-border-strong inline-block" /> OK
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bad inline-block" /> ERROR
            </span>
          </div>
        </div>
        <div className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">
          last 30d
        </div>
      </div>
      <div className="flex items-end gap-[2px] h-[72px]">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 rounded-[1px]"
            style={{ height: b.h, background: b.color }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-text-faint tracking-[0.04em] mt-2">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  )
}

// ── SortBtn ───────────────────────────────────────────────────────────────────

function SortBtn({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField
  label: string
  sortField: SortField
  sortDir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = sortField === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        'inline-flex items-center gap-0.5 hover:text-text transition-colors',
        active ? 'text-text' : '',
      )}
    >
      {label}
      <span className="ml-0.5 opacity-60">
        {active ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
      </span>
    </button>
  )
}

// ── RequestsTable ─────────────────────────────────────────────────────────────

const COL_FULL = '20px 1.6fr 0.9fr 0.75fr 0.7fr 0.8fr 0.6fr 0.5fr'

function RequestsTable({
  rows,
  selectedId,
  onSelect,
  sortField,
  sortDir,
  onSort,
  hasActiveFilters,
}: {
  rows: RequestRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  sortField: SortField
  sortDir: SortDir
  onSort: (f: SortField) => void
  hasActiveFilters: boolean
}) {
  return (
    <div className="overflow-auto flex-1 min-h-0">
      <div className="min-w-[700px]">
        {/* Header */}
        <div
          className="grid px-[22px] py-2.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint border-b border-border bg-bg-muted sticky top-0 z-10"
          style={{ gridTemplateColumns: COL_FULL }}
        >
          <span />
          <span>Model</span>
          <span>Provider</span>
          <SortBtn
            field="latency_ms"
            label="Latency"
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortBtn
            field="total_tokens"
            label="Tokens"
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortBtn
            field="cost_usd"
            label="Cost"
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
          />
          <span>Status</span>
          <span className="flex justify-end">
            <SortBtn
              field="created_at"
              label="Age"
              sortField={sortField}
              sortDir={sortDir}
              onSort={onSort}
            />
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-12 font-mono text-[12.5px] text-text-faint">
            {hasActiveFilters
              ? 'No requests match the current filters.'
              : 'No requests found.'}
          </div>
        ) : (
          rows.map((req) => {
            const isErr = req.status_code >= 400
            const isSelected = req.id === selectedId
            return (
              <div
                key={req.id}
                onClick={() => onSelect(req.id)}
                className={cn(
                  'grid px-[22px] py-2.5 border-b border-border font-mono text-[12.5px] items-center cursor-pointer transition-colors border-l-2',
                  isSelected
                    ? 'bg-bg-muted border-l-accent'
                    : isErr
                      ? 'bg-accent-bg border-l-transparent hover:bg-accent-bg/80'
                      : 'border-l-transparent hover:bg-bg-muted',
                )}
                style={{
                  gridTemplateColumns: COL_FULL,
                  paddingLeft: isSelected ? 20 : 22,
                }}
              >
                <span>
                  {isErr && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                  )}
                </span>
                <span className="text-text truncate pr-2">{req.model}</span>
                <span className="text-text-muted">{req.provider}</span>
                <span className={isErr ? 'text-accent' : 'text-text'}>
                  {req.latency_ms}ms
                </span>
                <span className="text-text-muted">{req.total_tokens.toLocaleString()}</span>
                <span className="text-text">{fmtCost(req.cost_usd)}</span>
                <span className={isErr ? 'text-bad' : 'text-good'}>{req.status_code}</span>
                <span
                  className="text-text-faint text-right"
                  title={new Date(req.created_at).toLocaleString()}
                >
                  {relAge(req.created_at)}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DemoRequestsPage() {
  const router = useRouter()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [modelInput, setModelInput] = useState('')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 400)
  }, [])

  const now = Date.now()

  const filtered = useMemo(() => {
    let rows = [...DEMO_REQUESTS]

    // Time range
    if (timeRange === 'today') {
      const startOfDay = new Date()
      startOfDay.setUTCHours(0, 0, 0, 0)
      rows = rows.filter((r) => new Date(r.created_at).getTime() >= startOfDay.getTime())
    } else if (timeRange === '7d') {
      const cutoff = now - 7 * 24 * 3_600_000
      rows = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)
    } else if (timeRange === '30d') {
      const cutoff = now - 30 * 24 * 3_600_000
      rows = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)
    }

    // Status
    if (statusFilter === 'ok') rows = rows.filter((r) => r.status_code < 400)
    else if (statusFilter === '4xx')
      rows = rows.filter((r) => r.status_code >= 400 && r.status_code < 500)
    else if (statusFilter === '5xx') rows = rows.filter((r) => r.status_code >= 500)

    // Provider
    if (providerFilter !== 'all') rows = rows.filter((r) => r.provider === providerFilter)

    // Model search
    const modelTrim = modelInput.trim().toLowerCase()
    if (modelTrim) rows = rows.filter((r) => r.model.toLowerCase().includes(modelTrim))

    // Sort
    rows.sort((a, b) => {
      let av: number
      let bv: number
      if (sortField === 'created_at') {
        av = new Date(a.created_at).getTime()
        bv = new Date(b.created_at).getTime()
      } else if (sortField === 'cost_usd') {
        av = a.cost_usd ?? 0
        bv = b.cost_usd ?? 0
      } else {
        av = a[sortField] as number
        bv = b[sortField] as number
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })

    return rows
  }, [statusFilter, providerFilter, modelInput, timeRange, sortField, sortDir, now])

  const hasActiveFilters =
    statusFilter !== 'all' ||
    providerFilter !== 'all' ||
    modelInput.trim() !== '' ||
    timeRange !== 'all'

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
    setSelectedId(null)
  }

  function handleSelect(id: string) {
    router.push(`/demo/requests/${id}`)
  }

  function clearFilters() {
    setStatusFilter('all')
    setProviderFilter('all')
    setModelInput('')
    setTimeRange('all')
    setSelectedId(null)
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Requests' }]}
        right={null}
      />

      <StatStrip />
      <TrafficBars />

      {/* Filter row */}
      <div className="flex items-center gap-1.5 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        {/* Time range */}
        <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
          {(['all', 'today', '7d', '30d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => {
                setTimeRange(r)
                setSelectedId(null)
              }}
              className={cn(
                'px-[10px] py-[5px]',
                timeRange === r
                  ? 'bg-text text-bg'
                  : 'text-text-muted hover:text-text transition-colors',
              )}
            >
              {r === 'all' ? 'All time' : r === 'today' ? 'Today' : r}
            </button>
          ))}
        </div>

        {/* Status segmented */}
        <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
          {(['all', 'ok', '4xx', '5xx'] as StatusFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                setStatusFilter(v)
                setSelectedId(null)
              }}
              className={cn(
                'px-[10px] py-[5px] inline-flex items-center gap-1.5',
                statusFilter === v
                  ? 'bg-text text-bg'
                  : 'text-text-muted hover:text-text transition-colors',
              )}
            >
              {STATUS_LABELS[v]}
              {statusFilter === v && (
                <span className="opacity-60 text-bg">{filtered.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Provider select */}
        <select
          value={providerFilter}
          onChange={(e) => {
            setProviderFilter(e.target.value)
            setSelectedId(null)
          }}
          className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong transition-colors focus:outline-none appearance-none cursor-pointer"
        >
          <option value="all">All providers</option>
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
          <option value="google">google</option>
        </select>

        {/* Model input */}
        <input
          type="text"
          placeholder="Model…"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setModelInput('')
          }}
          className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong focus:border-border-strong transition-colors outline-none w-28 placeholder:text-text-faint"
        />

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="font-mono text-[10.5px] px-[9px] py-[5px] border border-border rounded-[5px] text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
          >
            Clear filters
          </button>
        )}

        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">
          Showing {filtered.length} of {DEMO_REQUESTS.length}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="font-mono text-[10.5px] px-[9px] py-[4px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors"
        >
          {refreshing ? '↻ …' : '↻'}
        </button>
      </div>

      {/* Table */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <RequestsTable
          rows={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          hasActiveFilters={hasActiveFilters}
        />

        {/* Pagination (demo: single page) */}
        <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0">
          <span className="font-mono text-[11px] text-text-faint">
            Page 1 · {filtered.length.toLocaleString()} total
          </span>
          <div className="flex gap-1.5">
            <button
              disabled
              className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30"
            >
              ← Prev
            </button>
            <button
              disabled
              className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
