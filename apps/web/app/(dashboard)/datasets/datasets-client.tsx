'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Database, Plus, Trash2, FileText, Search, Upload } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { cn, formatDate } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  CONTROL,
  CONTROL_TEXT,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
  tabClass,
} from '../_board/surfaces'
import { StatusPill } from '@/components/ui/primitives'
import {
  useDatasets,
  useCreateDataset,
  useDeleteDataset,
  useBulkAddDatasetItems,
  type Dataset,
} from '@/lib/queries/use-datasets'
import { useEvalRuns } from '@/lib/queries/use-evals'
import { useExperiments } from '@/lib/queries/use-experiments'

/*
 * Column templates for the two board tables on `D11 · Datasets`. Header band
 * and rows both read them so the two stay locked; Tailwind's JIT is unreliable
 * with arbitrary multi-column `grid-cols-[…]`, so they're applied as styles.
 */
const DATASET_GRID: React.CSSProperties = {
  gridTemplateColumns: 'minmax(220px,1fr) 88px 132px 48px',
}
const RUN_GRID: React.CSSProperties = {
  gridTemplateColumns: '140px minmax(160px,1.4fr) minmax(160px,1.4fr) 104px 88px 92px',
}

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
          {/* Source toggle — same pill tabs the boards use, so the dialog
              reads as part of the same system as the page behind it. */}
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setTab('empty')} aria-pressed={tab === 'empty'} className={tabClass(tab === 'empty')}>
              Empty
            </button>
            <button type="button" onClick={() => setTab('upload')} aria-pressed={tab === 'upload'} className={tabClass(tab === 'upload')}>
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
                className="w-full h-[68px] border border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1.5 hover:border-border-strong hover:bg-bg-muted transition-colors"
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
            <label className="micro-label mb-1 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer support golden set"
              required
              className={cn(CONTROL, 'w-full px-3 text-[12.5px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
            />
          </div>
          <div>
            <label className="micro-label mb-1 block">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this dataset covers…"
              className="w-full resize-none rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none"
            />
          </div>
          {error && <p className="font-mono text-[11.5px] text-bad">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full border border-border px-3.5 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || (tab === 'upload' && !parsedItems?.length)}
              className="rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:opacity-40"
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
      className={cn(ROW, 'grid items-center gap-3 transition-colors hover:bg-bg-muted')}
      style={DATASET_GRID}
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-[12px] text-text">{dataset.name}</p>
        {dataset.description && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-faint">
            {dataset.description}
          </p>
        )}
      </div>
      <span className="font-mono text-[12px] tabular-nums text-text-muted">
        {(dataset.item_count ?? 0).toLocaleString('en-US')}
      </span>
      <span className="font-mono text-[12px] text-text-muted">{formatDate(dataset.created_at)}</span>
      <span className="flex justify-end">
        <button
          type="button"
          onClick={handleDelete}
          className="p-1 text-text-faint transition-colors hover:text-bad"
          aria-label={`Delete dataset ${dataset.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
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

/** Run state → status tint. Mirrors the STATUS lozenge on `D11`. */
function runTagVariant(status: string): 'good' | 'bad' | 'warn' | 'neutral' {
  if (status === 'completed') return 'good'
  if (status === 'running') return 'warn'
  if (status === 'failed') return 'bad'
  return 'neutral'
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
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-card bg-bg-chip" />
        ))}
      </div>
    )
  }

  if (combined.length === 0) {
    return (
      <div className="card-surface rounded-card flex h-64 flex-col items-center justify-center gap-3 text-text-muted">
        <FileText className="h-9 w-9 text-text-faint" />
        <p className="text-[13.5px] font-semibold leading-[1.45] text-text">No dataset runs yet.</p>
        <p className="max-w-[420px] text-center text-[12.5px] leading-[1.6] text-text-muted">
          Every time an evaluator or experiment runs against one of your datasets, it shows up here as a row.
        </p>
      </div>
    )
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
    /* The run grid is wider than a narrow viewport, so the card scrolls its
       own table sideways rather than the page. */
    <TableCard>
      <div className="overflow-x-auto">
        <div className="min-w-[840px]">
          <TableHead>
            <div className="grid items-center gap-3" style={RUN_GRID}>
              <Th>Started</Th>
              <Th>Dataset</Th>
              <Th>Producer</Th>
              <Th>Status</Th>
              <Th>Avg score</Th>
              <Th className="text-right">Cost</Th>
            </div>
          </TableHead>
          {combined.map((r) => {
            const ds = r.datasetId ? datasetsById.get(r.datasetId) : null
            return (
              <div
                key={`${r.kind}-${r.id}`}
                className={cn(ROW, 'grid items-center gap-3')}
                style={RUN_GRID}
              >
                <span className="font-mono text-[12px] tabular-nums text-text-muted">
                  {fmtDate(r.startedAt)}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] text-text">
                    {ds?.name ?? 'Unknown dataset'}
                  </div>
                  <div className="font-mono text-[10.5px] text-text-faint">
                    {r.itemsCompleted}/{r.itemsTotal} items
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] text-text-muted">
                    <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">
                      {r.kind === 'eval' ? 'Eval' : 'Experiment'}
                    </span>
                    {r.name}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-text-faint">{r.subName}</div>
                </div>
                <span>
                  <StatusPill variant={runTagVariant(r.status)}>{r.status}</StatusPill>
                </span>
                <span className="font-mono text-[12px] tabular-nums text-text">{fmtScore(r.score)}</span>
                <span className="text-right font-mono text-[12px] tabular-nums text-text-muted">
                  {fmtCost(r.costUsd)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </TableCard>
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
    <div>
      <div className={TOPBAR_BLEED}>
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
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
              >
                <Plus className="h-3.5 w-3.5" />
                New dataset
              </button>
            </div>
          }
        />
      </div>
      <h1 className="sr-only">Datasets</h1>

      <Board>
        {/* Tab strip: Datasets (definitions) vs Runs (eval+experiment timeline) */}
        <div className="flex items-center gap-1">
          {(['datasets', 'runs'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={tabClass(tab === t)}
            >
              {t === 'datasets' ? 'Datasets' : 'Runs'}
            </button>
          ))}
        </div>

        {tab === 'runs' ? (
          <>
            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <Database className="h-3.5 w-3.5 shrink-0" />
              <span>
                Every evaluator run and experiment that targeted one of your datasets, in one timeline.
              </span>
              <Link
                href="/docs/features/datasets"
                className="ml-auto text-text transition-opacity hover:opacity-80"
              >
                How datasets work →
              </Link>
            </div>
            <DatasetRunsView datasetsById={datasetsById} />
          </>
        ) : (
          <>
            {/* Filter bar — the search field runs the width of the row, with
                the export control and the result count parked at the end the
                way the boards show it. */}
            <FilterBar>
              <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
                <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchInput('')
                      updateQuery({ q: null })
                    }
                  }}
                  placeholder="Search datasets"
                  aria-label="Search datasets by name or description"
                  className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                    className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div ref={exportRef} className="relative">
                <button
                  type="button"
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={filtered.length === 0}
                  aria-expanded={exportOpen}
                  className={cn(
                    CONTROL,
                    CONTROL_TEXT,
                    'inline-flex items-center gap-1.5 pl-3 pr-2.5 text-text-muted transition-colors hover:text-text disabled:opacity-40',
                  )}
                >
                  Export
                  <span className="text-[10px] text-text-faint">▾</span>
                </button>
                {exportOpen && (
                  <div className="card-surface absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg py-1">
                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); exportCsv() }}
                      className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
                    >CSV</button>
                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); exportJson() }}
                      className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
                    >JSON</button>
                  </div>
                )}
              </div>
              <span className="font-mono text-[11px] text-text-faint">
                {mounted ? (filtered.length === list.length ? `${list.length} datasets` : `${filtered.length} of ${list.length}`) : ' '}
              </span>
            </FilterBar>

            {/* Stat strip — every figure is derived from the dataset list the
                page already holds, so the row costs no extra round trip. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard
                label="Datasets"
                value={mounted ? list.length : ' '}
                foot="reusable test inputs"
              />
              <StatCard
                label="Items"
                value={mounted ? totalItems.toLocaleString('en-US') : ' '}
                foot="across all datasets"
              />
              {/* The tile figure is normally a number, so `StatCard` sets
                  tabular figures. A date is not, and the fixed advance stretches
                  the space around its comma, so this one opts back out. */}
              <StatCard
                label="Last created"
                value={
                  <span className="[font-variant-numeric:normal]">
                    {mounted ? (lastCreatedDate ? formatDate(lastCreatedDate) : '—') : ' '}
                  </span>
                }
                foot={list.length > 0 ? 'newest in the workspace' : 'nothing yet'}
              />
            </div>

            {/* Explainer with docs link */}
            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <Database className="h-3.5 w-3.5 shrink-0" />
              <span>
                Datasets are reusable test inputs for Evals. Import production requests or add items manually.
              </span>
              <Link
                href="/docs/features/datasets"
                className="ml-auto text-text transition-opacity hover:opacity-80"
              >
                How datasets work →
              </Link>
            </div>

            {datasets.isLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-card bg-bg-chip" />)}
              </div>
            ) : datasets.isError ? (
              // Don't fall through to the "create your first dataset" empty state on
              // a load failure — a workspace with existing datasets would look brand-new.
              <div className="card-surface rounded-card flex flex-col items-center gap-3 px-6 py-20 text-center text-text-muted">
                <p className="text-[13px] text-accent">Couldn&apos;t load datasets.</p>
                <button
                  type="button"
                  onClick={() => void datasets.refetch()}
                  className="rounded-full border border-border px-3.5 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
                >
                  Retry
                </button>
              </div>
            ) : list.length === 0 ? (
              <div className="card-surface rounded-card flex flex-col items-center justify-center gap-3 px-6 py-16 text-text-muted">
                <FileText className="h-9 w-9 text-text-faint" />
                <p className="text-[13.5px] font-semibold leading-[1.45] text-text">No datasets yet.</p>
                <button
                  type="button"
                  onClick={() => setNewOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create your first dataset
                </button>
                <Link
                  href="/docs/features/datasets"
                  className="mt-1 font-mono text-[11px] text-text-muted underline underline-offset-2 hover:text-text"
                >
                  How datasets work →
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              <div className="card-surface rounded-card flex h-40 flex-col items-center justify-center gap-3 text-text-muted">
                <p className="text-[12.5px]">No datasets match the current search.</p>
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                  className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
                >
                  Clear search
                </button>
              </div>
            ) : (
              /* The row grid is wider than a narrow viewport, so the card
                 scrolls its own table sideways rather than the page. */
              <TableCard>
                <div className="overflow-x-auto">
                  <div className="min-w-[620px]">
                    <TableHead>
                      <div className="grid items-center gap-3" style={DATASET_GRID}>
                        <Th>Dataset</Th>
                        <Th>Items</Th>
                        <Th>Created</Th>
                        <Th><span className="sr-only">Actions</span></Th>
                      </div>
                    </TableHead>
                    {filtered.map((d) => <DatasetRow key={d.id} dataset={d} />)}
                  </div>
                </div>
              </TableCard>
            )}
          </>
        )}
      </Board>

      <NewDatasetDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
