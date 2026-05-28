'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, ExternalLink, AlertTriangle, Upload } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useDataset,
  useAddDatasetItem,
  useDeleteDatasetItem,
  useBulkAddDatasetItems,
  type DatasetItem,
} from '@/lib/queries/use-datasets'

// ── File parser ───────────────────────────────────────────────────────────────

interface RawItem {
  input: unknown
  expected_output?: string | null
  expectedOutput?: string | null
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else { field += ch }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ',') { fields.push(field); field = '' }
      else { field += ch }
    }
  }
  fields.push(field)
  return fields
}

function parseDatasetFile(text: string): RawItem[] {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('File is empty')

  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as unknown
    if (!Array.isArray(arr)) throw new Error('Expected a JSON array')
    return arr as RawItem[]
  }

  if (trimmed.startsWith('{')) {
    // JSONL — one JSON object per line
    const lines = trimmed.split('\n').filter((l) => l.trim())
    return lines.map((l, i) => {
      try {
        return JSON.parse(l) as RawItem
      } catch {
        throw new Error(`Line ${i + 1}: invalid JSON`)
      }
    })
  }

  // CSV — header row required with "input" column, optional "expected_output"
  const lines = trimmed.split('\n').filter((l) => l.trim())
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row')
  const headers = parseCsvLine(lines[0] ?? '').map((h) => h.trim().toLowerCase())
  const inputIdx = headers.indexOf('input')
  const outputIdx = headers.indexOf('expected_output')
  if (inputIdx === -1) throw new Error('CSV must have an "input" column')
  return lines.slice(1).map((line, i) => {
    const fields = parseCsvLine(line)
    const rawInput = fields[inputIdx]?.trim() ?? ''
    if (!rawInput) throw new Error(`Row ${i + 2}: "input" is empty`)
    let input: unknown
    try { input = JSON.parse(rawInput) } catch { input = { messages: [{ role: 'user', content: rawInput }] } }
    const rawOutput = outputIdx >= 0 ? (fields[outputIdx]?.trim() ?? '') : ''
    return { input, expected_output: rawOutput || null }
  })
}

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
      {/* Outer container is a div (not <button>) so the inner Delete <button>
          and source-request <Link> don't violate HTML's "no nested buttons"
          rule. Keyboard activation preserved via role + Enter/Space. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className="w-full flex items-start gap-3 px-[16px] py-[11px] hover:bg-bg-muted transition-colors text-left cursor-pointer"
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
              href={`/requests/${item.source_request_id}`}
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
      </div>
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
  const bulkAdd = useBulkAddDatasetItems()
  const importRef = useRef<HTMLInputElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (importRef.current) importRef.current.value = ''
    setImportMsg('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const items = parseDatasetFile(ev.target?.result as string)
        bulkAdd.mutateAsync({ datasetId, items }).then((res) => {
          const added = (res as { added?: number })?.added ?? items.length
          setImportMsg(`${added} item${added !== 1 ? 's' : ''} imported`)
          setTimeout(() => setImportMsg(''), 4000)
        }).catch((err: unknown) => {
          setImportMsg(err instanceof Error ? err.message : 'Import failed')
        })
      } catch (err) {
        setImportMsg(err instanceof Error ? err.message : 'Failed to parse file')
      }
    }
    reader.readAsText(file)
  }

  if (ds.isLoading) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
        <div className="sticky top-0 z-20 bg-bg">
          <Topbar crumbs={[{ label: 'Datasets', href: '/datasets' }, { label: '...' }]} />
        </div>
        <div className="p-[22px] space-y-2">
          <div className="h-12 bg-bg-elev rounded animate-pulse" />
        </div>
      </div>
    )
  }

  if (!ds.data) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
        <div className="sticky top-0 z-20 bg-bg">
          <Topbar crumbs={[{ label: 'Datasets', href: '/datasets' }, { label: 'Not found' }]} />
        </div>
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
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[
            { label: 'Datasets', href: '/datasets' },
            { label: dataset.name },
          ]}
          right={
            <div className="flex items-center gap-2">
              {/* Import status message — hidden on mobile to keep the button
                  row compact. Long messages would otherwise push the action
                  buttons off-screen on phones. */}
              {importMsg && (
                <span className={`hidden md:inline font-mono text-[11px] ${importMsg.includes('failed') || importMsg.includes('invalid') || importMsg.includes('empty') ? 'text-bad' : 'text-good'}`}>
                  {importMsg}
                </span>
              )}
              <input
                ref={importRef}
                type="file"
                accept=".json,.jsonl,.csv"
                onChange={handleImportFile}
                className="hidden"
              />
              {/* Labels collapse to icon-only on mobile so the buttons stop
                  wrapping into two-line stacks. `title` keeps a tooltip for
                  pointer + screen-reader users. */}
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                disabled={bulkAdd.isPending}
                title={bulkAdd.isPending ? 'Importing…' : 'Import items'}
                aria-label={bulkAdd.isPending ? 'Importing items' : 'Import items'}
                className="font-mono text-[11.5px] px-2 sm:px-3 py-[6px] rounded-[5px] border border-border text-text-muted hover:text-text flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Upload className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">
                  {bulkAdd.isPending ? 'Importing…' : 'Import items'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                title="Add item"
                aria-label="Add item"
                className="font-mono text-[11.5px] px-2 sm:px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Add item</span>
              </button>
            </div>
          }
        />
      </div>

      <div>
        {/* Header info — dataset.name is the page's h1 now. */}
        <div className="px-[22px] py-[14px] border-b border-border space-y-1">
          <h1 className="font-mono text-[15px] text-text font-medium break-all">{dataset.name}</h1>
          {dataset.description && (
            <p className="font-mono text-[12px] text-text-muted">{dataset.description}</p>
          )}
          <div className="flex items-center gap-4 font-mono text-[11px] text-text-faint pt-1">
            <span className="tabular-nums">{items.length.toLocaleString()} items</span>
            <span className="tabular-nums">{itemsWithOutput.toLocaleString()} with expected output</span>
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
