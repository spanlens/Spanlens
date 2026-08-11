'use client'
import { Plus, Trash2 } from 'lucide-react'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import type { EvaluatorType, JudgeAnchor } from '@/lib/queries/use-evals'
import { PROVIDER_OPTIONS, type EvalProvider } from '../../_shared/providers'

/**
 * Criterion + judge provider/model + the optional rubric & calibration
 * anchors. Rendered for the `llm_judge` and `trajectory` evaluator types.
 *
 * All state lives in NewEvaluatorDialog and arrives as props — this is a
 * presentation split, not a state-ownership change.
 */
export function JudgeFields({
  evaluatorType,
  criterion,
  setCriterion,
  judgeProvider,
  setJudgeProvider,
  judgeModel,
  setJudgeModel,
  judgeModels,
  rubric,
  setRubric,
  anchors,
  setAnchors,
  scaleMin,
  scaleMax,
}: {
  evaluatorType: EvaluatorType
  criterion: string
  setCriterion: (value: string) => void
  judgeProvider: EvalProvider
  setJudgeProvider: (value: EvalProvider) => void
  judgeModel: string
  setJudgeModel: (value: string) => void
  judgeModels: Record<EvalProvider, string[]>
  rubric: string
  setRubric: (value: string) => void
  anchors: JudgeAnchor[]
  setAnchors: React.Dispatch<React.SetStateAction<JudgeAnchor[]>>
  scaleMin: number
  scaleMax: number
}) {
  return (
    <>
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
          <Select value={judgeProvider || undefined} onValueChange={(v) => {
              const p = v as EvalProvider
              setJudgeProvider(p)
              setJudgeModel(judgeModels[p][0] ?? '')
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
            Judge model
          </label>
          <Select {...(judgeModel ? { value: judgeModel } : {})} onValueChange={setJudgeModel}>
            <SelectTrigger><SelectValue placeholder="Select model…" /></SelectTrigger>
            <SelectContent>
              {judgeModels[judgeProvider].map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="font-mono text-[10.5px] text-text-faint mt-1">
            Pass/fail and classification checks usually score just as well on a smaller, cheaper model like Haiku or gpt-4o-mini. Save the larger judges for nuanced 0–1 scoring.
          </p>
        </div>
      </div>

      {/* P1-7: optional rubric + few-shot calibration anchors. Collapsed
          by default so the common case stays a one-field form. Anchors
          are response examples, which don't apply to a trajectory, so
          this whole block is llm_judge-only. */}
      {evaluatorType === 'llm_judge' && (
      <details className="border border-border rounded-[5px] px-3 py-2">
        <summary className="font-mono text-[11px] text-text-muted cursor-pointer select-none">
          Advanced: rubric &amp; calibration anchors (optional)
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Scoring rubric
            </label>
            <textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={3}
              placeholder="e.g. 1.0 = fully correct and complete · 0.5 = partially correct · 0 = wrong or off-topic"
              className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[11.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-y"
            />
            <p className="font-mono text-[10.5px] text-text-faint mt-1">
              Free-form guidance injected into the judge prompt for consistent scoring.
            </p>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Calibration anchors
            </label>
            <div className="space-y-2">
              {anchors.map((a, i) => (
                <div key={i} className="border border-border rounded-[5px] p-2 space-y-2">
                  <div className="flex gap-2 items-start">
                    <textarea
                      value={a.response}
                      onChange={(e) =>
                        setAnchors((prev) => prev.map((x, j) => (j === i ? { ...x, response: e.target.value } : x)))
                      }
                      rows={2}
                      placeholder="Example response…"
                      className="flex-1 px-2 py-1.5 rounded-[4px] border border-border bg-bg font-mono text-[11.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-y"
                    />
                    <div className="flex flex-col gap-1 w-[64px] shrink-0">
                      <input
                        type="number"
                        step={0.1}
                        min={scaleMin}
                        max={scaleMax}
                        value={Number.isFinite(a.score) ? String(a.score) : ''}
                        onChange={(e) =>
                          setAnchors((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, score: e.target.value === '' ? NaN : Number(e.target.value) } : x,
                            ),
                          )
                        }
                        placeholder="score"
                        className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[11.5px] text-text text-center placeholder:text-text-faint focus:outline-none focus:border-border-strong"
                      />
                      <button
                        type="button"
                        onClick={() => setAnchors((prev) => prev.filter((_, j) => j !== i))}
                        className="h-7 flex items-center justify-center rounded-[4px] border border-border text-text-faint hover:text-bad hover:border-bad/40 transition-colors"
                        aria-label="Remove anchor"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={a.reasoning ?? ''}
                    onChange={(e) =>
                      setAnchors((prev) => prev.map((x, j) => (j === i ? { ...x, reasoning: e.target.value } : x)))
                    }
                    placeholder="why this score (optional)"
                    className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[11px] text-text-muted placeholder:text-text-faint focus:outline-none focus:border-border-strong"
                  />
                </div>
              ))}
            </div>
            {anchors.length < 10 && (
              <button
                type="button"
                onClick={() => setAnchors((prev) => [...prev, { response: '', score: Number.NaN }])}
                className="mt-2 font-mono text-[11px] px-2 py-1 rounded-[4px] border border-border hover:bg-bg-elev flex items-center gap-1 transition-colors"
              >
                <Plus className="h-3 w-3" /> Add anchor
              </button>
            )}
            <p className="font-mono text-[10.5px] text-text-faint mt-1">
              Example response → score ({scaleMin}–{scaleMax}). Anchors the judge&apos;s scale. Up to 10.
            </p>
          </div>
        </div>
      </details>
      )}
    </>
  )
}
