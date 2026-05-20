'use client'

import { useEffect, useMemo, useState } from 'react'
import { Beaker, Play, Trash2, Plus, Loader2, AlertTriangle } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, formatDateTime } from '@/lib/utils'
import {
  useEvaluators,
  useDeleteEvaluator,
  useCreateEvaluator,
  useCreateEvalRun,
  useEvalRuns,
  useEvalRun,
  useEvalResults,
  useEstimateEvalCost,
  type Evaluator,
  type EvalRunStatus,
} from '@/lib/queries/use-evals'
import { usePrompts, usePromptVersions } from '@/lib/queries/use-prompts'
import type { PromptVersion } from '@/lib/queries/use-prompts'
import { useDatasets } from '@/lib/queries/use-datasets'
import { useCorrelation, pearsonR } from '@/lib/queries/use-human-evals'

const JUDGE_MODELS = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
  anthropic: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
} as const

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}`
}

function StatusBadge({ status }: { status: EvalRunStatus }) {
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

// ── New evaluator dialog ─────────────────────────────────────────────────────

function NewEvaluatorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prompts = usePrompts()
  const createMutation = useCreateEvaluator()

  const [promptName, setPromptName] = useState('')
  const [name, setName] = useState('')
  const [criterion, setCriterion] = useState('')
  const [judgeProvider, setJudgeProvider] = useState<'openai' | 'anthropic'>('openai')
  const [judgeModel, setJudgeModel] = useState('gpt-4o-mini')
  const [scaleMin] = useState(0)
  const [scaleMax] = useState(1)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!promptName || !name.trim() || !criterion.trim()) {
      setError('All fields required')
      return
    }
    try {
      await createMutation.mutateAsync({
        promptName,
        name: name.trim(),
        config: {
          criterion: criterion.trim(),
          judge_provider: judgeProvider,
          judge_model: judgeModel,
          scale_min: scaleMin,
          scale_max: scaleMax,
        },
      })
      onClose()
      setName(''); setCriterion(''); setPromptName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New evaluator</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 mt-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Prompt
            </label>
            <select
              value={promptName}
              onChange={(e) => setPromptName(e.target.value)}
              required
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
            >
              <option value="">Select prompt…</option>
              {(prompts.data ?? []).map((p: PromptVersion) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Evaluator name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Friendliness"
              required
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Criterion (what to score)
            </label>
            <textarea
              value={criterion}
              onChange={(e) => setCriterion(e.target.value)}
              rows={3}
              placeholder="e.g. Is the response friendly, polite, and clearly addresses the customer's question?"
              required
              className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-none"
            />
            <p className="font-mono text-[10.5px] text-text-faint mt-1">
              Judge model scores 0–1 against this criterion.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Judge provider
              </label>
              <select
                value={judgeProvider}
                onChange={(e) => {
                  const p = e.target.value as 'openai' | 'anthropic'
                  setJudgeProvider(p)
                  setJudgeModel(JUDGE_MODELS[p][0])
                }}
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Judge model
              </label>
              <select
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
              >
                {JUDGE_MODELS[judgeProvider].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p className="font-mono text-[11.5px] text-bad">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[11.5px] px-3 py-[6px] border border-border rounded-[5px] text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Run evaluator dialog ─────────────────────────────────────────────────────

function RunEvaluatorDialog({
  evaluator,
  onClose,
  onRunCreated,
}: {
  evaluator: Evaluator
  onClose: () => void
  onRunCreated: (runId: string) => void
}) {
  const versions = usePromptVersions(evaluator.prompt_name)
  const datasets = useDatasets()
  const createRun = useCreateEvalRun()
  const estimate = useEstimateEvalCost()

  const [versionIdRaw, setVersionId] = useState('')
  const [source, setSource] = useState<'production' | 'dataset'>('production')
  const [datasetId, setDatasetId] = useState('')
  const [sampleSize, setSampleSize] = useState(50)
  const [days, setDays] = useState(7)
  const [error, setError] = useState('')

  // Derive default selection from query data instead of syncing via an
  // effect. Once the user picks a value, `versionIdRaw` wins.
  const versionId = versionIdRaw || versions.data?.[0]?.id || ''

  const judgeModel = evaluator.config.judge_model
  const estimateMutate = estimate.mutateAsync
  useEffect(() => {
    void estimateMutate({ sampleSize, judgeModel }).catch(() => null)
  }, [sampleSize, judgeModel, estimateMutate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!versionId) { setError('Select a version'); return }
    if (source === 'dataset' && !datasetId) { setError('Select a dataset'); return }
    try {
      const run = await createRun.mutateAsync({
        evaluatorId: evaluator.id,
        promptVersionId: versionId,
        source,
        sampleSize,
        ...(source === 'dataset' && datasetId && { datasetId }),
        ...(source === 'production' && {
          sampleFrom: new Date(Date.now() - days * 86400_000).toISOString(),
        }),
      })
      onRunCreated(run.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run evaluation · {evaluator.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 mt-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Version
            </label>
            <select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              required
              className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
            >
              <option value="">Select version…</option>
              {(versions.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>v{v.version}</option>
              ))}
            </select>
          </div>

          {/* Source toggle */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Sample source
            </label>
            <div className="flex gap-1 p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setSource('production')}
                className={`flex-1 px-3 py-1 rounded-[3px] ${source === 'production' ? 'bg-text text-bg' : 'text-text-muted'}`}
              >
                Production
              </button>
              <button
                type="button"
                onClick={() => setSource('dataset')}
                className={`flex-1 px-3 py-1 rounded-[3px] ${source === 'dataset' ? 'bg-text text-bg' : 'text-text-muted'}`}
              >
                Dataset
              </button>
            </div>
          </div>

          {source === 'dataset' && (
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
              <p className="font-mono text-[10px] text-text-faint mt-1">
                Only items with expected_output are scored.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {source === 'production' && (
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                  Last N days
                </label>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
            )}
            <div className={source === 'dataset' ? 'col-span-2' : ''}>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Sample size
              </label>
              <input
                type="number"
                min={1} max={1000}
                value={sampleSize}
                onChange={(e) => setSampleSize(Math.min(1000, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
              />
            </div>
          </div>

          <div className="bg-bg-muted rounded-[5px] border border-border p-3 font-mono text-[11px] text-text-muted space-y-1">
            <div className="flex justify-between">
              <span>Judge model</span>
              <span className="text-text">{evaluator.config.judge_model}</span>
            </div>
            <div className="flex justify-between">
              <span>Estimated cost (your provider key)</span>
              <span className="text-text">{fmtUsd(estimate.data?.estimateUsd ?? null)}</span>
            </div>
          </div>

          {error && (
            <p className="font-mono text-[11.5px] text-bad">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[11.5px] px-3 py-[6px] border border-border rounded-[5px] text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createRun.isPending || !versionId}
              className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-1.5"
            >
              {createRun.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Run detail panel ─────────────────────────────────────────────────────────

function RunDetailPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = useEvalRun(runId, { pollWhilePending: true })
  const results = useEvalResults(
    run.data?.status === 'completed' ? runId : null,
  )

  // Hooks must be called unconditionally — compute histBuckets even when
  // run.data is null, then early-return below.
  const histBuckets = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0] // 0-0.2, 0.2-0.4, ...
    for (const result of results.data ?? []) {
      const idx = Math.min(4, Math.floor(result.score * 5))
      buckets[idx] = (buckets[idx] ?? 0) + 1
    }
    return buckets
  }, [results.data])
  const maxBucket = Math.max(1, ...histBuckets)

  if (!run.data) {
    return (
      <div className="border-l border-border w-[400px] shrink-0 flex items-center justify-center text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  const r = run.data

  return (
    <div className="border-l border-border w-[420px] shrink-0 overflow-y-auto">
      <div className="sticky top-0 bg-bg-elev border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status} />
          <span className="font-mono text-[11px] text-text-muted">
            {r.scored_count}/{r.sample_size} scored
          </span>
        </div>
        <button onClick={onClose} className="text-text-faint hover:text-text text-xs">✕</button>
      </div>

      <div className="p-4 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">Avg score</p>
            <p className="font-mono text-[16px] text-text font-medium">{fmtScore(r.avg_score)}</p>
          </div>
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">Samples</p>
            <p className="font-mono text-[16px] text-text font-medium">{r.scored_count}</p>
          </div>
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">Cost</p>
            <p className="font-mono text-[16px] text-text font-medium">{fmtUsd(r.total_cost_usd)}</p>
          </div>
        </div>

        {/* Running spinner */}
        {(r.status === 'pending' || r.status === 'running') && (
          <div className="flex items-center gap-2 p-3 bg-accent-bg border border-accent-border rounded-[5px] font-mono text-[11.5px] text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Scoring samples… polling every 2s
          </div>
        )}

        {/* Error */}
        {r.status === 'failed' && r.error && (
          <div className="flex items-start gap-2 p-3 bg-bad/10 border border-bad/30 rounded-[5px] font-mono text-[11.5px] text-bad">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{r.error}</span>
          </div>
        )}

        {/* Histogram */}
        {r.status === 'completed' && results.data && results.data.length > 0 && (
          <>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">
                Score distribution
              </p>
              <div className="flex items-end gap-1 h-20">
                {histBuckets.map((c, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-text/70 rounded-[2px]"
                      style={{ height: `${(c / maxBucket) * 60}px` }}
                    />
                    <span className="font-mono text-[9px] text-text-faint">{c}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-mono text-[9px] text-text-faint mt-1">
                <span>0</span><span>0.2</span><span>0.4</span><span>0.6</span><span>0.8</span><span>1</span>
              </div>
            </div>

            {/* Worst N */}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">
                Lowest-scoring samples
              </p>
              <div className="space-y-2">
                {results.data.slice(0, 5).map((res) => (
                  <a
                    key={res.id}
                    href={res.request_id ? `/requests?id=${res.request_id}` : undefined}
                    className="block p-2 rounded-[5px] border border-border hover:bg-bg-muted transition-colors"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-mono text-[12px] text-text font-medium">
                        {fmtScore(res.score)}
                      </span>
                      <span className="font-mono text-[10px] text-text-faint">
                        {fmtUsd(res.judge_cost_usd)}
                      </span>
                    </div>
                    {res.reasoning && (
                      <p className="font-mono text-[10.5px] text-text-muted line-clamp-2">
                        {res.reasoning}
                      </p>
                    )}
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Evaluator row ────────────────────────────────────────────────────────────

function EvaluatorRow({
  evaluator,
  onRun,
  onSelectRun,
}: {
  evaluator: Evaluator
  onRun: (e: Evaluator) => void
  onSelectRun: (runId: string) => void
}) {
  const runs = useEvalRuns({ evaluatorId: evaluator.id })
  const deleteMutation = useDeleteEvaluator()
  const [expanded, setExpanded] = useState(false)

  const latestCompleted = (runs.data ?? []).find((r) => r.status === 'completed')

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete evaluator "${evaluator.name}"?`)) return
    void deleteMutation.mutateAsync(evaluator.id)
  }

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center px-[16px] py-[12px] hover:bg-bg-muted transition-colors text-left"
        style={{ gridTemplateColumns: '1fr 140px 100px 100px 120px' }}
      >
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[13px] text-text font-medium truncate">{evaluator.name}</p>
          <p className="font-mono text-[11px] text-text-faint truncate">
            {evaluator.prompt_name} · judge: {evaluator.config.judge_model}
          </p>
        </div>
        <div className="font-mono text-[12px] text-text-muted w-[100px] text-right">
          {latestCompleted ? fmtScore(latestCompleted.avg_score) : '—'}
        </div>
        <div className="font-mono text-[11px] text-text-faint w-[80px] text-right">
          {runs.data?.length ?? 0} runs
        </div>
        <div className="flex items-center gap-2 ml-3">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRun(evaluator) }}
            className="font-mono text-[11px] px-2 py-1 rounded-[4px] border border-border hover:bg-bg-elev flex items-center gap-1 transition-colors"
          >
            <Play className="h-3 w-3" />
            Run
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="text-text-faint hover:text-bad transition-colors p-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </button>

      {expanded && (
        <div className="bg-bg-muted/50 px-[16px] py-[10px] border-t border-border">
          {!runs.data || runs.data.length === 0 ? (
            <p className="font-mono text-[11.5px] text-text-faint">No runs yet.</p>
          ) : (
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Recent runs
              </p>
              {runs.data.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRun(r.id)}
                  className="w-full flex items-center gap-3 px-2 py-1.5 rounded-[4px] hover:bg-bg-elev text-left transition-colors"
                >
                  <StatusBadge status={r.status} />
                  <span className="font-mono text-[11.5px] text-text-muted">
                    {formatDateTime(r.started_at)}
                  </span>
                  <span className="font-mono text-[11.5px] text-text-faint">
                    {r.scored_count}/{r.sample_size}
                  </span>
                  <span className="font-mono text-[12px] text-text ml-auto">
                    {fmtScore(r.avg_score)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

// ── Correlation card (LLM judge vs Human) ───────────────────────────────────

function CorrelationCard({ promptName }: { promptName: string }) {
  const correlation = useCorrelation({ promptName })
  const pairs = correlation.data ?? []
  const r = pearsonR(pairs)

  if (pairs.length === 0) return null

  // Scatter plot bounds: 0..1 × 0..1, padded to 120×120
  const W = 120, H = 120, PAD = 6
  const dotX = (judge: number) => PAD + judge * (W - 2 * PAD)
  const dotY = (human: number) => H - PAD - human * (H - 2 * PAD)

  // Interpret r — same buckets as standard correlation rules of thumb.
  const interpretation = r == null
    ? '—'
    : Math.abs(r) >= 0.7 ? 'Strong'
    : Math.abs(r) >= 0.4 ? 'Moderate'
    : Math.abs(r) >= 0.2 ? 'Weak'
    : 'None'

  const rColor = r == null
    ? 'text-text-faint'
    : r >= 0.7 ? 'text-good'
    : r >= 0.4 ? 'text-warn'
    : 'text-bad'

  return (
    <div className="bg-bg-elev border border-border rounded-[6px] p-4">
      <div className="flex items-start gap-4">
        {/* Scatter plot */}
        <svg width={W} height={H} className="shrink-0 bg-bg rounded-[4px] border border-border">
          {/* Diagonal reference line — perfect agreement */}
          <line
            x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD}
            stroke="var(--border-strong, currentColor)"
            strokeOpacity={0.3}
            strokeDasharray="2 2"
          />
          {pairs.map((p) => (
            <circle
              key={p.requestId}
              cx={dotX(p.judgeScore)}
              cy={dotY(p.humanScore)}
              r={2.5}
              className="fill-text/70"
            />
          ))}
        </svg>

        {/* Metrics */}
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="font-mono text-[11px] text-text-faint mb-0.5 truncate">
              {promptName}
            </p>
            <div className="flex items-baseline gap-2">
              <span className={cn('font-mono text-[22px] font-medium', rColor)}>
                {r == null ? '—' : r.toFixed(2)}
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">
                Pearson r · {interpretation}
              </span>
            </div>
          </div>
          <div className="font-mono text-[10.5px] text-text-faint">
            {pairs.length} paired sample{pairs.length === 1 ? '' : 's'}
            {pairs.length < 10 && ' (more data → more reliable)'}
          </div>
        </div>
      </div>
      <p className="font-mono text-[10.5px] text-text-faint mt-3 leading-relaxed">
        Dot = one request judged by both. Dashed line = perfect agreement.
        Low r means your LLM judge disagrees with humans → revise the criterion.
      </p>
    </div>
  )
}

function CorrelationRow({ evaluators }: { evaluators: Evaluator[] }) {
  // Unique prompt names that have at least one evaluator
  const promptNames = useMemo(() => {
    const set = new Set<string>()
    for (const ev of evaluators) set.add(ev.prompt_name)
    return [...set]
  }, [evaluators])

  if (promptNames.length === 0) return null

  return (
    <div className="px-[22px] py-[14px] border-b border-border">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-3">
        <span>LLM judge vs Human agreement</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {promptNames.map((name) => (
          <CorrelationCard key={name} promptName={name} />
        ))}
      </div>
    </div>
  )
}

export function EvalsClient() {
  const evaluators = useEvaluators()
  const [newOpen, setNewOpen] = useState(false)
  const [runDialog, setRunDialog] = useState<Evaluator | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const list = evaluators.data ?? []

  return (
    <div className="flex flex-col h-full">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Evals' }]}
        right={
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New evaluator
          </button>
        }
      />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto">
          {/* Info banner */}
          <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted">
            <Beaker className="h-3.5 w-3.5" />
            <span>
              LLM-as-judge scores production responses against a criterion you define.
              Cost is billed to your provider key.
            </span>
          </div>

          {/* Correlation card — appears only if Annotation has paired samples */}
          {list.length > 0 && <CorrelationRow evaluators={list} />}

          {evaluators.isLoading ? (
            <div className="p-[22px] space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
              <Beaker className="h-10 w-10 text-text-faint" />
              <p className="font-mono text-[13px]">No evaluators yet.</p>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Create your first evaluator
              </button>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                <span className="flex-1">Evaluator</span>
                <span className="w-[100px] text-right">Avg score</span>
                <span className="w-[80px] text-right">Runs</span>
                <span className="w-[150px]" />
              </div>
              {list.map((ev) => (
                <EvaluatorRow
                  key={ev.id}
                  evaluator={ev}
                  onRun={(e) => setRunDialog(e)}
                  onSelectRun={(rid) => setSelectedRunId(rid)}
                />
              ))}
            </>
          )}
        </div>

        {selectedRunId && (
          <RunDetailPanel runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
        )}
      </div>

      <NewEvaluatorDialog open={newOpen} onClose={() => setNewOpen(false)} />

      {runDialog && (
        <RunEvaluatorDialog
          evaluator={runDialog}
          onClose={() => setRunDialog(null)}
          onRunCreated={(rid) => {
            setRunDialog(null)
            setSelectedRunId(rid)
          }}
        />
      )}
    </div>
  )
}
