'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, ExternalLink, AlertTriangle } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useDataset,
  useAddDatasetItem,
  useDeleteDatasetItem,
  type DatasetItem,
} from '@/lib/queries/use-datasets'

// ── Add item dialog (manual entry) ───────────────────────────────────────────

function AddItemDialog({
  datasetId,
  onClose,
}: {
  datasetId: string
  onClose: () => void
}) {
  const add = useAddDatasetItem()
  const [mode, setMode] = useState<'variables' | 'messages'>('messages')
  const [userMessage, setUserMessage] = useState('')
  const [variablesJson, setVariablesJson] = useState('{\n  "name": "Alice"\n}')
  const [expectedOutput, setExpectedOutput] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    let input: { variables?: Record<string, string>; messages?: Array<{ role: string; content: string }> }
    try {
      if (mode === 'variables') {
        const parsed = JSON.parse(variablesJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Variables must be a JSON object')
        }
        input = { variables: parsed }
      } else {
        if (!userMessage.trim()) { setError('Message is required'); return }
        input = { messages: [{ role: 'user', content: userMessage.trim() }] }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid input')
      return
    }

    try {
      const trimmedExpected = expectedOutput.trim()
      await add.mutateAsync({
        datasetId,
        input,
        ...(trimmedExpected && { expectedOutput: trimmedExpected }),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add')
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add dataset item</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 mt-3">
          <div className="flex gap-1 p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[11px] w-fit">
            <button
              type="button"
              onClick={() => setMode('messages')}
              className={`px-3 py-1 rounded-[3px] ${mode === 'messages' ? 'bg-text text-bg' : 'text-text-muted'}`}
            >
              User message
            </button>
            <button
              type="button"
              onClick={() => setMode('variables')}
              className={`px-3 py-1 rounded-[3px] ${mode === 'variables' ? 'bg-text text-bg' : 'text-text-muted'}`}
            >
              Variables JSON
            </button>
          </div>

          {mode === 'messages' ? (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                User message
              </label>
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                rows={3}
                placeholder="Enter the user's input…"
                required
                className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text resize-none"
              />
            </div>
          ) : (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Variables (JSON object)
              </label>
              <textarea
                value={variablesJson}
                onChange={(e) => setVariablesJson(e.target.value)}
                rows={5}
                className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text resize-none"
              />
              <p className="font-mono text-[10px] text-text-faint mt-1">
                For prompts with {`{{var}}`} placeholders.
              </p>
            </div>
          )}

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Expected output (optional)
            </label>
            <textarea
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              rows={3}
              placeholder="The response the prompt should produce…"
              className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text resize-none"
            />
            <p className="font-mono text-[10px] text-text-faint mt-1">
              Required for Evals dataset source, judge scores this text against your criterion.
            </p>
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
              disabled={add.isPending}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 disabled:opacity-40"
            >
              {add.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, datasetId }: { item: DatasetItem; datasetId: string }) {
  const del = useDeleteDatasetItem()
  const [expanded, setExpanded] = useState(false)

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this item?')) return
    void del.mutateAsync({ datasetId, itemId: item.id })
  }

  const inputPreview = item.input.messages?.[0]?.content
    ?? JSON.stringify(item.input.variables ?? {})
  const hasExpected = !!item.expected_output

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 px-[16px] py-[11px] hover:bg-bg-muted transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[12px] text-text truncate">{inputPreview}</p>
          {item.expected_output && (
            <p className="font-mono text-[11px] text-text-faint truncate mt-0.5">
              → {item.expected_output}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!hasExpected && (
            <span className="font-mono text-[10px] text-warn flex items-center gap-1" title="No expected output, won't be evaluated">
              <AlertTriangle className="h-3 w-3" />
              no output
            </span>
          )}
          {item.source_request_id && (
            <Link
              href={`/requests?id=${item.source_request_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-text-faint hover:text-text"
              aria-label="View source request"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="text-text-faint hover:text-bad transition-colors"
            aria-label="Delete item"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
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

// ── Main page ────────────────────────────────────────────────────────────────

export function DatasetDetailClient({ datasetId }: { datasetId: string }) {
  const ds = useDataset(datasetId)
  const [addOpen, setAddOpen] = useState(false)

  if (ds.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Topbar crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Datasets', href: '/datasets' }, { label: '...' }]} />
        <div className="p-[22px] space-y-2">
          <div className="h-12 bg-bg-elev rounded animate-pulse" />
        </div>
      </div>
    )
  }

  if (!ds.data) {
    return (
      <div className="flex flex-col h-full">
        <Topbar crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Datasets', href: '/datasets' }, { label: 'Not found' }]} />
        <div className="flex items-center justify-center h-64 text-text-muted font-mono text-[13px]">
          Dataset not found.
        </div>
      </div>
    )
  }

  const dataset = ds.data
  const items = dataset.items ?? []
  const itemsWithOutput = items.filter((i) => !!i.expected_output).length

  return (
    <div className="flex flex-col h-full">
      <Topbar
        crumbs={[
          { label: 'Workspace', href: '/dashboard' },
          { label: 'Datasets', href: '/datasets' },
          { label: dataset.name },
        ]}
        right={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Header info */}
        <div className="px-[22px] py-[12px] border-b border-border space-y-1">
          <p className="font-mono text-[15px] text-text font-medium">{dataset.name}</p>
          {dataset.description && (
            <p className="font-mono text-[12px] text-text-muted">{dataset.description}</p>
          )}
          <div className="flex items-center gap-4 font-mono text-[11px] text-text-faint pt-1">
            <span>{items.length} items</span>
            <span>{itemsWithOutput} with expected output</span>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
            <p className="font-mono text-[13px]">Empty dataset.</p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add first item
            </button>
            <p className="font-mono text-[10.5px] text-text-faint text-center max-w-md">
              You can also bulk import from the Requests page (multi-select → &quot;Add to dataset&quot;).
              Coming next round.
            </p>
          </div>
        ) : (
          items.map((item) => <ItemRow key={item.id} item={item} datasetId={datasetId} />)
        )}
      </div>

      {addOpen && (
        <AddItemDialog datasetId={datasetId} onClose={() => setAddOpen(false)} />
      )}
    </div>
  )
}
