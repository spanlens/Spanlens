'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Database, Plus, Trash2, FileText, Search, Upload } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { cn, formatDate } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useDatasets,
  useCreateDataset,
  useDeleteDataset,
  useBulkAddDatasetItems,
  type Dataset,
} from '@/lib/queries/use-datasets'
import { useEvalRuns, type EvalRun } from '@/lib/queries/use-evals'
import { useExperiments, type Experiment } from '@/lib/queries/use-experiments'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

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
      <div className="font-mono text-[11.5px] text-text-muted w-[80px] text-right tabular-nums">
        {dataset.item_count ?? 0} <span className="text-text-faint">items</span>
      </div>
      {/* Created column hidden on mobile to keep the row from going
          horizontal on narrow viewports. */}
      <div className="hidden sm:block font-mono text-[10.5px] text-text-faint w-[140px] text-right">
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

// ── Runs view: every eval-run and experiment that used a dataset ──────────────

interface DatasetRunsViewProps {
  datasetsById: Map<string, Dataset>
}

interface CombinedRun {
  id: string
  kind: 'eval' | 'experiment'
  startedAt: string
  datasetId: string | null
  status: string
  itemsCompleted: number
  itemsTotal: number
  score: number | null
  costUsd: number
  name: string
  subName: string
}

function statusPill(status: string): { cls: string; label: string } {
  if (status === 'completed') return { cls: 'border-good/30 bg-good/10 text-good', label: 'Completed' }
  if (status === 'running')   return { cls: 'border-accent-border bg-accent-bg text-accent', label: 'Running' }
  if (status === 'failed')    return { cls: 'border-bad/30 bg-bad/10 text-bad', label: 'Failed' }
  return { cls: 'border-border bg-bg-elev text-text-muted', label: status }
}

