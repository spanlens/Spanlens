'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DEMO_DATASET_DETAILS } from '@/lib/demo-data'
import { cn, formatDate } from '@/lib/utils'
import {
  Board,
  TOPBAR_BLEED,
  SummaryStrip,
  SummaryCell,
  TableCard,
  TableHead,
  Th,
  ROW,
  Well,
} from '../../../(dashboard)/_board/surfaces'
import { StatusPill } from '@/components/ui/primitives'
import type { DatasetItem } from '@/lib/queries/use-datasets'

/* Same column template as the live detail board, so the demo reads at parity. */
const ITEM_GRID: React.CSSProperties = {
  gridTemplateColumns: '52px minmax(180px,1.3fr) minmax(180px,1.3fr) 104px 52px',
}

function ItemRow({ item, index }: { item: DatasetItem; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const inputPreview = item.input.messages?.[0]?.content
    ?? JSON.stringify(item.input.variables ?? {})
  const hasExpected = !!item.expected_output

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Outer container is a div (not <button>) so the inner Delete <button>
          doesn't violate HTML's "no nested buttons" rule. Keyboard activation
          preserved via role + Enter/Space. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className={cn(
          ROW,
          'grid cursor-pointer items-center gap-3 border-b-0 text-left transition-colors hover:bg-bg-muted',
        )}
        style={ITEM_GRID}
      >
        <span className="font-mono text-[12px] tabular-nums text-text-muted">
          {String(index + 1).padStart(3, '0')}
        </span>
        <span className="truncate font-mono text-[12px] text-text">{inputPreview}</span>
        <span className="truncate font-mono text-[12px] text-text-muted">
          {item.expected_output ?? ''}
        </span>
        <span>
          {hasExpected ? (
            <StatusPill variant="good">scorable</StatusPill>
          ) : (
            <span title="No expected output, won't be evaluated">
              <StatusPill variant="warn">no output</StatusPill>
            </span>
          )}
        </span>
        <span className="flex justify-end">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); alert('Deleting items, sign up to use this') }}
            aria-label="Delete item"
            className="p-1 text-text-faint transition-colors hover:text-bad"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border bg-bg-muted px-[18px] py-3">
          <div>
            <p className="micro-label mb-1">Input</p>
            <Well>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] text-text-muted">
                {JSON.stringify(item.input, null, 2)}
              </pre>
            </Well>
          </div>
          {item.expected_output && (
            <div>
              <p className="micro-label mb-1">Expected output</p>
              <Well>
                <pre className="whitespace-pre-wrap font-mono text-[11.5px] text-text-muted">
                  {item.expected_output}
                </pre>
              </Well>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function DemoDatasetDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const ds = DEMO_DATASET_DETAILS[id]

  if (!ds) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Datasets', href: '/demo/datasets' }, { label: 'Not found' }]} />
        </div>
        <Board>
          <div className="card-surface rounded-card flex h-64 items-center justify-center gap-2 text-[13px] text-text-muted">
            Dataset not found.
            <Link href="/demo/datasets" className="text-accent underline underline-offset-2">
              Back to list
            </Link>
          </div>
        </Board>
      </div>
    )
  }

  const items = ds.items
  const withOutput = items.filter((i) => !!i.expected_output).length

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[
            { label: 'Demo', href: '/demo/dashboard' },
            { label: 'Datasets', href: '/demo/datasets' },
            { label: ds.name },
          ]}
          right={
            <button
              type="button"
              onClick={() => alert('Adding items, sign up to use this')}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </button>
          }
        />
      </div>
      {/* The breadcrumb already carries the dataset name, so the h1 stays for
          the document outline and screen readers only. */}
      <h1 className="sr-only">{ds.name}</h1>

      <Board>
        {/* `flex-1` spreads the cells across the card the way the frame
            distributes its six, so the hairlines land on even intervals. */}
        <SummaryStrip>
          <SummaryCell label="Items" className="flex-1 basis-[140px]">
            {items.length.toLocaleString('en-US')}
          </SummaryCell>
          <SummaryCell label="With expected output" className="flex-1 basis-[140px]">
            {withOutput.toLocaleString('en-US')}
          </SummaryCell>
          <SummaryCell label="Created" className="flex-1 basis-[140px]">
            {formatDate(ds.created_at)}
          </SummaryCell>
        </SummaryStrip>

        {ds.description && (
          <div className="card-surface rounded-card px-5 py-3.5 text-[12.5px] leading-[1.6] text-text-muted">
            {ds.description}
          </div>
        )}

        {/* The row grid is wider than a narrow viewport, so the card scrolls
            its own table sideways rather than the page. */}
        <TableCard>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <TableHead>
                <div className="grid items-center gap-3" style={ITEM_GRID}>
                  <Th>#</Th>
                  <Th>Input</Th>
                  <Th>Expected</Th>
                  <Th>Result</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </div>
              </TableHead>
              {items.map((item, i) => <ItemRow key={item.id} item={item} index={i} />)}
            </div>
          </div>
        </TableCard>
      </Board>
    </div>
  )
}
