'use client'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { useDatasets } from '@/lib/queries/use-datasets'
import { PROVIDER_OPTIONS, type EvalProvider } from '../../_shared/providers'

/**
 * P2-10: auto-run on new prompt version (golden regression suite).
 *
 * The dataset list query lives here because this block is its only consumer;
 * the block itself always renders, so the query's mount lifecycle matches
 * what NewEvaluatorDialog did when the call sat at the top of the dialog.
 */
export function AutoRunSection({
  enabled,
  setEnabled,
  datasetId,
  setDatasetId,
  provider,
  setProvider,
  model,
  setModel,
  judgeModels,
}: {
  enabled: boolean
  setEnabled: (value: boolean) => void
  datasetId: string
  setDatasetId: (value: string) => void
  provider: EvalProvider
  setProvider: (value: EvalProvider) => void
  model: string
  setModel: (value: string) => void
  judgeModels: Record<EvalProvider, string[]>
}) {
  const datasets = useDatasets()

  return (
    <div className="border-t border-border pt-3">
      <label className="flex items-center gap-2 font-mono text-[11.5px] text-text-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Auto-run on each new version of this prompt
      </label>
      <p className="font-mono text-[10.5px] text-text-faint mt-1">
        Runs this evaluator against a dataset whenever a new version is created. Spends your provider key.
      </p>
      {enabled && (
        <div className="mt-2 space-y-2">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Dataset
            </label>
            <Select {...(datasetId ? { value: datasetId } : {})} onValueChange={setDatasetId}>
              <SelectTrigger><SelectValue placeholder="Select dataset…" /></SelectTrigger>
              <SelectContent>
                {(datasets.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Run provider
              </label>
              <Select value={provider} onValueChange={(v) => {
                  const p = v as EvalProvider
                  setProvider(p)
                  setModel(judgeModels[p][0] ?? '')
                }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
              <Select {...(model ? { value: model } : {})} onValueChange={setModel}>
                <SelectTrigger><SelectValue placeholder="Select model…" /></SelectTrigger>
                <SelectContent>
                  {judgeModels[provider].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