function DatasetRunsView({ datasetsById }: DatasetRunsViewProps) {
  const evalRuns = useEvalRuns()
  const experiments = useExperiments()

  const combined = useMemo<CombinedRun[]>(() => {
    const out: CombinedRun[] = []
    for (const r of evalRuns.data ?? []) {
      if (!r.dataset_id) continue // only show runs that used a dataset
      out.push({
        id: r.id,
        kind: 'eval',
        startedAt: r.started_at,
        datasetId: r.dataset_id,
        status: r.status,
        itemsCompleted: r.scored_count,
        itemsTotal: r.sample_size,
        score: r.avg_score,
        costUsd: r.total_cost_usd,
        name: 'Eval run',
        subName: r.evaluators?.name ?? r.evaluator_id.slice(0, 8),
      })
    }
    for (const e of experiments.data ?? []) {
      out.push({
        id: e.id,
        kind: 'experiment',
        startedAt: e.started_at,
        datasetId: e.dataset_id,
        status: e.status,
        itemsCompleted: e.completed_items,
        itemsTotal: e.total_items,
        score: e.avg_score_b ?? e.avg_score_a,
        costUsd: e.total_cost_usd,
        name: e.name,
        subName: `${e.prompt_name} · ${e.run_provider}/${e.run_model}`,
      })
    }
    return out.sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1))
  }, [evalRuns.data, experiments.data])

  const isLoading = evalRuns.isLoading || experiments.isLoading

  if (isLoading) {
    return (
      <div className="p-[22px] space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-bg-elev rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (combined.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
        <FileText className="h-9 w-9 text-text-faint" />
        <p className="font-mono text-[13px]">No dataset runs yet.</p>
        <p className="font-mono text-[11.5px] text-text-faint max-w-[400px] text-center">
          Every time an evaluator or experiment runs against one of your datasets, it shows up here as a row.
        </p>
      </div>
    )
  }

  const rowGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '160px 1.6fr 1.2fr 110px 90px 90px',
    gap: 12,
    alignItems: 'center',
  }

  function fmtScore(s: number | null): string {
    if (s == null) return '—'
    return (s * 100).toFixed(1)
  }
  function fmtCost(n: number): string {
    return '$' + n.toFixed(5)
  }
  function fmtDate(s: string): string {
    return new Date(s).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }

  return (
    <div>
      <div
        className="px-[22px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint"
        style={rowGridStyle}
      >
        <span>Started</span>
        <span>Dataset</span>
        <span>Producer</span>
        <span>Status</span>
        <span>Avg score</span>
        <span className="text-right">Cost</span>
      </div>
      {combined.map((r) => {
        const ds = r.datasetId ? datasetsById.get(r.datasetId) : null
        const pill = statusPill(r.status)
        return (
          <div
            key={`${r.kind}-${r.id}`}
            className="px-[22px] py-[10px] border-b border-border"
            style={rowGridStyle}
          >
            <span className="font-mono text-[11px] text-text-muted tabular-nums">
              {fmtDate(r.startedAt)}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] text-text truncate">{ds?.name ?? 'Unknown dataset'}</div>
              <div className="font-mono text-[10.5px] text-text-faint">
                {r.itemsCompleted}/{r.itemsTotal} items
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-text-muted truncate">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mr-1.5">
                  {r.kind === 'eval' ? 'EVAL' : 'EXPERIMENT'}
                </span>
                {r.name}
              </div>
              <div className="font-mono text-[10.5px] text-text-faint truncate">{r.subName}</div>
            </div>
            <span>
              <span className={cn('inline-flex font-mono text-[10px] px-[6px] py-[1.5px] rounded-[3px] border uppercase tracking-[0.04em]', pill.cls)}>
                {pill.label}
              </span>
            </span>
            <span className="font-mono text-[12px] text-text tabular-nums">{fmtScore(r.score)}</span>
            <span className="font-mono text-[11px] text-text-muted text-right tabular-nums">
              {fmtCost(r.costUsd)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function DatasetsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  const datasets = useDatasets()
  const [newOpen, setNewOpen] = useState(false)

  const tabParam = sp.get('tab')
  const tab: 'datasets' | 'runs' = tabParam === 'runs' ? 'runs' : 'datasets'
  function setTab(t: 'datasets' | 'runs') {
    const next = new URLSearchParams(sp.toString())
    if (t === 'datasets') next.delete('tab'); else next.set('tab', t)
    router.replace(`/datasets?${next.toString()}`)
  }

  // URL-backed search — shareable, survives reload.
  const search = sp.get('q') ?? ''
  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/datasets?${next.toString()}`)
  }
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const list = useMemo(() => datasets.data ?? [], [datasets.data])
  const datasetsById = useMemo(() => {
    const m = new Map<string, Dataset>()
    for (const d of list) m.set(d.id, d)
    return m
  }, [list])
  const filtered = useMemo(() => {
    if (!search) return list
    const needle = search.toLowerCase()
    return list.filter((d) =>
      d.name.toLowerCase().includes(needle) ||
      (d.description ?? '').toLowerCase().includes(needle),
    )
  }, [list, search])

  // Stat strip values — derived from list only, no extra fetch.
  const totalItems = list.reduce((s, d) => s + (d.item_count ?? 0), 0)
  const lastCreatedDate = list.length > 0
    ? list.map((d) => d.created_at).sort().slice(-1)[0]
    : null

  // CSV / JSON export — client-side, RFC 4180 escaping.
  function csvField(v: string | number): string {
    const s = String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  function csvRow(cells: (string | number)[]): string {
    return cells.map(csvField).join(',')
  }
  function downloadFile(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spanlens-datasets-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    const lines: string[] = []
    lines.push(csvRow(['ID', 'Name', 'Description', 'Items', 'Created']))
    for (const d of filtered) {
      lines.push(csvRow([d.id, d.name, d.description ?? '', d.item_count ?? 0, d.created_at]))
    }
    downloadFile(lines.join('\n'), 'text/csv', 'csv')
  }
  function exportJson() {
    downloadFile(JSON.stringify({ datasets: filtered }, null, 2), 'application/json', 'json')
  }
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportOpen) return
    function onDown(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Datasets' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={datasets.isFetching} />
              <button
                type="button"
                onClick={() => void datasets.refetch()}
                disabled={datasets.isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', datasets.isFetching && 'animate-spin')}>↻</span>
              </button>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                New dataset
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Datasets</h1>
      </div>

      {/* Stat strip — counts derived from list. Wraps to 2-col on mobile. */}
      <div className="shrink-0 border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-3">
          {[
            { label: 'Datasets',     value: String(list.length) },
            { label: 'Total items',  value: totalItems.toLocaleString() },
            { label: 'Last created', value: lastCreatedDate ? formatDate(lastCreatedDate) : '—' },
          ].map((s, i) => (
            <div
              key={s.label}
              className={cn(
                'px-[18px] py-[14px] border-border',
                i === 0 && 'border-r',
                i === 1 && 'border-b md:border-b-0 md:border-r',
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className="text-[22px] sm:text-[24px] font-medium leading-none tracking-[-0.6px] text-text">
                {mounted ? s.value : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tab strip: Datasets (definitions) vs Runs (eval+experiment timeline) */}
      <div className="shrink-0 border-b border-border bg-bg flex items-center gap-1 px-[22px]">
        {(['datasets', 'runs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.06em] px-3 py-2.5 transition-colors relative',
              tab === t ? 'text-text' : 'text-text-faint hover:text-text-muted',
            )}
          >
            {t === 'datasets' ? 'Datasets' : 'Runs'}
            {tab === t && (
              <span className="absolute bottom-[-1px] left-3 right-3 h-[2px] bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Info banner with docs link */}
      <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted flex-wrap">
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span>
          {tab === 'datasets'
            ? 'Datasets are reusable test inputs for Evals. Import production requests or add items manually.'
            : 'Every evaluator run and experiment that targeted one of your datasets, in one timeline.'}
        </span>
        <Link
          href="/docs/features/datasets"
          className="text-text hover:opacity-80 transition-opacity ml-auto"
        >
          How datasets work →
        </Link>
      </div>

      {tab === 'runs' ? (
        <DatasetRunsView datasetsById={datasetsById} />
      ) : (
      <>
      {/* Search + Export bar */}
      <div className="px-[22px] py-[10px] border-b border-border flex items-center gap-2 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchInput('')
                updateQuery({ q: null })
              }
            }}
            placeholder="Search by name or description…"
            className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
            className="font-mono text-[11px] text-text-faint hover:text-text transition-colors"
          >
            Clear
          </button>
        )}
        <span className="flex-1" />
        <div ref={exportRef} className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={filtered.length === 0}
            className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2.5 py-1 transition-colors disabled:opacity-40"
          >
            Export ▾
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded-md shadow-lg py-1 min-w-[110px]">
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportCsv() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >CSV</button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportJson() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >JSON</button>
            </div>
          )}
        </div>
        <span className="font-mono text-[11px] text-text-faint">
          {mounted ? (filtered.length === list.length ? `${list.length} datasets` : `${filtered.length} of ${list.length}`) : ' '}
        </span>
      </div>

      <div>
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
            <Link
              href="/docs/features/datasets"
              className="font-mono text-[11.5px] mt-1 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
            >
              How datasets work →
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-text-muted">
            <p className="font-mono text-[12.5px]">No datasets match the current search.</p>
            <button
              type="button"
              onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
              className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span className="flex-1">Name</span>
              <span className="w-[80px] text-right">Items</span>
              <span className="hidden sm:block w-[140px] text-right">Created</span>
              <span className="w-[40px]" />
            </div>
            {filtered.map((d) => <DatasetRow key={d.id} dataset={d} />)}
          </>
        )}
      </div>
      </>
      )}

      <NewDatasetDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
