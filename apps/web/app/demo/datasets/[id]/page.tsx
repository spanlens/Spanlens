'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DEMO_DATASET_DETAILS } from '@/lib/demo-data'
import type { DatasetItem } from '@/lib/queries/use-datasets'

function ItemRow({ item }: { item: DatasetItem }) {
  const [expanded, setExpanded] = useState(false)
  const inputPreview = item.input.messages?.[0]?.content
    ?? JSON.stringify(item.input.variables ?? {})

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 px-[16px] py-[11px] hover:bg-bg-muted text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[12px] text-text truncate">{inputPreview}</p>
          {item.expected_output && (
            <p className="font-mono text-[11px] text-text-faint truncate mt-0.5">
              → {item.expected_output}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); alert('Deleting items, sign up to use this') }}
          className="text-text-faint hover:text-bad shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </button>
      {expanded && (
        <div className="bg-bg-muted/50 px-[16px] py-[10px] border-t border-border space-y-2 font-mono text-[11.5px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1">Input</p>
            <pre className="text-text-muted whitespace-pre-wrap break-all">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          </div>
          {item.expected_output && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1">Expected output</p>
              <pre className="text-text-muted whitespace-pre-wrap">{item.expected_output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function DemoDatasetDetail({ params }: { params: { id: string } }) {
  const { id } = params
  const ds = DEMO_DATASET_DETAILS[id]

  if (!ds) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
        <Topbar crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Datasets', href: '/demo/datasets' }, { label: 'Not found' }]} />
        <div className="flex items-center justify-center h-64 text-text-muted font-mono text-[13px]">
          Dataset not found.{' '}
          <Link href="/demo/datasets" className="ml-2 text-accent underline">Back to list</Link>
        </div>
      </div>
    )
  }

  const items = ds.items
  const withOutput = items.filter((i) => !!i.expected_output).length

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
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
            className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="px-[22px] py-[12px] border-b border-border space-y-1">
          <p className="font-mono text-[15px] text-text font-medium">{ds.name}</p>
          {ds.description && (
            <p className="font-mono text-[12px] text-text-muted">{ds.description}</p>
          )}
          <div className="flex items-center gap-4 font-mono text-[11px] text-text-faint pt-1">
            <span>{items.length} items</span>
            <span>{withOutput} with expected output</span>
          </div>
        </div>
        {items.map((item) => <ItemRow key={item.id} item={item} />)}
      </div>
    </div>
  )
}
