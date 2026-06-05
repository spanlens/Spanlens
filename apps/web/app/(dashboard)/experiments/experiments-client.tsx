'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FlaskConical, Plus, Loader2, Search } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
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

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

// Fallback for the first paint before useModels() resolves.
const RUN_MODELS_FALLBACK = {
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-haiku-4-5'],
  gemini: ['gemini-2.5-flash-lite'],
} as const

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(1)
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

function StatusBadge({ status }: { status: ExperimentStatus }) {
  const config = {
    pending:   { label: 'Pending',   cls: 'bg-bg-elev text-text-faint' },
    running:   { label: 'Running',   cls: 'bg-accent-bg text-accent border border-accent-border' },
    completed: { label: 'Completed', cls: 'bg-good/10 text-good border border-good/30' },
    failed:    { label: 'Failed',    cls: 'bg-bad/10 text-bad border border-bad/30' },
  }[status]
  return (
    <span className={cn('font-mono text-[10px] px-[6px] py-[1.5px] rounded-[3px]', config.cls)}>
      {config.label}
    </span>
  )
}

type StatusFilter = 'all' | ExperimentStatus

const STATUS_FILTERS: { v: StatusFilter; l: string }[] = [
  { v: 'all',       l: 'All' },
  { v: 'running',   l: 'running' },
  { v: 'completed', l: 'completed' },
  { v: 'pending',   l: 'pending' },
  { v: 'failed',    l: 'failed' },
]

// ── New experiment dialog ────────────────────────────────────────────────────

function NewExperimentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prompts = usePrompts()
  const datasets = useDatasets()
  const create = useCreateExperiment()
  const { data: modelsCatalog } = useModels()
  const runModels: { openai: string[]; anthropic: string[]; gemini: string[] } = {
    openai: (modelsCatalog?.openai ?? []).map((m) => m.model),
    anthropic: (modelsCatalog?.anthropic ?? []).map((m) => m.model),
    gemini: (modelsCatalog?.gemini ?? []).map((m) => m.model),
  }
  if (runModels.openai.length === 0) runModels.openai = [...RUN_MODELS_FALLBACK.openai]
  if (runModels.anthropic.length === 0) runModels.anthropic = [...RUN_MODELS_FALLBACK.anthropic]
  if (runModels.gemini.length === 0) runModels.gemini = [...RUN_MODELS_FALLBACK.gemini]

  const [name, setName] = useState('')
  const [promptName, setPromptName] = useState('')
  const versions = usePromptVersions(promptName || null)
  const evaluators = useEvaluators(promptName || undefined)
  const [versionAId, setVersionAId] = useState('')
  const [versionBId, setVersionBId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [evaluatorId, setEvaluatorId] = useState('__none__')
  const [runProvider, setRunProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai')
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
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friendliness v2 vs v3"
              required
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Prompt
            </label>
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
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Version A (control)
              </label>
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
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Version B (challenger)
              </label>
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
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Dataset
            </label>
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
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
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
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Run provider
              </label>
              <Select value={runProvider} onValueChange={(v) => { const p = v as 'openai' | 'anthropic' | 'gemini'; setRunProvider(p); setRunModel(runModels[p][0] ?? '') }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Run model
              </label>
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

          <div className="bg-bg-muted rounded-[5px] border border-border p-2.5 font-mono text-[10.5px] text-text-muted">
            Both versions run on the same model. Cost charged to your provider key
            (≈ 2× dataset items, + judge if evaluator selected).
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
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
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

function ExperimentRow({ exp }: { exp: Experiment }) {
  const delta = useMemo(() => {
    if (exp.avg_score_a == null || exp.avg_score_b == null) return null
    return exp.avg_score_b - exp.avg_score_a
  }, [exp.avg_score_a, exp.avg_score_b])

  return (
    <Link
      href={`/experiments/${exp.id}`}
      className="flex items-center px-[16px] py-[12px] border-b border-border last:border-0 hover:bg-bg-muted transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-mono text-[13px] text-text font-medium truncate">{exp.name}</p>
          <StatusBadge status={exp.status} />
        </div>
        <p className="font-mono text-[11px] text-text-faint truncate">
          {exp.prompt_name} · {exp.run_model}
        </p>
      </div>
      {/* A score — hidden on mobile (cramped). Score color tier matches evals/prompts. */}
      <div className={cn('hidden sm:block font-mono text-[12px] w-[90px] text-right tabular-nums', scoreColor(exp.avg_score_a))}>
        {fmtScore(exp.avg_score_a)}
      </div>
      {/* B score — hidden on mobile */}
      <div className={cn('hidden sm:block font-mono text-[12px] w-[90px] text-right tabular-nums', scoreColor(exp.avg_score_b))}>
        {fmtScore(exp.avg_score_b)}
      </div>
      <div className={cn(
        'font-mono text-[12px] w-[60px] sm:w-[80px] text-right tabular-nums',
        delta == null ? 'text-text-faint' : delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-text-muted',
      )}>
        {delta == null ? '—' : (delta > 0 ? '+' : '') + (delta * 100).toFixed(1)}
      </div>
      <div className="font-mono text-[11px] text-text-faint w-[70px] sm:w-[80px] text-right tabular-nums">
        {fmtUsd(exp.total_cost_usd)}
      </div>
    </Link>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function ExperimentsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

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
      // status dropdown can narrow further (e.g. tab=active + status=failed).
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

  // Stat strip values
  const runningCount   = list.filter((e) => e.status === 'running' || e.status === 'pending').length
  const completedCount = list.filter((e) => e.status === 'completed').length
  const totalCost      = list.reduce((s, e) => s + (e.total_cost_usd ?? 0), 0)

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
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
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
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', experiments.isFetching && 'animate-spin')}>↻</span>
              </button>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                title="New experiment"
                aria-label="New experiment"
                className="font-mono text-[11.5px] px-2 sm:px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">New experiment</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Experiments</h1>
      </div>

      {/* Stat strip — Total / Running / Completed / Spend. Wraps on mobile. */}
      <div className="shrink-0 border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            { label: 'Experiments', value: String(list.length) },
            { label: 'Running',     value: String(runningCount), warn: runningCount > 0 },
            { label: 'Completed',   value: String(completedCount) },
            { label: 'Total spend', value: totalCost > 0 ? fmtUsd(totalCost) : '—' },
          ].map((s, i) => (
            <div
              key={s.label}
              className={cn(
                'px-[18px] py-[14px] border-border',
                // Vertical rule: alternate cols on 2-up mobile, all but last on md+.
                i % 2 === 0 && 'border-r md:border-r',
                i === 1 && 'md:border-r',
                i === 2 && 'md:border-r',
                // Bottom rule between mobile rows.
                i < 2 && 'border-b md:border-b-0',
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className={cn('text-[22px] sm:text-[24px] font-medium leading-none tracking-[-0.6px] tabular-nums', s.warn ? 'text-accent' : 'text-text')}>
                {mounted ? s.value : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tab strip: All / Active / Completed buckets — consistent with the
          Evals and Datasets pages. Drives the URL ?tab= param. */}
      <div className="shrink-0 border-b border-border bg-bg flex items-center gap-1 px-[22px]">
        {(['all', 'active', 'completed'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => updateQuery({ tab: t === 'all' ? null : t })}
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.06em] px-3 py-2.5 transition-colors relative',
              tab === t ? 'text-text' : 'text-text-faint hover:text-text-muted',
            )}
          >
            {t === 'all' ? 'All' : t === 'active' ? 'Active' : 'Completed'}
            {tab === t && (
              <span className="absolute bottom-[-1px] left-3 right-3 h-[2px] bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Info banner with docs link */}
      <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted flex-wrap">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" />
        <span>
          Offline side-by-side: runs both prompt versions on a dataset and compares outputs.
          Unlike A/B (Prompts), no production traffic is affected.
        </span>
        <Link
          href="/docs/features/experiments"
          className="text-text hover:opacity-80 transition-opacity ml-auto"
        >
          How experiments work →
        </Link>
      </div>

      {/* Filter row: search + status + export */}
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
            placeholder="Search by name or prompt…"
            className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map(({ v, l }) => (
            <button
              key={v}
              type="button"
              onClick={() => updateQuery({ status: v === 'all' ? null : v })}
              className={cn(
                'font-mono text-[11px] px-[9px] py-[3px] rounded-[4px] border transition-colors',
                statusFilter === v
                  ? 'border-border-strong bg-bg-elev text-text'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {l}
            </button>
          ))}
        </div>

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
          {mounted ? (filtered.length === list.length ? `${list.length} experiments` : `${filtered.length} of ${list.length}`) : ' '}
        </span>
      </div>

      <div>
        {experiments.isLoading ? (
          <div className="p-[22px] space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
            <FlaskConical className="h-10 w-10 text-text-faint" />
            <p className="font-mono text-[13px]">No experiments yet.</p>
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first experiment
            </button>
            <Link
              href="/docs/features/experiments"
              className="font-mono text-[11.5px] mt-1 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
            >
              How experiments work →
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-text-muted">
            <p className="font-mono text-[12.5px]">No experiments match the current filters.</p>
            <button
              type="button"
              onClick={() => { setSearchInput(''); updateQuery({ q: null, status: null }) }}
              className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span className="flex-1">Name</span>
              <span className="hidden sm:block w-[90px] text-right">A score</span>
              <span className="hidden sm:block w-[90px] text-right">B score</span>
              <span className="w-[60px] sm:w-[80px] text-right">Δ</span>
              <span className="w-[70px] sm:w-[80px] text-right">Cost</span>
            </div>
            {filtered.map((exp) => <ExperimentRow key={exp.id} exp={exp} />)}
          </>
        )}
      </div>

      <NewExperimentDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
