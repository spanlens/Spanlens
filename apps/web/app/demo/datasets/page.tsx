'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Database, Plus, Search } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { DEMO_DATASETS } from '@/lib/demo-data'
import { cn, formatDate } from '@/lib/utils'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  CONTROL,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../../(dashboard)/_board/surfaces'

/* Same column template as the live board, so the demo reads at parity. */
const DATASET_GRID: React.CSSProperties = {
  gridTemplateColumns: 'minmax(220px,1fr) 88px 132px',
}

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
  const lastCreated = useMemo(
    () => DEMO_DATASETS.map((ds) => ds.created_at).sort().slice(-1)[0] ?? null,
    [],
  )
  const isFiltered = query.trim().length > 0

  return (
    <div>
      <div className={TOPBAR_BLEED}>
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
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg opacity-60"
                title="Disabled in demo"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New dataset</span>
              </button>
            </div>
          }
        />
      </div>
      <h1 className="sr-only">Datasets</h1>

      <Board>
        <FilterBar>
          <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
            <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search datasets"
              aria-label="Search datasets by name or description"
              className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
              >
                Clear
              </button>
            )}
          </div>
          <span className="font-mono text-[11px] text-text-faint">
            {isFiltered
              ? `${filtered.length} of ${DEMO_DATASETS.length}`
              : `${DEMO_DATASETS.length} datasets`}
          </span>
        </FilterBar>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Datasets" value={DEMO_DATASETS.length} foot="reusable test inputs" />
          <StatCard
            label="Items"
            value={totalItems.toLocaleString('en-US')}
            foot="across all datasets"
          />
          {/* Opts back out of the tile's tabular figures: a date is not a
              number, and the fixed advance stretches the space at its comma. */}
          <StatCard
            label="Last created"
            value={
              <span className="[font-variant-numeric:normal]">
                {lastCreated ? formatDate(lastCreated) : '—'}
              </span>
            }
            foot="newest in the workspace"
          />
        </div>

        <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
          <Database className="h-3.5 w-3.5 shrink-0" />
          <span>
            Datasets capture request and response pairs for offline evals and regression testing.
          </span>
          <Link
            href="/docs/features/datasets"
            className="ml-auto text-text transition-opacity hover:opacity-80"
          >
            How datasets work →
          </Link>
        </div>

        {filtered.length === 0 ? (
          <div className="card-surface rounded-card flex h-40 flex-col items-center justify-center gap-3 text-text-muted">
            <p className="text-[12.5px]">No datasets match the current search.</p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          /* The row grid is wider than a narrow viewport, so the card scrolls
             its own table sideways rather than the page. */
          <TableCard>
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <TableHead>
                  <div className="grid items-center gap-3" style={DATASET_GRID}>
                    <Th>Dataset</Th>
                    <Th>Items</Th>
                    <Th>Created</Th>
                  </div>
                </TableHead>
                {filtered.map((ds) => (
                  <Link
                    key={ds.id}
                    href={`/demo/datasets/${ds.id}`}
                    className={cn(ROW, 'grid items-center gap-3 transition-colors hover:bg-bg-muted')}
                    style={DATASET_GRID}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12px] text-text">{ds.name}</p>
                      {ds.description && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-text-faint">
                          {ds.description}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-[12px] tabular-nums text-text-muted">
                      {(ds.item_count ?? 0).toLocaleString('en-US')}
                    </span>
                    <span className="font-mono text-[12px] text-text-muted">
                      {formatDate(ds.created_at)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </TableCard>
        )}
      </Board>
    </div>
  )
}
