'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, FlaskConical, Search } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { DEMO_EXPERIMENTS } from '@/lib/demo-data'
import { cn } from '@/lib/utils'

function statusColor(status: string): string {
  if (status === 'running') return 'bg-accent'
  if (status === 'completed') return 'bg-good'
  return 'bg-text-faint'
}

const STATUS_FILTERS = ['all', 'running', 'completed', 'draft'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function DemoExperimentsPage() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const counts = useMemo(() => {
    let running = 0
    let completed = 0
    for (const e of DEMO_EXPERIMENTS) {
      if (e.status === 'running') running += 1
      else if (e.status === 'completed') completed += 1
    }
    return { total: DEMO_EXPERIMENTS.length, running, completed }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return DEMO_EXPERIMENTS.filter((e) => {
      if (status !== 'all' && e.status !== status) return false
      if (q && !(e.name.toLowerCase().includes(q) || (e.description?.toLowerCase().includes(q) ?? false))) {
        return false
      }
      return true
    })
  }, [query, status])

  const isFiltered = query.trim().length > 0 || status !== 'all'

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Experiments' }]}
          right={
            <div className="flex items-center gap-2">
              <DemoExportButton
                base="experiments"
                rows={filtered}
                columns={[
                  { header: 'Name', value: (e) => e.name },
                  { header: 'Status', value: (e) => e.status },
                  { header: 'Description', value: (e) => e.description ?? '' },
                ]}
              />
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px] rounded-[5px] border border-border bg-bg-elev text-text-muted opacity-60 cursor-not-allowed"
                title="Disabled in demo"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New experiment</span>
              </button>
            </div>
          }
        />
      </div>

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-3 min-w-[360px]">
          {[
            { label: 'Experiments', value: String(counts.total) },
            { label: 'Running', value: String(counts.running) },
            { label: 'Completed', value: String(counts.completed) },
          ].map((s, i) => (
            <div key={s.label} className={cn('px-[18px] py-[14px]', i < 2 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <div className="text-[20px] font-medium tracking-[-0.4px] text-text">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1">
        <div className="px-6 py-5 max-w-3xl">
          <p className="text-[13px] text-text-muted mb-4">
            A/B test prompts, models, or params. Each experiment splits live traffic and compares quality + cost.
          </p>

          {/* Search + status filter */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[180px] max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder="Search experiments…"
                className="w-full pl-8 pr-8 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="flex border border-border rounded-[6px] overflow-hidden">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    'font-mono text-[11px] px-[10px] py-[6px] border-r border-border last:border-r-0 transition-colors capitalize',
                    s === status ? 'bg-bg-elev text-text font-medium' : 'bg-transparent text-text-muted hover:text-text',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="border border-border rounded-[8px] px-5 py-12 text-center bg-bg-elev">
              <p className="text-[13px] text-text mb-1.5">No experiments match your filters</p>
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setStatus('all')
                  }}
                  className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((exp) => (
                <Link
                  key={exp.id}
                  href={`/demo/experiments/${exp.id}`}
                  className="block border border-border rounded-[8px] px-5 py-4 bg-bg-elev hover:border-border-strong transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FlaskConical className="h-4 w-4 text-text-faint shrink-0" />
                      <span className="text-[14px] font-medium text-text truncate">{exp.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('inline-block w-2 h-2 rounded-full', statusColor(exp.status))} />
                      <span className="font-mono text-[11px] text-text-muted">{exp.status}</span>
                    </div>
                  </div>
                  {exp.description && (
                    <p className="text-[12.5px] text-text-muted ml-[26px]">{exp.description}</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
