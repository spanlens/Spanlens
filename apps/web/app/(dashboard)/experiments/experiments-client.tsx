'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FlaskConical, Plus, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
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

// Fallback for the first paint before useModels() resolves.
const RUN_MODELS_FALLBACK = {
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-haiku-4-5'],
  gemini: ['gemini-2.5-flash-lite'],
} as const

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return ','
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return ','
  return (n * 100).toFixed(1)
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
  const [evaluatorId, setEvaluatorId] = useState('')
  const [runProvider, setRunProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai')
  const [runModel, setRunModel] = useState<string>('gpt-4o-mini')
  const [error, setError] = useState('')

  // Reset downstream selections when prompt changes
  function handlePromptChange(v: string) {
    setPromptName(v)
    setVersionAId('')
    setVersionBId('')
    setEvaluatorId('')
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
        ...(evaluatorId && { evaluatorId }),
        runProvider,
        runModel,
      })
      onClose()
      setName(''); setPromptName(''); setVersionAId(''); setVersionBId('')
      setDatasetId(''); setEvaluatorId('')
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
            <select
              value={promptName}
              onChange={(e) => handlePromptChange(e.target.value)}
              required
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
            >
              <option value="">Select prompt…</option>
              {(prompts.data ?? []).map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Version A (control)
              </label>
              <select
                value={versionAId}
                onChange={(e) => setVersionAId(e.target.value)}
                disabled={!promptName}
                required
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text disabled:opacity-40"
              >
                <option value="">Select…</option>
                {(versions.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>v{v.version}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Version B (challenger)
              </label>
              <select
                value={versionBId}
                onChange={(e) => setVersionBId(e.target.value)}
                disabled={!promptName}
                required
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text disabled:opacity-40"
              >
                <option value="">Select…</option>
                {(versions.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>v{v.version}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Dataset
            </label>
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              required
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
            >
              <option value="">Select dataset…</option>
              {(datasets.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.item_count ?? 0} items)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Evaluator (optional, for side-by-side scoring)
            </label>
            <select
              value={evaluatorId}
              onChange={(e) => setEvaluatorId(e.target.value)}
              disabled={!promptName}
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text disabled:opacity-40"
            >
              <option value="">None (outputs only, no scoring)</option>
              {(evaluators.data ?? []).map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Run provider
              </label>
              <select
                value={runProvider}
                onChange={(e) => {
                  const p = e.target.value as 'openai' | 'anthropic' | 'gemini'
                  setRunProvider(p)
                  setRunModel(runModels[p][0] ?? '')
                }}
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Run model
              </label>
              <select
                value={runModel}
                onChange={(e) => setRunModel(e.target.value)}
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
              >
                {runModels[runProvider].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
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
      <div className="font-mono text-[12px] text-text-muted w-[90px] text-right">
        {fmtScore(exp.avg_score_a)}
      </div>
      <div className="font-mono text-[12px] text-text-muted w-[90px] text-right">
        {fmtScore(exp.avg_score_b)}
      </div>
      <div className={cn(
        'font-mono text-[12px] w-[80px] text-right',
        delta == null ? 'text-text-faint' : delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-text-muted',
      )}>
        {delta == null ? ',' : (delta > 0 ? '+' : '') + (delta * 100).toFixed(1)}
      </div>
      <div className="font-mono text-[11px] text-text-faint w-[80px] text-right">
        {fmtUsd(exp.total_cost_usd)}
      </div>
    </Link>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function ExperimentsClient() {
  const experiments = useExperiments()
  const [newOpen, setNewOpen] = useState(false)
  const list = experiments.data ?? []

  return (
    <div className="flex flex-col h-full">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Experiments' }]}
        right={
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New experiment
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <FlaskConical className="h-3.5 w-3.5" />
          <span>
            Offline side-by-side: runs both prompt versions on a dataset and compares outputs.
            Unlike A/B (Prompts), no production traffic is affected.
          </span>
        </div>

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
          </div>
        ) : (
          <>
            <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span className="flex-1">Name</span>
              <span className="w-[90px] text-right">A score</span>
              <span className="w-[90px] text-right">B score</span>
              <span className="w-[80px] text-right">Δ</span>
              <span className="w-[80px] text-right">Cost</span>
            </div>
            {list.map((exp) => <ExperimentRow key={exp.id} exp={exp} />)}
          </>
        )}
      </div>

      <NewExperimentDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
