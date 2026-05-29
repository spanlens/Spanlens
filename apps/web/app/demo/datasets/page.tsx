'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Database, Plus, Search } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { DEMO_DATASETS } from '@/lib/demo-data'
import { cn } from '@/lib/utils'

export default function DemoDatasetsPage() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return DEMO_DATASETS
    return DEMO_DATASETS.filter(
      (ds) =>
        ds.name.toLowerCase().includes(q) ||
        (ds.description?.toLowerCase().includes(q) ?? false),
    )
  }, [query])

  const totalItems = useMemo(
    () => DEMO_DATASETS.reduce((a, ds) => a + (ds.item_count ?? 0), 0),
    [],
  )
  const isFiltered = query.trim().length > 0

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Datasets' }]}
          right={
            <div className="flex items-center gap-2">
              <DemoExportButton
                base="datasets"
                rows={filtered}
                columns={[
                  { header: 'Name', value: (ds) => ds.name },
                  { header: 'Items', value: (ds) => ds.item_count ?? 0 },
                  { header: 'Description', value: (ds) => ds.description ?? '' },
                ]}
              />
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px] rounded-[5px] border border-border bg-bg-elev text-text-muted opacity-60 cursor-not-allowed"
                title="Disabled in demo"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New dataset</span>
              </button>
            </div>
          }
        />
      </div>

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-2 min-w-[280px]">
          {[
            { label: 'Datasets', value: String(DEMO_DATASETS.length) },
            { label: 'Total items', value: totalItems.toLocaleString() },
          ].map((s, i) => (
            <div key={s.label} className={cn('px-[18px] py-[14px]', i < 1 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <div className="text-[20px] font-medium tracking-[-0.4px] text-text">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1">
        <div className="px-6 py-5 max-w-3xl">
          <p className="text-[13px] text-text-muted mb-4">
            Datasets capture request/response pairs for offline evals and regression testing.
          </p>

          {/* Search */}
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder="Search datasets…"
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
            {isFiltered && (
              <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">
                {filtered.length} of {DEMO_DATASETS.length}
              </span>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="border border-border rounded-[8px] px-5 py-12 text-center bg-bg-elev">
              <p className="text-[13px] text-text mb-1.5">No datasets match your search</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((ds) => (
                <Link
                  key={ds.id}
                  href={`/demo/datasets/${ds.id}`}
                  className="block border border-border rounded-[8px] px-5 py-4 bg-bg-elev hover:border-border-strong transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Database className="h-4 w-4 text-text-faint" />
                      <span className="text-[14px] font-medium text-text">{ds.name}</span>
                    </div>
                    <span className="font-mono text-[11px] text-text-faint">{ds.item_count ?? 0} items</span>
                  </div>
                  {ds.description && (
                    <p className="text-[12.5px] text-text-muted mt-2 ml-[26px]">{ds.description}</p>
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
