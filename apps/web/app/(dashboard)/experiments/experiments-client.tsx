'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FlaskConical, Plus, Loader2, Search } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/primitives'

/** The tints `StatusPill` accepts, read off the primitive itself. */
type TagVariant = NonNullable<React.ComponentProps<typeof StatusPill>['variant']>
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import {
  useExperiments,
  useCreateExperiment,
  type Experiment,
  type ExperimentStatus,
} from '@/lib/queries/use-experiments'
import { usePrompts, usePromptVersions } from '@/lib/queries/use-prompts'
import { useDatasets } from '@/lib/queries/use-datasets'
import { useEvaluators } from '@/lib/queries/use-evals'
import { useModels } from '@/lib/queries/use-models'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  CONTROL,
  CONTROL_TEXT,
  Segment,
  SegmentItem,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../_board/surfaces'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

type ExpProvider = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'

// Fallback for the first paint before useModels() resolves.
const RUN_MODELS_FALLBACK = {
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-haiku-4-5'],
  gemini: ['gemini-2.5-flash-lite'],
  azure: ['gpt-4o-mini'],
  mistral: ['mistral-small-latest'],
  openrouter: ['openai/gpt-4o-mini'],
} as const

const PROVIDER_OPTIONS: Array<{ value: ExpProvider; label: string }> = [
  { value: 'openai',     label: 'OpenAI' },
  { value: 'anthropic',  label: 'Anthropic' },
  { value: 'gemini',     label: 'Gemini' },
  { value: 'azure',      label: 'Azure OpenAI' },
  { value: 'mistral',    label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
]

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(1)
}

function fmtDelta(n: number | null): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + (n * 100).toFixed(1)
}

/*
 * Compact "2h ago" age for the STARTED column. `now` is threaded in from
 * `useHydrationSafeNow()` so SSR and the first client paint emit the same
 * markup; it stays 0 until hydration, which is why that case renders blank.
 */
function relAge(iso: string, now: number): string {
  if (!now) return ' '
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// Color tier for score 0..1 — matches the QualityBadge thresholds on the
// prompts page so the visual language is consistent across the dashboard.
// >= 0.80 good, >= 0.60 warn, otherwise bad. Null returns the muted token.
function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-text-faint'
  if (score >= 0.8) return 'text-good'
  if (score >= 0.6) return 'text-warn'
  return 'text-bad'
}

/* Run state → lozenge tint, matching the STATUS column on `D12 · Experiments`. */
const STATUS_TAG: Record<ExperimentStatus, TagVariant> = {
  running:   'warn',
  completed: 'good',
  failed:    'bad',
  pending:   'neutral',
}

/*
 * Column template for the experiments table. The header band and the rows
 * both read it so the two stay locked together; Tailwind's JIT is unreliable
 * with arbitrary multi-column `grid-cols-[…]` values, so it goes in a style.
 */
const EXPERIMENT_GRID: CSSProperties = {
  gridTemplateColumns: 'minmax(180px,1fr) 150px 150px 84px 84px 84px 84px 96px 108px',
}

type StatusFilter = 'all' | ExperimentStatus

const STATUS_FILTERS: { v: StatusFilter; l: string }[] = [
  { v: 'all',       l: 'All' },
  { v: 'running',   l: 'Running' },
  { v: 'completed', l: 'Completed' },
  { v: 'failed',    l: 'Failed' },
  { v: 'pending',   l: 'Pending' },
]

// ── New experiment dialog ────────────────────────────────────────────────────

function NewExperimentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prompts = usePrompts()
  const datasets = useDatasets()
  const create = useCreateExperiment()
  const { data: modelsCatalog } = useModels()
  const runModels: Record<ExpProvider, string[]> = {
    openai:     (modelsCatalog?.openai ?? []).map((m) => m.model),
    anthropic:  (modelsCatalog?.anthropic ?? []).map((m) => m.model),
    gemini:     (modelsCatalog?.gemini ?? []).map((m) => m.model),
    azure:      (modelsCatalog?.azure ?? []).map((m) => m.model),
    mistral:    (modelsCatalog?.mistral ?? []).map((m) => m.model),
    openrouter: (modelsCatalog?.openrouter ?? []).map((m) => m.model),
  }
  for (const p of Object.keys(RUN_MODELS_FALLBACK) as ExpProvider[]) {
    if (runModels[p].length === 0) runModels[p] = [...RUN_MODELS_FALLBACK[p]]
  }

  const [name, setName] = useState('')
  const [promptName, setPromptName] = useState('')
  const versions = usePromptVersions(promptName || null)
  const evaluators = useEvaluators(promptName || undefined)
  const [versionAId, setVersionAId] = useState('')
  const [versionBId, setVersionBId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [evaluatorId, setEvaluatorId] = useState('__none__')
  const [runProvider, setRunProvider] = useState<ExpProvider>('openai')
  const [runModel, setRunModel] = useState<string>('gpt-4o-mini')
  const [error, setError] = useState('')

  function handlePromptChange(v: string) {
    setPromptName(v)
    setVersionAId('')
    setVersionBId('')
    setEvaluatorId('__none__')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name required'); return }
    if (!promptName) { setError('Select prompt'); return }
    if (!versionAId || !versionBId) { setError('Select both versions'); return }
    if (versionAId === versionBId) { setError('Versions must differ'); return }
    if (!datasetId) { setError('Select dataset'); return }
    if (!runModel) { setError('Select model'); return }
    try {
      await create.mutateAsync({
        name: name.trim(),
        promptName,
        versionAId,
        versionBId,
        datasetId,
        ...(evaluatorId && evaluatorId !== '__none__' && { evaluatorId }),
        runProvider,
        runModel,
      })
      onClose()
      setName(''); setPromptName(''); setVersionAId(''); setVersionBId('')
      setDatasetId(''); setEvaluatorId('__none__')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New experiment</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 mt-3">
          <div>
            <label className="micro-label mb-1 block tracking-[0.1em]">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friendliness v2 vs v3"
              required
              className={cn(CONTROL, CONTROL_TEXT, 'w-full px-3 placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
            />
          </div>

          <div>
            <label className="micro-label mb-1 block tracking-[0.1em]">Prompt</label>
            <Select {...(promptName ? { value: promptName } : {})} onValueChange={handlePromptChange}>
              <SelectTrigger><SelectValue placeholder="Select prompt…" /></SelectTrigger>
              <SelectContent>
                {(prompts.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="micro-label mb-1 block tracking-[0.1em]">Version A (control)</label>
              <Select {...(versionAId ? { value: versionAId } : {})} onValueChange={setVersionAId} disabled={!promptName}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {(versions.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>v{v.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="micro-label mb-1 block tracking-[0.1em]">Version B (challenger)</label>
              <Select {...(versionBId ? { value: versionBId } : {})} onValueChange={setVersionBId} disabled={!promptName}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {(versions.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>v{v.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="micro-label mb-1 block tracking-[0.1em]">Dataset</label>
            <Select {...(datasetId ? { value: datasetId } : {})} onValueChange={setDatasetId}>
              <SelectTrigger><SelectValue placeholder="Select dataset…" /></SelectTrigger>
              <SelectContent>
                {(datasets.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} ({d.item_count ?? 0} items)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="micro-label mb-1 block tracking-[0.1em]">
              Evaluator (optional, for side-by-side scoring)
            </label>
            <Select value={evaluatorId} onValueChange={setEvaluatorId} disabled={!promptName}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (outputs only, no scoring)</SelectItem>
                {(evaluators.data ?? []).map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="micro-label mb-1 block tracking-[0.1em]">Run provider</label>
              <Select value={runProvider} onValueChange={(v) => { const p = v as ExpProvider; setRunProvider(p); setRunModel(runModels[p][0] ?? '') }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="micro-label mb-1 block tracking-[0.1em]">Run model</label>
              <Select value={runModel} onValueChange={setRunModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {runModels[runProvider].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg-sunk px-3.5 py-3 text-[12px] leading-[1.6] text-text-muted">
            Both versions run on the same model. Cost is charged to your provider key,
            roughly 2× the dataset item count plus the judge when an evaluator is selected.
          </div>

          {error && <p className="font-mono text-[11.5px] text-bad">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-full border border-border px-3.5 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:opacity-40"
            >
              {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Start experiment
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Experiment row ───────────────────────────────────────────────────────────

function ExperimentRow({ exp, now }: { exp: Experiment; now: number }) {
  const delta = useMemo(() => {
    if (exp.avg_score_a == null || exp.avg_score_b == null) return null
    return exp.avg_score_b - exp.avg_score_a
  }, [exp.avg_score_a, exp.avg_score_b])

  return (
    <Link
      href={`/experiments/${exp.id}`}
      className={cn(ROW, 'grid items-center gap-3 font-mono text-[12px] leading-[1.45] transition-colors hover:bg-bg-muted')}
      style={EXPERIMENT_GRID}
    >
      <span className="truncate text-text">{exp.name}</span>
      <span className="truncate text-text-muted">{exp.prompt_name}</span>
      <span className="truncate text-text-muted">{exp.run_model}</span>
      {/* Scores keep their tier colour — the same >=0.80 / >=0.60 ramp the
          evals and prompts tables use, so a weak run reads alike everywhere. */}
      <span className={cn('tabular-nums', scoreColor(exp.avg_score_a))}>{fmtScore(exp.avg_score_a)}</span>
      <span className={cn('tabular-nums', scoreColor(exp.avg_score_b))}>{fmtScore(exp.avg_score_b)}</span>
      <span className={cn(
        'tabular-nums',
        delta == null ? 'text-text-faint' : delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-text-muted',
      )}>
        {fmtDelta(delta)}
      </span>
      <span className="tabular-nums text-text-muted">{fmtUsd(exp.total_cost_usd)}</span>
      <span className="text-text-muted">{relAge(exp.started_at, now)}</span>
      <span><StatusPill variant={STATUS_TAG[exp.status]}>{exp.status}</StatusPill></span>
    </Link>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function ExperimentsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()
  // Anchor for the relative STARTED column. Captured once after hydration so
  // SSR and the first client paint emit identical HTML (gotcha #22 B).
  const now = useHydrationSafeNow()

  const experiments = useExperiments()
  const [newOpen, setNewOpen] = useState(false)

  // URL-backed search + status filter — shareable, survives reload.
  const search = sp.get('q') ?? ''
  const statusFilter = (sp.get('status') ?? 'all') as StatusFilter
  const tabParam = sp.get('tab')
  const tab: 'all' | 'active' | 'completed' =
    tabParam === 'active' ? 'active' :
    tabParam === 'completed' ? 'completed' : 'all'

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/experiments?${next.toString()}`)
  }

  // Debounced search input → URL.
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const list = useMemo(() => experiments.data ?? [], [experiments.data])
  const filtered = useMemo(() => {
    const needle = search.toLowerCase()
    return list.filter((e) => {
      // Tab gates the list to active vs completed buckets. Within a tab the
      // status segment narrows further (e.g. tab=active + status=failed).
      if (tab === 'active' && !(e.status === 'running' || e.status === 'pending')) return false
      if (tab === 'completed' && e.status !== 'completed') return false
      if (statusFilter !== 'all' && e.status !== statusFilter) return false
      if (!needle) return true
      return (
        e.name.toLowerCase().includes(needle) ||
        e.prompt_name.toLowerCase().includes(needle)
      )
    })
  }, [list, search, statusFilter, tab])

  // Stat strip values — every figure is derivable from the experiments list
  // itself, so the strip costs no extra round trip.
  const runningCount = list.filter((e) => e.status === 'running' || e.status === 'pending').length
  const datasetsUsed = new Set(list.map((e) => e.dataset_id)).size
  const totalCost    = list.reduce((s, e) => s + (e.total_cost_usd ?? 0), 0)
  // Best delta: the widest B-over-A gap across the graded pairs, carrying the
  // experiment that produced it so the figure has a subject.
  const best = useMemo(() => {
    let top: { delta: number; name: string } | null = null
    for (const e of list) {
      if (e.avg_score_a == null || e.avg_score_b == null) continue
      const d = e.avg_score_b - e.avg_score_a
      if (!top || d > top.delta) top = { delta: d, name: e.name }
    }
    return top
  }, [list])

  // CSV / JSON export
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
    a.download = `spanlens-experiments-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    const lines: string[] = []
    lines.push(csvRow(['ID', 'Name', 'Prompt', 'Run Model', 'Status', 'Avg Score A', 'Avg Score B', 'Delta', 'Total Cost USD', 'Started At']))
    for (const e of filtered) {
      const a = e.avg_score_a ?? null
      const b = e.avg_score_b ?? null
      const delta = a != null && b != null ? (b - a) : null
      lines.push(csvRow([
        e.id, e.name, e.prompt_name, e.run_model, e.status,
        a != null ? a.toFixed(4) : '',
        b != null ? b.toFixed(4) : '',
        delta != null ? delta.toFixed(4) : '',
        (e.total_cost_usd ?? 0).toFixed(5),
        e.started_at,
      ]))
    }
    downloadFile(lines.join('\n'), 'text/csv', 'csv')
  }
  function exportJson() {
    downloadFile(JSON.stringify({ experiments: filtered }, null, 2), 'application/json', 'json')
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
      {/* The topbar is the one full-bleed row on the board; everything below
          sits flush inside the shell's content inset. */}
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[{ label: 'Experiments' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={experiments.isFetching} />
              <button
                type="button"
                onClick={() => void experiments.refetch()}
                disabled={experiments.isFetching}
                title="Refresh now"
                className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-muted transition-colors hover:text-text disabled:opacity-40"
              >
                <span className={cn('inline-block', experiments.isFetching && 'animate-spin')}>↻</span>
              </button>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                title="New experiment"
                aria-label="New experiment"
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">New experiment</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Experiments</h1>
      </div>

      <Board>
        {/* Tab strip: All / Active / Completed buckets — consistent with the
            Evals and Datasets pages. Drives the URL ?tab= param. */}
        <Tabs value={tab} onValueChange={(v) => updateQuery({ tab: v === 'all' ? null : v })}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Filter row: the search field runs the width, then the status
            segment, the export menu and the result count. */}
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
              placeholder="Search experiments"
              aria-label="Search by experiment or prompt name"
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

          <Segment>
            {STATUS_FILTERS.map(({ v, l }) => (
              <SegmentItem
                key={v}
                active={statusFilter === v}
                onClick={() => updateQuery({ status: v === 'all' ? null : v })}
              >
                {l}
              </SegmentItem>
            ))}
          </Segment>

          <div ref={exportRef} className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              disabled={filtered.length === 0}
              aria-expanded={exportOpen}
              className={cn(CONTROL, CONTROL_TEXT, 'px-3 transition-colors hover:border-border-strong disabled:opacity-40')}
            >
              Export ▾
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[110px] rounded-md border border-border bg-bg-elev p-1 shadow-card">
                <button
                  type="button"
                  onClick={() => { setExportOpen(false); exportCsv() }}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-[12.5px] text-text-muted transition-colors hover:bg-bg-sunk hover:text-text"
                >CSV</button>
                <button
                  type="button"
                  onClick={() => { setExportOpen(false); exportJson() }}
                  className="block w-full rounded px-2.5 py-1.5 text-left text-[12.5px] text-text-muted transition-colors hover:bg-bg-sunk hover:text-text"
                >JSON</button>
              </div>
            )}
          </div>

          <span className="font-mono text-[11px] text-text-faint">
            {mounted ? (filtered.length === list.length ? `${list.length} experiments` : `${filtered.length} of ${list.length}`) : ' '}
          </span>
        </FilterBar>

        {/* Stat strip */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Experiments"
            value={mounted ? list.length : ' '}
            foot={mounted ? `${runningCount} running now` : ' '}
            {...(runningCount > 0 ? { footClass: 'text-accent' } : {})}
          />
          <StatCard
            label="Datasets used"
            value={mounted ? datasetsUsed : ' '}
            foot="across all experiments"
          />
          <StatCard
            label="Best delta"
            value={mounted ? (best ? fmtDelta(best.delta) : '—') : ' '}
            foot={mounted ? (best ? best.name : 'no graded pairs yet') : ' '}
            {...(best && best.delta > 0 ? { footClass: 'text-good' } : {})}
          />
          <StatCard
            label="Spend on runs"
            value={mounted ? (totalCost > 0 ? fmtUsd(totalCost) : '—') : ' '}
            foot="all experiments"
          />
        </div>

        {/* Explainer with docs link */}
        <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" />
          <span>
            Offline side-by-side: runs both prompt versions on a dataset and compares outputs.
            Unlike A/B (Prompts), no production traffic is affected.
          </span>
          <Link
            href="/docs/features/experiments"
            className="ml-auto text-text transition-opacity hover:opacity-80"
          >
            How experiments work →
          </Link>
        </div>

        {experiments.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-card bg-bg-chip" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="card-surface rounded-card flex flex-col items-center justify-center gap-3 px-5 py-12 text-text-muted">
            <FlaskConical className="h-9 w-9 text-text-faint" />
            <p className="text-[13.5px] font-semibold leading-[1.45] text-text">No experiments yet.</p>
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first experiment
            </button>
            <Link
              href="/docs/features/experiments"
              className="font-mono text-[11px] text-text-muted underline underline-offset-2 hover:text-text"
            >
              How experiments work →
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-surface rounded-card flex h-40 flex-col items-center justify-center gap-3 text-text-muted">
            <p className="text-[12.5px]">No experiments match the current filters.</p>
            <button
              type="button"
              onClick={() => { setSearchInput(''); updateQuery({ q: null, status: null }) }}
              className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          /* The row grid is wider than a narrow viewport, so the card scrolls
             its own table sideways rather than the page. */
          <TableCard>
            <div className="overflow-x-auto">
              <div className="min-w-[1060px]">
                <TableHead>
                  <div className="grid items-center gap-3" style={EXPERIMENT_GRID}>
                    <Th>Experiment</Th>
                    <Th>Prompt</Th>
                    <Th>Model</Th>
                    <Th>A score</Th>
                    <Th>B score</Th>
                    <Th>Delta</Th>
                    <Th>Cost</Th>
                    <Th>Started</Th>
                    <Th>Status</Th>
                  </div>
                </TableHead>
                {filtered.map((exp) => <ExperimentRow key={exp.id} exp={exp} now={now} />)}
              </div>
            </div>
          </TableCard>
        )}
      </Board>

      <NewExperimentDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
