'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import {
  usePrompts,
  usePromptCompare,
  useCreatePromptVersion,
} from '@/lib/queries/use-prompts'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

function QualitySpark({ quality, warn }: { quality: number; warn: boolean }) {
  const bars = 8
  return (
    <div className="flex items-end gap-[1.5px] h-[14px]">
      {Array.from({ length: bars }).map((_, i) => {
        const h = 40 + Math.abs(Math.sin(i * 1.1)) * 50 - (warn ? i * 4 : 0)
        return (
          <div
            key={i}
            style={{ height: `${Math.max(10, Math.min(100, h))}%`, width: 5 }}
            className={cn(
              'rounded-[1px]',
              warn ? 'bg-accent opacity-80' : 'bg-border-strong',
              i === bars - 1 && (warn ? 'bg-accent' : 'bg-text'),
            )}
          />
        )
      })}
    </div>
  )
}

type FilterType = 'all' | 'ab'

const GRID = '20px 1.4fr 0.6fr 0.6fr 0.9fr 0.9fr 0.9fr 1.2fr 0.8fr 0.5fr'

export default function PromptsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const { data: prompts, isLoading } = usePrompts()
  const compareQuery = usePromptCompare(selected, 24 * 30)
  const createMutation = useCreatePromptVersion()

  const all = prompts ?? []
  const totalVersions = all.reduce((s, p) => s + p.version, 0)
  const filtered = all.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
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
            <button
              type="button"
              onClick={() => setFormOpen((v) => !v)}
              className="font-mono text-[11px] text-text px-[10px] py-[5px] border border-border-strong rounded-[5px] bg-bg-elev hover:bg-bg-muted transition-colors"
            >
              + register prompt
            </button>
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
          { label: 'Prompts',     value: String(all.length),    warn: false },
          { label: 'Versions',    value: String(totalVersions), warn: false },
          { label: 'A/B running', value: '—',                   warn: false },
          { label: 'Avg quality', value: '—',                   warn: false },
          { label: 'Spend · 24h', value: '—',                   warn: false },
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
          {([['all', 'All', String(all.length)], ['ab', 'A/B', '0']] as [FilterType, string, string][]).map(([v, l, c]) => (
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
          className="flex items-center gap-1.5 px-[10px] py-[4px] rounded-[5px] border border-border-strong bg-bg-elev font-mono text-[11px] text-text tracking-[0.03em]"
        >
          <span className="text-text-faint">☰</span> views · <span className="text-text-muted">all prompts</span> ⌄
        </button>
        {['owner · all ⌄', 'calls ≥ — ⌄', 'last 24h ⌄'].map((label) => (
          <span key={label} className="font-mono text-[11px] text-text-muted px-[9px] py-[4px] border border-border rounded-[5px]">
            {label}
          </span>
        ))}
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">{all.length} prompts</span>
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
              <button type="button" onClick={() => setFormOpen(true)} className="font-mono text-[11.5px] px-3 py-[5px] rounded-[4px] bg-text text-bg font-medium hover:opacity-90 transition-opacity">
                + Register first prompt
              </button>
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
              <span className="text-text-faint">—</span>
              <span className="text-text-faint">—</span>
              <span className="text-text-faint">—</span>
              <span className="flex items-center gap-2">
                <span className="text-text">—</span>
                <QualitySpark quality={90} warn={false} />
              </span>
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
