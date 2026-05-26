'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Database, Plus, Trash2, FileText, Hash, Upload } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { formatDate } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useDatasets,
  useCreateDataset,
  useDeleteDataset,
  useBulkAddDatasetItems,
  type Dataset,
} from '@/lib/queries/use-datasets'

// ── File parser ──────────────────────────────────────────────────────────────

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

// ── New dataset dialog ───────────────────────────────────────────────────────

function NewDatasetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateDataset()
  const bulkAdd = useBulkAddDatasetItems()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<'empty' | 'upload'>('empty')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fileName, setFileName] = useState('')
  const [parsedItems, setParsedItems] = useState<RawItem[] | null>(null)
  const [parseError, setParseError] = useState('')
  const [error, setError] = useState('')

  function handleClose() {
    onClose()
    setTab('empty')
    setName(''); setDescription('')
    setFileName(''); setParsedItems(null)
    setParseError(''); setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(''); setParsedItems(null)
    setFileName(file.name)
    if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const items = parseDatasetFile(ev.target?.result as string)
        setParsedItems(items)
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse file')
      }
    }
    reader.readAsText(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (tab === 'upload' && !parsedItems?.length) { setError('Upload a file first'); return }
    try {
      const dataset = await create.mutateAsync({
        name: name.trim(),
        ...(description.trim() && { description: description.trim() }),
      })
      if (tab === 'upload' && parsedItems?.length && dataset) {
        await bulkAdd.mutateAsync({ datasetId: dataset.id, items: parsedItems })
      }
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  const isPending = create.isPending || bulkAdd.isPending
  const withOutput = parsedItems?.filter((i) => !!(i.expected_output ?? i.expectedOutput)).length ?? 0

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New dataset</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 mt-3">
          {/* Tab toggle */}
          <div className="flex gap-1 p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[11px] w-fit">
            <button
              type="button"
              onClick={() => setTab('empty')}
              className={`px-3 py-1 rounded-[3px] ${tab === 'empty' ? 'bg-text text-bg' : 'text-text-muted'}`}
            >
              Empty
            </button>
            <button
              type="button"
              onClick={() => setTab('upload')}
              className={`px-3 py-1 rounded-[3px] ${tab === 'upload' ? 'bg-text text-bg' : 'text-text-muted'}`}
            >
              Upload file
            </button>
          </div>

          {/* File picker (upload tab only) */}
          {tab === 'upload' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.jsonl,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-[68px] border border-dashed border-border rounded-[5px] flex flex-col items-center justify-center gap-1.5 hover:border-border-strong hover:bg-bg-muted transition-colors"
              >
                <Upload className="h-4 w-4 text-text-faint" />
                <span className="font-mono text-[11px] text-text-faint">
                  {fileName ? fileName : 'Choose .json, .jsonl, or .csv file'}
                </span>
              </button>
              {parseError && (
                <p className="font-mono text-[11px] text-bad mt-1">{parseError}</p>
              )}
              {parsedItems && (
                <p className="font-mono text-[11px] text-good mt-1">
                  {parsedItems.length} items · {withOutput} with expected output
                </p>
              )}
            </div>
          )}

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
              onClick={handleClose}
              className="font-mono text-[11.5px] px-3 py-[6px] border border-border rounded-[5px] text-text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || (tab === 'upload' && !parsedItems?.length)}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 disabled:opacity-40"
            >
              {isPending ? 'Creating…' : 'Create'}
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
        {formatDate(dataset.created_at)}
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
