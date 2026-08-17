'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, ExternalLink, Upload } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  tabClass,
} from '../../_board/surfaces'
import { StatusPill } from '@/components/ui/primitives'
import {
  useDataset,
  useAddDatasetItem,
  useDeleteDatasetItem,
  useBulkAddDatasetItems,
  type DatasetItem,
} from '@/lib/queries/use-datasets'

/*
 * Column template for the items table on `D22 · Dataset detail`. Header band
 * and rows both read it so the two stay locked; Tailwind's JIT is unreliable
 * with arbitrary multi-column `grid-cols-[…]`, so it is applied as a style.
 */
const ITEM_GRID: React.CSSProperties = {
  gridTemplateColumns: '52px minmax(180px,1.3fr) minmax(180px,1.3fr) 104px 52px',
}

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
          {/* Input-shape toggle — same pill tabs the boards use, so the dialog
              reads as part of the same system as the page behind it. */}
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMode('messages')} aria-pressed={mode === 'messages'} className={tabClass(mode === 'messages')}>
              User message
            </button>
            <button type="button" onClick={() => setMode('variables')} aria-pressed={mode === 'variables'} className={tabClass(mode === 'variables')}>
              Variables JSON
            </button>
          </div>

          {mode === 'messages' ? (
            <div>
              <label className="micro-label mb-1 block">User message</label>
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                rows={3}
                placeholder="Enter the user's input…"
                required
                className="w-full resize-none rounded-md border border-border bg-bg-elev px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="micro-label mb-1 block">Variables (JSON object)</label>
              <textarea
                value={variablesJson}
                onChange={(e) => setVariablesJson(e.target.value)}
                rows={5}
                className="w-full resize-none rounded-md border border-border bg-bg-elev px-3 py-2 font-mono text-[12px] text-text focus:border-border-strong focus:outline-none"
              />
              <p className="mt-1 font-mono text-[10.5px] text-text-faint">
                For prompts with {`{{var}}`} placeholders.
              </p>
            </div>
          )}

          <div>
            <label className="micro-label mb-1 block">Expected output (optional)</label>
            <textarea
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              rows={3}
              placeholder="The response the prompt should produce…"
              className="w-full resize-none rounded-md border border-border bg-bg-elev px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none"
            />
            <p className="mt-1 font-mono text-[10.5px] text-text-faint">
              Required for Evals dataset source, judge scores this text against your criterion.
            </p>
          </div>

          {error && <p className="font-mono text-[11.5px] text-bad">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border px-3.5 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={add.isPending}
              className="rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:opacity-40"
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

function ItemRow({ item, datasetId, index }: { item: DatasetItem; datasetId: string; index: number }) {
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
    <div className="border-b border-border last:border-b-0">
      {/* Outer container is a div (not <button>) so the inner Delete <button>
          and source-request <Link> don't violate HTML's "no nested buttons"
          rule. Keyboard activation preserved via role + Enter/Space. */}
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
          {/* The board's RESULT lozenge slot. An item with no expected output
              is skipped by the judge, so that is the state worth flagging. */}
          {hasExpected ? (
            <StatusPill variant="good">scorable</StatusPill>
          ) : (
            <span title="No expected output, won't be evaluated">
              <StatusPill variant="warn">no output</StatusPill>
            </span>
          )}
        </span>
        <span className="flex items-center justify-end gap-1.5">
          {item.source_request_id && (
            <Link
              href={`/requests/${item.source_request_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-text-faint transition-colors hover:text-text"
              aria-label="View source request"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="p-1 text-text-faint transition-colors hover:text-bad"
            aria-label="Delete item"
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
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar crumbs={[{ label: 'Datasets', href: '/datasets' }, { label: '...' }]} />
        </div>
        <Board>
          <div className="h-[74px] animate-pulse rounded-card bg-bg-chip" />
          <div className="h-64 animate-pulse rounded-card bg-bg-chip" />
        </Board>
      </div>
    )
  }

  if (!ds.data) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar crumbs={[{ label: 'Datasets', href: '/datasets' }, { label: 'Not found' }]} />
        </div>
        <Board>
          <div className="card-surface rounded-card flex h-64 items-center justify-center text-[13px] text-text-muted">
            Dataset not found.
          </div>
        </Board>
      </div>
    )
  }

  const dataset = ds.data
  const items = dataset.items ?? []
  const itemsWithOutput = items.filter((i) => !!i.expected_output).length

  return (
    <div>
      <div className={TOPBAR_BLEED}>
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
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-bg-muted hover:text-text disabled:opacity-40 sm:px-3.5"
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
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-2.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong sm:px-3.5"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Add item</span>
              </button>
            </div>
          }
        />
      </div>

      {/* The breadcrumb already carries the dataset name at the top of the
          board, so the visible header the old layout drew would repeat it.
          The h1 stays for the document outline and screen readers. */}
      <h1 className="sr-only">{dataset.name}</h1>

      <Board>
        {/* Summary strip — one card, cells divided by hairlines. Only figures
            the dataset payload already carries; producer, judged score and
            linked-eval counts are not on this endpoint. */}
        {/* `flex-1` spreads the cells across the card the way the frame
            distributes its six, so the hairlines land on even intervals
            instead of bunching at the left edge. */}
        <SummaryStrip>
          <SummaryCell label="Items" className="flex-1 basis-[140px]">
            {items.length.toLocaleString('en-US')}
          </SummaryCell>
          <SummaryCell label="With expected output" className="flex-1 basis-[140px]">
            {itemsWithOutput.toLocaleString('en-US')}
          </SummaryCell>
          <SummaryCell label="Created" className="flex-1 basis-[140px]">
            {formatDate(dataset.created_at)}
          </SummaryCell>
        </SummaryStrip>

        {dataset.description && (
          <div className="card-surface rounded-card px-5 py-3.5 text-[12.5px] leading-[1.6] text-text-muted">
            {dataset.description}
          </div>
        )}

        {items.length === 0 ? (
          <div className="card-surface rounded-card flex flex-col items-center justify-center gap-3 px-6 py-16 text-text-muted">
            <p className="text-[13.5px] font-semibold leading-[1.45] text-text">Empty dataset.</p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
            >
              <Plus className="h-3.5 w-3.5" />
              Add first item
            </button>
            <p className="max-w-md text-center text-[12.5px] leading-[1.6] text-text-muted">
              Import a .json, .jsonl or .csv file with the button above, or add items one at a time.
            </p>
          </div>
        ) : (
          /* The row grid is wider than a narrow viewport, so the card scrolls
             its own table sideways rather than the page. */
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
                {items.map((item, i) => (
                  <ItemRow key={item.id} item={item} datasetId={datasetId} index={i} />
                ))}
              </div>
            </div>
          </TableCard>
        )}
      </Board>

      {addOpen && (
        <AddItemDialog datasetId={datasetId} onClose={() => setAddOpen(false)} />
      )}
    </div>
  )
}
