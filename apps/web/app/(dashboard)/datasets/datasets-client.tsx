'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Database, Plus, Trash2, FileText, Hash } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useDatasets,
  useCreateDataset,
  useDeleteDataset,
  type Dataset,
} from '@/lib/queries/use-datasets'

// ── New dataset dialog ───────────────────────────────────────────────────────

function NewDatasetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateDataset()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    try {
      const trimmedDesc = description.trim()
      await create.mutateAsync({
        name: name.trim(),
        ...(trimmedDesc && { description: trimmedDesc }),
      })
      onClose()
      setName(''); setDescription('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New dataset</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 mt-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer support golden set"
              required
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this dataset covers…"
              className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-none"
            />
          </div>
          {error && <p className="font-mono text-[11.5px] text-bad">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[11.5px] px-3 py-[6px] border border-border rounded-[5px] text-text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 disabled:opacity-40"
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Dataset row ──────────────────────────────────────────────────────────────

function DatasetRow({ dataset }: { dataset: Dataset }) {
  const deleteMutation = useDeleteDataset()

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete dataset "${dataset.name}"?`)) return
    void deleteMutation.mutateAsync(dataset.id)
  }

  return (
    <Link
      href={`/datasets/${dataset.id}`}
      className="flex items-center px-[16px] py-[12px] border-b border-border last:border-0 hover:bg-bg-muted transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[13px] text-text font-medium truncate">{dataset.name}</p>
        {dataset.description && (
          <p className="font-mono text-[11px] text-text-faint truncate mt-0.5">
            {dataset.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 font-mono text-[11px] text-text-muted w-[80px] justify-end">
        <Hash className="h-3 w-3" />
        {dataset.item_count ?? 0}
      </div>
      <div className="font-mono text-[10.5px] text-text-faint w-[140px] text-right">
        {new Date(dataset.created_at).toLocaleDateString()}
      </div>
      <button
        type="button"
        onClick={handleDelete}
        className="ml-3 text-text-faint hover:text-bad transition-colors p-1"
        aria-label="Delete dataset"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </Link>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function DatasetsClient() {
  const datasets = useDatasets()
  const [newOpen, setNewOpen] = useState(false)
  const list = datasets.data ?? []

  return (
    <div className="flex flex-col h-full">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Datasets' }]}
        right={
          <button
            type="button"
            onClick={() => setNewOpen(true)}
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

        {datasets.isLoading ? (
          <div className="p-[22px] space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
            <FileText className="h-10 w-10 text-text-faint" />
            <p className="font-mono text-[13px]">No datasets yet.</p>
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first dataset
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span className="flex-1">Name</span>
              <span className="w-[80px] text-right">Items</span>
              <span className="w-[140px] text-right">Created</span>
              <span className="w-[40px]" />
            </div>
            {list.map((d) => <DatasetRow key={d.id} dataset={d} />)}
          </>
        )}
      </div>

      <NewDatasetDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
