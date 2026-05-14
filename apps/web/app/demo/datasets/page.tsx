'use client'

import Link from 'next/link'
import { Database, Plus, Trash2, FileText, Hash } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DEMO_DATASETS } from '@/lib/demo-data'

function demoNotice(action: string) {
  return () => alert(`${action} — sign up to use this`)
}

export default function DemoDatasetsPage() {
  const list = DEMO_DATASETS
  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Datasets' }]}
        right={
          <button
            type="button"
            onClick={demoNotice('Creating datasets')}
            className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New dataset
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <Database className="h-3.5 w-3.5" />
          <span>
            Datasets are reusable test inputs for Evals. Import production requests or add items manually.
          </span>
        </div>

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
            <FileText className="h-10 w-10 text-text-faint" />
            <p className="font-mono text-[13px]">No datasets yet.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span className="flex-1">Name</span>
              <span className="w-[80px] text-right">Items</span>
              <span className="w-[140px] text-right">Created</span>
              <span className="w-[40px]" />
            </div>
            {list.map((d) => (
              <Link
                key={d.id}
                href={`/demo/datasets/${d.id}`}
                className="flex items-center px-[16px] py-[12px] border-b border-border last:border-0 hover:bg-bg-muted transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[13px] text-text font-medium truncate">{d.name}</p>
                  {d.description && (
                    <p className="font-mono text-[11px] text-text-faint truncate mt-0.5">{d.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 font-mono text-[11px] text-text-muted w-[80px] justify-end">
                  <Hash className="h-3 w-3" />
                  {d.item_count ?? 0}
                </div>
                <div className="font-mono text-[10.5px] text-text-faint w-[140px] text-right">
                  {new Date(d.created_at).toLocaleDateString()}
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); demoNotice('Deleting datasets')() }}
                  className="ml-3 text-text-faint hover:text-bad p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
