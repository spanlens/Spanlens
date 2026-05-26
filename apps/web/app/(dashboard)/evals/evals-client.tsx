'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  useDatasets,
  useCreateDataset,
  useBulkAddDatasetItems,
} from '@/lib/queries/use-datasets'
import { parseUploadedFile, generateUploadName } from '@/lib/dataset-upload'
import { useCorrelation, pearsonR } from '@/lib/queries/use-human-evals'
import { useModels } from '@/lib/queries/use-models'

// Fallback used only when /api/v1/models is still loading. Real list comes
// from useModels(). Keep this minimal — just enough to render <select>
// without an empty initial frame.
const JUDGE_MODELS_FALLBACK = {
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
  const { data: modelsCatalog } = useModels()
  // Map the catalog's full shape down to the openai/anthropic strings that
  // this picker needs. Gemini is excluded — the eval API only supports
  // OpenAI/Anthropic judges as of 2026-05.
  const judgeModels: { openai: string[]; anthropic: string[]; gemini: string[] } = {
    openai: (modelsCatalog?.openai ?? []).map((m) => m.model),
    anthropic: (modelsCatalog?.anthropic ?? []).map((m) => m.model),
    gemini: (modelsCatalog?.gemini ?? []).map((m) => m.model),
  }
  if (judgeModels.openai.length === 0) judgeModels.openai = [...JUDGE_MODELS_FALLBACK.openai]
  if (judgeModels.anthropic.length === 0) judgeModels.anthropic = [...JUDGE_MODELS_FALLBACK.anthropic]
  if (judgeModels.gemini.length === 0) judgeModels.gemini = [...JUDGE_MODELS_FALLBACK.gemini]

  const [promptName, setPromptName] = useState('')
  const [name, setName] = useState('')
  const [criterion, setCriterion] = useState('')
  const [judgeProvider, setJudgeProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai')
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
                  const p = e.target.value as 'openai' | 'anthropic' | 'gemini'
                  setJudgeProvider(p)
                  setJudgeModel(judgeModels[p][0] ?? '')
                }}
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
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
                {judgeModels[judgeProvider].map((m) => (
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
  const createDataset = useCreateDataset()
  const bulkAddItems = useBulkAddDatasetItems()

  const [versionIdRaw, setVersionId] = useState('')
  const [source, setSource] = useState<'production' | 'dataset'>('production')
  const [datasetId, setDatasetId] = useState('')
  const [sampleSize, setSampleSize] = useState(50)
  const [days, setDays] = useState(7)
  const [error, setError] = useState('')
  // For dataset mode: which provider+model runs the prompt before judging.
  // Production mode doesn't need these — responses are already in CH.
  const [runProvider, setRunProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai')
  const [runModel, setRunModel] = useState('gpt-4o-mini')
  const modelsCatalog = useModels()
  const runModelOptions = (modelsCatalog.data?.[runProvider] ?? []).map((m) => m.model)
  const [uploadingState, setUploadingState] = useState<'idle' | 'uploading' | 'done'>('idle')
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file twice still fires onChange.
    if (e.target) e.target.value = ''
    if (!file) return

    setUploadMsg(null)
    setUploadingState('uploading')
    try {
      // 1. Parse client-side. Failures here mean malformed file — no API call.
      const { items, warnings } = await parseUploadedFile(file)
      if (items.length === 0) {
        setError('No valid items in file')
        setUploadingState('idle')
        return
      }

      // 2. Create a fresh dataset with an auto-generated name. User can
      //    rename / delete from /datasets later if they want.
      const created = await createDataset.mutateAsync({
        name: generateUploadName(),
        description: `Uploaded from ${file.name} (${items.length} items)`,
      })

      // 3. Bulk insert items. Server reports per-row skip reasons.
      const result = await bulkAddItems.mutateAsync({
        datasetId: created.id,
        items,
      })

      setDatasetId(created.id)
      setUploadingState('done')
      const skippedNote = result.skipped.length > 0
        ? `, ${result.skipped.length} skipped by server`
        : ''
      const warnNote = warnings.length > 0
        ? `, ${warnings.length} warnings client-side`
        : ''
      setUploadMsg(`Uploaded ${result.inserted} items${skippedNote}${warnNote}.`)
    } catch (err) {
      setUploadingState('idle')
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

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
    if (source === 'dataset' && !runModel) { setError('Select a model to run the prompt'); return }
    try {
      const run = await createRun.mutateAsync({
        evaluatorId: evaluator.id,
        promptVersionId: versionId,
        source,
        sampleSize,
        ...(source === 'dataset' && datasetId && { datasetId, runProvider, runModel }),
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
              <div className="flex gap-1.5">
                <select
                  value={datasetId}
                  onChange={(e) => setDatasetId(e.target.value)}
                  required
                  className="flex-1 h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text"
                >
                  <option value="">Select dataset…</option>
                  {(datasets.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.item_count ?? 0} items)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingState === 'uploading'}
                  className="font-mono text-[11px] px-3 py-1 rounded-[4px] border border-border bg-bg-elev hover:bg-bg-muted disabled:opacity-50 transition-colors whitespace-nowrap"
                  title="Upload JSON or CSV. Saved as a new dataset with an auto-generated name; rename or delete from /datasets later."
                >
                  {uploadingState === 'uploading' ? 'Uploading…' : '+ Upload'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  onChange={(e) => void handleFileUpload(e)}
                  className="hidden"
                />
              </div>
              {uploadMsg && (
                <p className="font-mono text-[10px] text-good mt-1">{uploadMsg}</p>
              )}
              <p className="font-mono text-[10px] text-text-faint mt-1">
                JSON: array of <code>{`{ input, expected_output? }`}</code>.
                CSV: header row <code>input,expected_output</code>. Uploads
                are saved as datasets (auto-named) so you can re-run later.
              </p>

              {/* Generator picker — dataset items hold inputs only; we need
                  a provider+model to actually run the prompt against each
                  input before the judge can score the response. */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                    Run provider
                  </label>
                  <select
                    value={runProvider}
                    onChange={(e) => {
                      const p = e.target.value as 'openai' | 'anthropic' | 'gemini'
                      setRunProvider(p)
                      const opts = (modelsCatalog.data?.[p] ?? []).map((m) => m.model)
                      setRunModel(opts[0] ?? '')
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
                    {runModelOptions.length === 0 && <option value="">Loading…</option>}
                    {runModelOptions.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="font-mono text-[10px] text-text-faint mt-1">
                Runs each dataset input through this model first, then the judge
                scores the generated response.
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

/**
 * One row in "Lowest-scoring samples". Click to expand → shows full
 * reasoning (no line clamp) + a link to the source request when this row
 * came from production traffic. Dataset-source rows don't have a
 * /requests/[id] target — they expand to reasoning only since the
 * dataset item input isn't fetched here (would need a separate query).
 */
function LowestScoreRow({
  res,
}: {
  res: { id: string; score: number; reasoning: string | null; judge_cost_usd: number; request_id: string | null; dataset_item_id: string | null }
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setOpen((v) => !v)
        }
      }}
      className="block p-2 rounded-[5px] border border-border hover:bg-bg-muted transition-colors cursor-pointer"
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
        <p className={`font-mono text-[10.5px] text-text-muted ${open ? '' : 'line-clamp-2'}`}>
          {res.reasoning}
        </p>
      )}
      {open && res.request_id && (
        <div className="mt-2 pt-2 border-t border-border">
          <a
            href={`/requests/${res.request_id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[10.5px] text-accent hover:underline"
          >
            → View source request
          </a>
        </div>
      )}
      {open && !res.request_id && res.dataset_item_id && (
        <div className="mt-2 pt-2 border-t border-border">
          <span className="font-mono text-[10.5px] text-text-faint">
            Dataset item · {res.dataset_item_id.slice(0, 8)}
          </span>
        </div>
      )}
    </div>
  )
}

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

            {/* Samples — bottom-5 by default, toggle to see all 12 */}
            <SampleList samples={results.data} />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Eval results sorted ascending by score (server enforces, see
 * apps/server/src/api/evals.ts). We show the worst 5 by default —
 * that's where prompt-engineering effort pays off — with a toggle to
 * reveal every scored sample for the curious. Avoids the confusion
 * users hit when the visible 5 don't reconcile with the panel's
 * average score (the hidden samples are higher and pull avg up).
 */
function SampleList({
  samples,
}: {
  samples: Array<{ id: string; score: number; reasoning: string | null; judge_cost_usd: number; request_id: string | null; dataset_item_id: string | null }>
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? samples : samples.slice(0, 5)
  const total = samples.length
  const moreCount = total - 5

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">
        {showAll
          ? `All samples · ${total}`
          : `Lowest-scoring · ${Math.min(5, total)} of ${total}`}
      </p>
      <div className="space-y-2">
        {visible.map((res) => (
          <LowestScoreRow key={res.id} res={res} />
        ))}
      </div>
      {moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full mt-2 py-2 font-mono text-[10.5px] text-accent hover:bg-bg-muted rounded-[5px] border border-dashed border-border transition-colors"
        >
          {showAll ? 'show less' : 'show all'}
        </button>
      )}
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
      {/* Outer container is a div, not a button: HTML forbids nested buttons,
          and we need the Run/Delete buttons inside the same row. Keyboard
          activation is preserved via role="button" + Enter/Space handlers. */}
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
        className="w-full flex items-center px-[16px] py-[12px] hover:bg-bg-muted transition-colors text-left cursor-pointer"
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
      </div>

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
          {/* Diagonal reference line, perfect agreement */}
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

          {/* Correlation card, appears only if Annotation has paired samples */}
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
