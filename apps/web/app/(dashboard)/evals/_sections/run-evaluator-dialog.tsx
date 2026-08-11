'use client'
import { useEffect, useRef, useState } from 'react'
import { Play, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import {
  useCreateEvalRun,
  useEstimateEvalCost,
  type Evaluator,
} from '@/lib/queries/use-evals'
import { usePromptVersions } from '@/lib/queries/use-prompts'
import {
  useDatasets,
  useCreateDataset,
  useBulkAddDatasetItems,
} from '@/lib/queries/use-datasets'
import { parseUploadedFile, generateUploadName } from '@/lib/dataset-upload'
import { useModels } from '@/lib/queries/use-models'
import { fmtUsd } from '../_shared/format'
import { PROVIDER_OPTIONS, type EvalProvider } from '../_shared/providers'

// ── Run evaluator dialog ─────────────────────────────────────────────────────

export function RunEvaluatorDialog({
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
  // P1-7 (3/3): pairwise (A vs B) comparison. Pairwise is dataset-only, so
  // switching to it forces the dataset source.
  const [mode, setMode] = useState<'single' | 'pairwise'>('single')
  const [versionBId, setVersionBId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [sampleSize, setSampleSize] = useState(50)
  const [days, setDays] = useState(7)
  const [error, setError] = useState('')
  // For dataset mode: which provider+model runs the prompt before judging.
  // Production mode doesn't need these — responses are already in CH.
  const [runProvider, setRunProvider] = useState<EvalProvider>('openai')
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
  const judgeProvider = evaluator.config.judge_provider
  // P3-13: pass the real provider + criterion length so the estimate isn't a
  // hard-coded gpt-fallback. avgResponseChars is unknown until the runner
  // pulls samples, so the server's default kicks in for it.
  const criterionChars = evaluator.config.criterion?.length ?? 0
  const estimateMutate = estimate.mutateAsync
  useEffect(() => {
    void estimateMutate({ sampleSize, judgeProvider, judgeModel, criterionChars }).catch(() => null)
  }, [sampleSize, judgeProvider, judgeModel, criterionChars, estimateMutate])

  // Pairwise is dataset-only; the single/pairwise toggle drives the source.
  const effectiveSource = mode === 'pairwise' ? 'dataset' : source
  // P2-11 — a trajectory evaluator scores traces (by name), so the run dialog
  // collapses to just a sample size + time window; no version / source.
  const isTrajectory = evaluator.type === 'trajectory'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (isTrajectory) {
      try {
        const run = await createRun.mutateAsync({
          evaluatorId: evaluator.id,
          sampleSize,
          sampleFrom: new Date(Date.now() - days * 86400_000).toISOString(),
        })
        onRunCreated(run.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start')
      }
      return
    }
    if (!versionId) { setError('Select a version'); return }
    if (mode === 'pairwise') {
      if (!versionBId) { setError('Select version B to compare against'); return }
      if (versionBId === versionId) { setError('Version B must differ from version A'); return }
    }
    if (effectiveSource === 'dataset' && !datasetId) { setError('Select a dataset'); return }
    if (effectiveSource === 'dataset' && !runModel) { setError('Select a model to run the prompt'); return }
    try {
      const run = await createRun.mutateAsync({
        evaluatorId: evaluator.id,
        promptVersionId: versionId,
        source: effectiveSource,
        sampleSize,
        ...(mode === 'pairwise' && { mode: 'pairwise', promptVersionBId: versionBId }),
        ...(effectiveSource === 'dataset' && datasetId && { datasetId, runProvider, runModel }),
        ...(effectiveSource === 'production' && {
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
          {isTrajectory && (
            <p className="font-mono text-[11px] text-text-muted bg-bg-muted border border-border rounded-[5px] p-3">
              Scores recent agent traces named{' '}
              <span className="text-text">{evaluator.prompt_name}</span> against the criterion.
              No prompt version needed.
            </p>
          )}
          {!isTrajectory && (
          <>
          {/* Mode toggle: single (absolute score) vs pairwise (A vs B). */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Comparison mode
            </label>
            <div className="flex gap-1 p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`flex-1 px-3 py-1 rounded-[3px] ${mode === 'single' ? 'bg-text text-bg' : 'text-text-muted'}`}
              >
                Single (score)
              </button>
              <button
                type="button"
                onClick={() => { setMode('pairwise'); setSource('dataset') }}
                className={`flex-1 px-3 py-1 rounded-[3px] ${mode === 'pairwise' ? 'bg-text text-bg' : 'text-text-muted'}`}
              >
                Pairwise (A vs B)
              </button>
            </div>
            {mode === 'pairwise' && (
              <p className="font-mono text-[10px] text-text-faint mt-1">
                Runs both versions on the same dataset and asks the judge which wins. Reports B&apos;s win-rate.
              </p>
            )}
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              {mode === 'pairwise' ? 'Version A (baseline)' : 'Version'}
            </label>
            <Select {...(versionId ? { value: versionId } : {})} onValueChange={setVersionId}>
              <SelectTrigger><SelectValue placeholder="Select version…" /></SelectTrigger>
              <SelectContent>
                {(versions.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>v{v.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === 'pairwise' && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Version B (candidate)
              </label>
              <Select {...(versionBId ? { value: versionBId } : {})} onValueChange={setVersionBId}>
                <SelectTrigger><SelectValue placeholder="Select version to compare…" /></SelectTrigger>
                <SelectContent>
                  {(versions.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>v{v.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Source toggle — hidden in pairwise mode (always dataset). */}
          {mode === 'single' && (
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
          )}

          {effectiveSource === 'dataset' && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Dataset
              </label>
              <div className="flex gap-1.5">
                <div className="flex-1">
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
                  <Select value={runProvider || undefined} onValueChange={(v) => {
                      const p = v as EvalProvider
                      setRunProvider(p)
                      const opts = (modelsCatalog.data?.[p] ?? []).map((m) => m.model)
                      setRunModel(opts[0] ?? '')
                    }}>
                    <SelectTrigger><SelectValue placeholder="Select provider…" /></SelectTrigger>
                    <SelectContent>
                      {PROVIDER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                    Run model
                  </label>
                  <Select {...(runModel ? { value: runModel } : {})} onValueChange={setRunModel}>
                    <SelectTrigger><SelectValue placeholder={runModelOptions.length === 0 ? 'Loading…' : 'Select model…'} /></SelectTrigger>
                    <SelectContent>
                      {runModelOptions.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="font-mono text-[10px] text-text-faint mt-1">
                Runs each dataset input through this model first, then the judge
                scores the generated response.
              </p>
            </div>
          )}

          </>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(effectiveSource === 'production' || isTrajectory) && (
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                  Last N days
                </label>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Select days…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={effectiveSource === 'dataset' ? 'col-span-2' : ''}>
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
              disabled={createRun.isPending || (!isTrajectory && !versionId)}
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
