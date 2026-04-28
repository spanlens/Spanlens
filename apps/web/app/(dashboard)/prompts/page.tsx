'use client'
import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import {
  usePrompts,
  usePromptCompare,
  useCreatePromptVersion,
} from '@/lib/queries/use-prompts'
import { Topbar } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { cn } from '@/lib/utils'

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

type FilterType = 'all' | 'ab'
type MinCalls = 0 | 1 | 10 | 100
type DateRange = '24h' | '7d' | '30d'
type ViewMode = 'all' | 'active'

const GRID = '20px 1.4fr 0.6fr 0.6fr 0.9fr 0.9fr 0.9fr 1.2fr 0.8fr 0.5fr'

export default function PromptsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [minCalls, setMinCalls] = useState<MinCalls>(0)
  const [callsMenuOpen, setCallsMenuOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>('24h')
  const [dateMenuOpen, setDateMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const callsMenuRef = useRef<HTMLDivElement>(null)
  const dateMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!callsMenuOpen && !dateMenuOpen) return
    const handler = (e: PointerEvent) => {
      if (callsMenuOpen && !callsMenuRef.current?.contains(e.target as Node)) setCallsMenuOpen(false)
      if (dateMenuOpen && !dateMenuRef.current?.contains(e.target as Node)) setDateMenuOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [callsMenuOpen, dateMenuOpen])

  const { data: prompts, isLoading } = usePrompts()
  const compareQuery = usePromptCompare(selected, 24 * 30)
  const createMutation = useCreatePromptVersion()

  const all = prompts ?? []
  const totalVersions = all.reduce((s, p) => s + p.version, 0)
  const totalCalls24h = all.reduce((s, p) => s + (p.stats?.calls ?? 0), 0)
  const totalSpend24h = all.reduce((s, p) => s + (p.stats?.totalCostUsd ?? 0), 0)
  const abCount = all.filter((p) => p.version > 1).length
  const filtered = all.filter(
    (p) =>
      (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'all' || p.version > 1) &&
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

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Prompts' }]}
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[6px] bg-bg-elev w-[280px]">
              <span className="text-text-faint text-[14px] leading-none">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prompts…"
                className="flex-1 bg-transparent font-mono text-[12px] text-text-muted placeholder:text-text-faint focus:outline-none"
              />
              <span className="font-mono text-[10px] text-text-faint border border-border rounded-[3px] px-[5px] py-[1px]">⌘K</span>
            </div>
            <PermissionGate need="edit">
              <button
                type="button"
                onClick={() => setFormOpen((v) => !v)}
                className="font-mono text-[11px] text-text px-[10px] py-[5px] border border-border-strong rounded-[5px] bg-bg-elev hover:bg-bg-muted transition-colors"
              >
                + register prompt
              </button>
            </PermissionGate>
          </div>
        }
      />

      {/* Info banner */}
      <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border text-[12.5px] text-text-muted shrink-0">
        <span className="font-mono text-[10px] text-accent uppercase tracking-[0.04em] px-[7px] py-[2px] rounded-[3px] bg-accent-bg border border-accent-border">
          code = source
        </span>
        Prompts are defined in code. Spanlens observes versions via the{' '}
        <code className="font-mono text-[11.5px] px-1 rounded border border-border bg-bg text-text">
          X-Prompt-Version
        </code>{' '}
        header on each SDK call.
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text cursor-pointer hover:opacity-80 transition-opacity">
          View setup guide →
        </span>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {[
          { label: 'Prompts',     value: String(all.length),                                   warn: false },
          { label: 'Versions',    value: String(totalVersions),                                warn: false },
          { label: 'Calls · 24h', value: totalCalls24h > 0 ? totalCalls24h.toLocaleString() : '—', warn: false },
          { label: 'Avg quality', value: '—',                                                  warn: false },
          { label: 'Spend · 24h', value: totalSpend24h > 0 ? fmtUsd(totalSpend24h) : '—',      warn: false },
        ].map((s, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <span className="text-[24px] font-medium leading-none tracking-[-0.6px] text-text">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-[6px] px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
          {([['all', 'All', String(all.length)], ['ab', 'A/B', String(abCount)]] as [FilterType, string, string][]).map(([v, l, c]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
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
          onClick={() => setViewMode((v) => (v === 'all' ? 'active' : 'all'))}
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
                  onClick={() => { setMinCalls(n); setCallsMenuOpen(false) }}
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
                  onClick={() => { setDateRange(r); setDateMenuOpen(false) }}
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
        <span className="font-mono text-[11px] text-text-faint">
          {filtered.length === all.length ? `${all.length} prompts` : `${filtered.length} of ${all.length} prompts`}
        </span>
      </div>

      {/* Column header */}
      <div
        className="grid border-b border-border bg-bg-muted shrink-0 font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[22px] py-[9px]"
        style={{ gridTemplateColumns: GRID }}
      >
        <span />
        <span>Prompt</span>
        <span>Active</span>
        <span>Versions</span>
        <span>Calls · 24h</span>
        <span>Avg cost</span>
        <span>Avg lat</span>
        <span>Quality · 7d</span>
        <span>Owner</span>
        <span className="text-right">Updated</span>
      </div>

      {/* Create form panel */}
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

      {/* Table rows */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
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
          filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(selected === p.name ? null : p.name)}
              className={cn(
                'w-full grid items-center px-[22px] py-[11px] border-b border-border font-mono text-[12.5px] text-left hover:bg-bg-elev transition-colors',
                selected === p.name && 'bg-bg-elev border-l-2 border-l-accent',
              )}
              style={{ gridTemplateColumns: GRID }}
            >
              <span>
                <span className="w-1.5 h-1.5 rounded-full bg-good block" />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-text font-sans text-[13px] font-medium">{p.name}</span>
              </span>
              <span className="text-text">v{p.version}</span>
              <span className="text-text-muted">{p.version}</span>
              <span className={cn(p.stats && p.stats.calls > 0 ? 'text-text' : 'text-text-faint')}>
                {p.stats?.calls ? p.stats.calls.toLocaleString() : '—'}
              </span>
              <span className={cn(p.stats?.avgCostUsd != null ? 'text-text' : 'text-text-faint')}>
                {p.stats?.avgCostUsd != null ? fmtUsd(p.stats.avgCostUsd) : '—'}
              </span>
              <span className={cn(p.stats?.avgLatencyMs != null ? 'text-text' : 'text-text-faint')}>
                {p.stats?.avgLatencyMs != null ? fmtMs(p.stats.avgLatencyMs) : '—'}
              </span>
              <span className="text-text-faint">—</span>
              <span className="text-text-muted font-sans">—</span>
              <span className="text-text-faint text-right text-[11px]">
                {new Date(p.created_at).toLocaleDateString()}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Compare drawer */}
      {selected !== null && (
        <div className="border-t border-border-strong bg-bg-elev shrink-0 max-h-[280px] overflow-auto">
          <div className="flex items-center justify-between px-[22px] py-3 border-b border-border sticky top-0 bg-bg-elev z-10">
            <span className="text-[13px] font-medium text-text">
              Version comparison — <span className="font-mono text-text-muted">{selected}</span>
            </span>
            <button type="button" onClick={() => setSelected(null)} className="text-text-faint hover:text-text transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          {compareQuery.isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-8 bg-bg rounded animate-pulse" />)}
            </div>
          ) : (compareQuery.data ?? []).length === 0 ? (
            <div className="px-[22px] py-8 text-center font-mono text-[12.5px] text-text-muted">
              No request data for this prompt in the last 30 days.{' '}
              Tag calls with{' '}
              <code className="font-mono bg-bg px-1 rounded text-[11px]">withPromptVersion(&apos;{selected}@latest&apos;)</code>
            </div>
          ) : (
            <div>
              <div
                className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[22px] py-[8px] bg-bg border-b border-border"
                style={{ gridTemplateColumns: '100px 80px 100px 80px 100px 100px' }}
              >
                <span>Version</span>
                <span className="text-right">Samples</span>
                <span className="text-right">Avg lat</span>
                <span className="text-right">Error %</span>
                <span className="text-right">Avg cost</span>
                <span className="text-right">Total cost</span>
              </div>
              {(compareQuery.data ?? []).map((m) => (
                <div
                  key={m.promptVersionId}
                  className="grid items-center px-[22px] py-[9px] border-b border-border last:border-0 font-mono text-[12px]"
                  style={{ gridTemplateColumns: '100px 80px 100px 80px 100px 100px' }}
                >
                  <span className="text-text-muted">v{m.version}</span>
                  <span className="text-right text-text-muted">{m.sampleCount}</span>
                  <span className="text-right text-text-muted">{fmtMs(m.avgLatencyMs)}</span>
                  <span className="text-right text-text-muted">{(m.errorRate * 100).toFixed(1)}%</span>
                  <span className="text-right text-text-muted">{fmtUsd(m.avgCostUsd)}</span>
                  <span className="text-right text-text-muted">{fmtUsd(m.totalCostUsd)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
