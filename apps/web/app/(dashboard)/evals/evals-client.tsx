'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Beaker, Play, Trash2, Plus, Loader2, AlertTriangle, Search } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
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
  type CreateEvaluatorInput,
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
import {
  useEvaluatorTemplatesByCategory,
  type EvaluatorTemplate as DbEvaluatorTemplate,
  type EvaluatorTemplateCategory,
} from '@/lib/queries/use-evaluator-templates'
import { useScoreConfigs } from '@/lib/queries/use-score-configs'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'

// Fallback used only when /api/v1/models is still loading. Real list comes
// from useModels(). Keep this minimal — just enough to render <select>
// without an empty initial frame.
const JUDGE_MODELS_FALLBACK = {
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-haiku-4-5'],
  gemini: ['gemini-2.5-flash-lite'],
  azure: ['gpt-4o-mini'],
  mistral: ['mistral-small-latest'],
  openrouter: ['openai/gpt-4o-mini'],
} as const

type EvalProvider = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'

const PROVIDER_OPTIONS: Array<{ value: EvalProvider; label: string }> = [
  { value: 'openai',     label: 'OpenAI' },
  { value: 'anthropic',  label: 'Anthropic' },
  { value: 'gemini',     label: 'Gemini' },
  { value: 'azure',      label: 'Azure OpenAI' },
  { value: 'mistral',    label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
]

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}`
}

// P1-7: half-width of the 95% CI for the mean (normal approx, z=1.96):
// margin = 1.96 * stddev / sqrt(n). Returned on the same 0..1 scale as the
// score; callers render it ×100 to match fmtScore. null when the run can't
// support an interval (no spread stored, or fewer than 2 scored samples).
function ciMargin95(stddev: number | null | undefined, n: number): number | null {
  if (stddev == null || !Number.isFinite(stddev) || n < 2) return null
  return (1.96 * stddev) / Math.sqrt(n)
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

// ── Evaluator templates (used by empty-state quick-start cards) ──────────────
//
// The catalogue lives in the `evaluator_templates` DB table; this client
// consumes it through `useEvaluatorTemplatesByCategory()`. The legacy
// hard-coded list was inlined here before 4A.5.

interface EvaluatorTemplate {
  name: string
  criterion: string
  judgeProvider: EvalProvider
  judgeModel: string
}

/**
 * Adapt a DB row to the shape NewEvaluatorDialog's `initialTemplate` prop
 * already expects. Keeping the legacy field names lets the dialog wiring
 * stay untouched.
 */
function templateFromDb(t: DbEvaluatorTemplate): EvaluatorTemplate {
  return {
    name: t.name,
    criterion: t.criterion,
    judgeProvider: t.recommended_judge_provider,
    judgeModel: t.recommended_judge_model,
  }
}

const CATEGORY_LABELS: Record<EvaluatorTemplateCategory, string> = {
  quality: 'Quality',
  safety: 'Safety',
  cost: 'Cost',
}

const CATEGORY_HELP: Record<EvaluatorTemplateCategory, string> = {
  quality: 'Did the response actually answer the question, in voice, without padding.',
  safety: 'Catch responses that leak data, hallucinate, or follow hidden instructions.',
  cost: 'Find calls where a cheaper model could have produced the same answer.',
}

// ── New evaluator dialog ─────────────────────────────────────────────────────

function NewEvaluatorDialog({
  open,
  onClose,
  initialTemplate,
}: {
  open: boolean
  onClose: () => void
  initialTemplate?: EvaluatorTemplate
}) {
  const prompts = usePrompts()
  const createMutation = useCreateEvaluator()
  const datasets = useDatasets()
  const { data: modelsCatalog } = useModels()
  // Map the catalog's full shape down to the openai/anthropic strings that
  // this picker needs. Gemini is excluded — the eval API only supports
  // OpenAI/Anthropic judges as of 2026-05.
  //
  // Memoised so dependent effects (template sync below) don't re-run on
  // every render and cause loops.
  const judgeModels = useMemo<Record<EvalProvider, string[]>>(() => {
    const next: Record<EvalProvider, string[]> = {
      openai:     (modelsCatalog?.openai ?? []).map((m) => m.model),
      anthropic:  (modelsCatalog?.anthropic ?? []).map((m) => m.model),
      gemini:     (modelsCatalog?.gemini ?? []).map((m) => m.model),
      azure:      (modelsCatalog?.azure ?? []).map((m) => m.model),
      mistral:    (modelsCatalog?.mistral ?? []).map((m) => m.model),
      openrouter: (modelsCatalog?.openrouter ?? []).map((m) => m.model),
    }
    for (const p of Object.keys(JUDGE_MODELS_FALLBACK) as EvalProvider[]) {
      if (next[p].length === 0) next[p] = [...JUDGE_MODELS_FALLBACK[p]]
    }
    return next
  }, [modelsCatalog])

  // Templates specify a model family (e.g. 'gpt-4o-mini'); the catalog may
  // only have dated variants ('gpt-4o-mini-2024-07-18'). Resolve to the
  // first available dated variant under the same family, or fall back to
  // the catalog's first model for the provider.
  function resolveJudgeModel(provider: EvalProvider, preferred: string): string {
    const list = judgeModels[provider]
    if (list.includes(preferred)) return preferred
    const datedMatch = list.find((m) => m.startsWith(preferred + '-'))
    return datedMatch ?? list[0] ?? preferred
  }

  // Template values are picked up by the useState initializers below. Parent
  // remounts the dialog via key={dialogSession} on every "New evaluator" click,
  // so opening with a different template starts the form fresh — no useEffect
  // syncing prop → state (which triggers cascading renders, see lint rule
  // react-hooks/set-state-in-effect).
  const [promptName, setPromptName] = useState('')
  const [name, setName] = useState(initialTemplate?.name ?? '')
  const [criterion, setCriterion] = useState(initialTemplate?.criterion ?? '')
  const [judgeProvider, setJudgeProvider] = useState<EvalProvider>(
    initialTemplate?.judgeProvider ?? 'openai',
  )
  const [judgeModel, setJudgeModel] = useState(() =>
    initialTemplate
      ? resolveJudgeModel(initialTemplate.judgeProvider, initialTemplate.judgeModel)
      : 'gpt-4o-mini',
  )
  const [scaleMin] = useState(0)
  const [scaleMax] = useState(1)
  // Optional pointer at a workspace score_config. Empty string = use the
  // legacy NUMERIC 0..1 path (omits scoreConfigId from the POST body so
  // the server keeps the historic behaviour for pre-4B.1c evaluators).
  const [scoreConfigId, setScoreConfigId] = useState<string>('')
  const scoreConfigsQuery = useScoreConfigs()
  const scoreConfigsList = useMemo(() => scoreConfigsQuery.data ?? [], [scoreConfigsQuery.data])
  const [error, setError] = useState('')

  // R-7 Phase 1: evaluator type. llm_judge keeps the existing form,
  // regex / json_schema swap criterion + provider/model out for a
  // pattern field or a JSON Schema textarea. Templates always create
  // llm_judge evaluators today, so the selector defaults to that even
  // when initialTemplate is set.
  const [evaluatorType, setEvaluatorType] = useState<
    'llm_judge' | 'regex' | 'json_schema' | 'exact_match' | 'contains' | 'embedding'
  >('llm_judge')
  const [regexPattern, setRegexPattern] = useState('')
  const [regexFlags, setRegexFlags] = useState('')
  const [jsonSchemaText, setJsonSchemaText] = useState('{\n  "type": "object"\n}')
  // exact_match / contains config (P2-12)
  const [exactValue, setExactValue] = useState('')
  const [exactCaseSensitive, setExactCaseSensitive] = useState(false)
  const [containsSubstring, setContainsSubstring] = useState('')
  const [containsCaseSensitive, setContainsCaseSensitive] = useState(false)
  // embedding config (P2-12)
  const [embedProvider, setEmbedProvider] = useState('openai')
  const [embedModel, setEmbedModel] = useState('text-embedding-3-small')
  const [embedReferenceText, setEmbedReferenceText] = useState('')
  const [embedThreshold, setEmbedThreshold] = useState('')
  // auto-run on new prompt version (P2-10)
  const [autoRunOnVersion, setAutoRunOnVersion] = useState(false)
  const [autoRunDatasetId, setAutoRunDatasetId] = useState('')
  const [autoRunProvider, setAutoRunProvider] = useState<EvalProvider>('openai')
  const [autoRunModel, setAutoRunModel] = useState('gpt-4o-mini')

  // P2-10: auto-run config is common to all evaluator types, so wrap the
  // mutation to fold it into every create call instead of repeating it.
  const autoRunFields = autoRunOnVersion
    ? {
        autoRunOnVersion: true as const,
        autoRunDatasetId,
        autoRunProvider,
        autoRunModel: autoRunModel.trim(),
      }
    : { autoRunOnVersion: false as const }
  const submitEvaluator = (input: CreateEvaluatorInput) =>
    createMutation.mutateAsync({ ...input, ...autoRunFields })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!promptName || !name.trim()) {
      setError('Prompt and name are required')
      return
    }
    if (autoRunOnVersion && (!autoRunDatasetId || !autoRunModel.trim())) {
      setError('Auto-run needs a dataset and a model')
      return
    }
    try {
      if (evaluatorType === 'llm_judge') {
        if (!criterion.trim()) {
          setError('Criterion is required for LLM-as-judge evaluators')
          return
        }
        await submitEvaluator({
          promptName,
          name: name.trim(),
          config: {
            criterion: criterion.trim(),
            judge_provider: judgeProvider,
            judge_model: judgeModel,
            scale_min: scaleMin,
            scale_max: scaleMax,
          },
          ...(scoreConfigId ? { scoreConfigId } : {}),
        })
      } else if (evaluatorType === 'regex') {
        if (!regexPattern) {
          setError('Pattern is required')
          return
        }
        // Compile-check on the client too — the operator sees the
        // SyntaxError without a server round-trip.
        try {
          new RegExp(regexPattern, regexFlags)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Invalid regex')
          return
        }
        await submitEvaluator({
          promptName,
          name: name.trim(),
          type: 'regex',
          config: { pattern: regexPattern, flags: regexFlags },
        })
      } else if (evaluatorType === 'json_schema') {
        let parsedSchema: unknown
        try {
          parsedSchema = JSON.parse(jsonSchemaText)
        } catch (err) {
          setError(`Schema is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
          return
        }
        if (!parsedSchema || typeof parsedSchema !== 'object' || Array.isArray(parsedSchema)) {
          setError('Schema must be a JSON object')
          return
        }
        await submitEvaluator({
          promptName,
          name: name.trim(),
          type: 'json_schema',
          config: { schema: parsedSchema },
        })
      } else if (evaluatorType === 'exact_match') {
        if (!exactValue) {
          setError('Expected value is required')
          return
        }
        await submitEvaluator({
          promptName,
          name: name.trim(),
          type: 'exact_match',
          config: { value: exactValue, caseSensitive: exactCaseSensitive },
        })
      } else if (evaluatorType === 'contains') {
        if (!containsSubstring) {
          setError('Substring is required')
          return
        }
        await submitEvaluator({
          promptName,
          name: name.trim(),
          type: 'contains',
          config: { substring: containsSubstring, caseSensitive: containsCaseSensitive },
        })
      } else {
        if (!embedModel.trim()) {
          setError('Embedding model is required')
          return
        }
        const threshold = embedThreshold.trim() ? Number(embedThreshold) : undefined
        if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
          setError('Threshold must be between 0 and 1')
          return
        }
        await submitEvaluator({
          promptName,
          name: name.trim(),
          type: 'embedding',
          config: {
            provider: embedProvider,
            model: embedModel.trim(),
            ...(embedReferenceText.trim() ? { reference_text: embedReferenceText.trim() } : {}),
            ...(threshold !== undefined ? { threshold } : {}),
          },
        })
      }
      onClose()
      setName(''); setCriterion(''); setPromptName('')
      setRegexPattern(''); setRegexFlags('')
      setJsonSchemaText('{\n  "type": "object"\n}')
      setExactValue(''); setExactCaseSensitive(false)
      setContainsSubstring(''); setContainsCaseSensitive(false)
      setEmbedReferenceText(''); setEmbedThreshold('')
      setAutoRunOnVersion(false); setAutoRunDatasetId(''); setAutoRunModel('gpt-4o-mini')
      setEvaluatorType('llm_judge')
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
            <Select {...(promptName ? { value: promptName } : {})} onValueChange={setPromptName}>
              <SelectTrigger><SelectValue placeholder="Select prompt…" /></SelectTrigger>
              <SelectContent>
                {(prompts.data ?? []).map((p: PromptVersion) => (
                  <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          {/* R-7 Phase 1: type selector. Switches the rest of the form
              between LLM-as-judge (criterion + provider + model) and the
              two deterministic types (regex pattern, JSON Schema). */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Type
            </label>
            <Select
              value={evaluatorType}
              onValueChange={(v) =>
                setEvaluatorType(
                  v as 'llm_judge' | 'regex' | 'json_schema' | 'exact_match' | 'contains' | 'embedding',
                )
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="llm_judge">LLM as judge</SelectItem>
                <SelectItem value="regex">Regex (pattern match)</SelectItem>
                <SelectItem value="json_schema">JSON Schema (structure check)</SelectItem>
                <SelectItem value="exact_match">Exact match (equals a value)</SelectItem>
                <SelectItem value="contains">Contains (substring present)</SelectItem>
                <SelectItem value="embedding">Embedding similarity (semantic)</SelectItem>
              </SelectContent>
            </Select>
            <p className="font-mono text-[10.5px] text-text-faint mt-1">
              {evaluatorType === 'llm_judge'
                ? 'Judge model scores 0..1 against a free-form criterion.'
                : evaluatorType === 'regex'
                  ? 'Deterministic 0/1 — passes when the pattern matches the response.'
                  : evaluatorType === 'json_schema'
                    ? 'Deterministic 0/1 — passes when the response parses as JSON and matches the schema.'
                    : evaluatorType === 'exact_match'
                      ? 'Deterministic 0/1 — passes when the response equals the expected value.'
                      : evaluatorType === 'contains'
                        ? 'Deterministic 0/1 — passes when the response contains the substring.'
                        : 'Cosine similarity (0..1) of the response vs a reference answer. Uses your provider key.'}
            </p>
          </div>

          {evaluatorType === 'llm_judge' && (
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
                </div>
              </div>
            </>
          )}

          {evaluatorType === 'regex' && (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                  Pattern
                </label>
                <input
                  type="text"
                  value={regexPattern}
                  onChange={(e) => setRegexPattern(e.target.value)}
                  placeholder="e.g. ^\\{.*\\}$"
                  required
                  className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                  Flags
                </label>
                <input
                  type="text"
                  value={regexFlags}
                  onChange={(e) => setRegexFlags(e.target.value)}
                  placeholder="e.g. im"
                  className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
                />
              </div>
            </div>
          )}

          {evaluatorType === 'json_schema' && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                JSON Schema
              </label>
              <textarea
                value={jsonSchemaText}
                onChange={(e) => setJsonSchemaText(e.target.value)}
                rows={8}
                spellCheck={false}
                required
                className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[11.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-y"
              />
              <p className="font-mono text-[10.5px] text-text-faint mt-1">
                Standard JSON Schema (draft-07). Default accepts any object.
              </p>
            </div>
          )}

          {evaluatorType === 'exact_match' && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Expected value
              </label>
              <input
                type="text"
                value={exactValue}
                onChange={(e) => setExactValue(e.target.value)}
                placeholder="e.g. approved"
                required
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
              />
              <label className="flex items-center gap-2 mt-2 font-mono text-[11px] text-text-muted">
                <input
                  type="checkbox"
                  checked={exactCaseSensitive}
                  onChange={(e) => setExactCaseSensitive(e.target.checked)}
                />
                Case-sensitive
              </label>
              <p className="font-mono text-[10.5px] text-text-faint mt-1">
                Trimmed before comparing. Case-insensitive unless checked.
              </p>
            </div>
          )}

          {evaluatorType === 'contains' && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Substring
              </label>
              <input
                type="text"
                value={containsSubstring}
                onChange={(e) => setContainsSubstring(e.target.value)}
                placeholder="e.g. order confirmed"
                required
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
              />
              <label className="flex items-center gap-2 mt-2 font-mono text-[11px] text-text-muted">
                <input
                  type="checkbox"
                  checked={containsCaseSensitive}
                  onChange={(e) => setContainsCaseSensitive(e.target.checked)}
                />
                Case-sensitive
              </label>
              <p className="font-mono text-[10.5px] text-text-faint mt-1">
                Passes when the response contains this text. Case-insensitive unless checked.
              </p>
            </div>
          )}

          {evaluatorType === 'embedding' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                    Embedding provider
                  </label>
                  <Select value={embedProvider} onValueChange={setEmbedProvider}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="azure">Azure</SelectItem>
                      <SelectItem value="mistral">Mistral</SelectItem>
                      <SelectItem value="openrouter">OpenRouter</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                    Model
                  </label>
                  <input
                    type="text"
                    value={embedModel}
                    onChange={(e) => setEmbedModel(e.target.value)}
                    placeholder="text-embedding-3-small"
                    required
                    className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
                  />
                </div>
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                  Reference text
                </label>
                <textarea
                  value={embedReferenceText}
                  onChange={(e) => setEmbedReferenceText(e.target.value)}
                  rows={3}
                  placeholder="The ideal answer to compare responses against…"
                  className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-none"
                />
                <p className="font-mono text-[10.5px] text-text-faint mt-1">
                  Used for production runs. Dataset items use their own expected_output when present.
                </p>
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                  Pass threshold (optional, 0–1)
                </label>
                <input
                  type="text"
                  value={embedThreshold}
                  onChange={(e) => setEmbedThreshold(e.target.value)}
                  placeholder="e.g. 0.8"
                  className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
                />
              </div>
            </>
          )}

          {/* Optional typed score config (LLM-as-judge only). When omitted
              the evaluator falls back to the legacy NUMERIC 0..1 scoring
              path so existing dashboards keep working unchanged. */}
          {evaluatorType === 'llm_judge' && scoreConfigsList.length > 0 && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Score config (optional)
              </label>
              <Select
                value={scoreConfigId || 'NONE'}
                onValueChange={(v) => setScoreConfigId(v === 'NONE' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Numeric 0..1 (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Numeric 0..1 (default)</SelectItem>
                  {scoreConfigsList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {c.data_type.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 font-mono text-[10.5px] text-text-faint">
                Pick a non-numeric config to ask the judge for a category, pass/fail, or free-text label instead of a slider score.
              </p>
            </div>
          )}

          {/* P2-10: auto-run on new prompt version (golden regression suite). */}
          <div className="border-t border-border pt-3">
            <label className="flex items-center gap-2 font-mono text-[11.5px] text-text-muted">
              <input
                type="checkbox"
                checked={autoRunOnVersion}
                onChange={(e) => setAutoRunOnVersion(e.target.checked)}
              />
              Auto-run on each new version of this prompt
            </label>
            <p className="font-mono text-[10.5px] text-text-faint mt-1">
              Runs this evaluator against a dataset whenever a new version is created. Spends your provider key.
            </p>
            {autoRunOnVersion && (
              <div className="mt-2 space-y-2">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                    Dataset
                  </label>
                  <Select {...(autoRunDatasetId ? { value: autoRunDatasetId } : {})} onValueChange={setAutoRunDatasetId}>
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
                    <Select value={autoRunProvider} onValueChange={(v) => {
                        const p = v as EvalProvider
                        setAutoRunProvider(p)
                        setAutoRunModel(judgeModels[p][0] ?? '')
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
                    <Select {...(autoRunModel ? { value: autoRunModel } : {})} onValueChange={setAutoRunModel}>
                      <SelectTrigger><SelectValue placeholder="Select model…" /></SelectTrigger>
                      <SelectContent>
                        {judgeModels[autoRunProvider].map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
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
            <Select {...(versionId ? { value: versionId } : {})} onValueChange={setVersionId}>
              <SelectTrigger><SelectValue placeholder="Select version…" /></SelectTrigger>
              <SelectContent>
                {(versions.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>v{v.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <div className="grid grid-cols-2 gap-3">
            {source === 'production' && (
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
      <div className="fixed inset-0 z-30 bg-bg md:static md:inset-auto md:z-auto border-l border-border md:w-[400px] shrink-0 flex items-center justify-center text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  const r = run.data

  return (
    <div className="fixed inset-0 z-30 bg-bg md:static md:inset-auto md:z-auto border-l border-border md:w-[420px] shrink-0 overflow-y-auto">
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
            <p className={cn('font-mono text-[16px] font-medium tabular-nums', scoreColor(r.avg_score))}>{fmtScore(r.avg_score)}</p>
            {/* P1-7: 95% CI half-width so a small-sample average reads as less
                certain. Hidden when there's no interval (single sample / typed
                config without a mean / pre-migration row). */}
            {(() => {
              const m = ciMargin95(r.score_stddev, r.scored_count)
              return m != null && r.avg_score != null ? (
                <p className="font-mono text-[9px] text-text-faint tabular-nums mt-0.5" title="95% confidence interval (±1.96·σ/√n)">
                  ±{(m * 100).toFixed(1)} · 95% CI
                </p>
              ) : null
            })()}
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

        {/* Scoring-rate warning (P0-2): when some judge calls failed, the avg
            reflects only the scored samples — say so instead of passing a
            partial average off as the full picture. */}
        {r.status === 'completed' && r.failed_count > 0 && r.attempted_count > 0 && (
          <div className="flex items-start gap-2 p-3 bg-warn-bg border border-warn/30 rounded-[5px] font-mono text-[11.5px] text-warn">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Scored {r.scored_count} of {r.attempted_count} attempted
              {' '}({Math.round((r.scored_count / r.attempted_count) * 100)}%).
              {' '}{r.failed_count} judge {r.failed_count === 1 ? 'call' : 'calls'} failed
              {' '}— the average reflects only the scored samples.
            </span>
          </div>
        )}

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
        <div className={cn('font-mono text-[12px] w-[100px] text-right tabular-nums', latestCompleted ? scoreColor(latestCompleted.avg_score) : 'text-text-faint')}>
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
                  <span className={cn('font-mono text-[12px] ml-auto tabular-nums', scoreColor(r.avg_score))}>
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

// ── Runs view (Results tab) ──────────────────────────────────────────────────

function RunsView({
  evaluatorsById,
  onSelectRun,
  selectedRunId,
}: {
  evaluatorsById: Map<string, Evaluator>
  onSelectRun: (id: string) => void
  selectedRunId: string | null
}) {
  const runs = useEvalRuns()
  const list = runs.data ?? []

  if (runs.isLoading) {
    return (
      <div className="p-[22px] space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-bg-elev rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
        <Play className="h-9 w-9 text-text-faint" />
        <p className="font-mono text-[13px]">No runs yet.</p>
        <p className="font-mono text-[11.5px] text-text-faint max-w-[360px] text-center">
          Create an evaluator, then run it against a dataset or production traffic to see results here.
        </p>
      </div>
    )
  }

  // Inline grid template — Tailwind's JIT does not always parse arbitrary
  // grid-cols with commas reliably, so set columns via style for stability.
  const rowGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '160px 1.6fr 110px 90px 90px 90px',
    gap: 12,
    alignItems: 'center',
  }

  return (
    <div>
      {/* Header */}
      <div
        className="px-[22px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint"
        style={rowGridStyle}
      >
        <span>Started</span>
        <span>Evaluator · Prompt</span>
        <span>Status</span>
        <span>Avg score</span>
        <span>Samples</span>
        <span className="text-right">Cost</span>
      </div>
      {list.map((r) => {
        const ev = evaluatorsById.get(r.evaluator_id)
        const isSelected = selectedRunId === r.id
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelectRun(r.id)}
            className={cn(
              'px-[22px] py-[10px] border-b border-border text-left hover:bg-bg-elev transition-colors w-full',
              isSelected && 'bg-bg-elev',
            )}
            style={rowGridStyle}
          >
            <span className="font-mono text-[11px] text-text-muted tabular-nums">
              {formatDateTime(r.started_at)}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] text-text truncate">{ev?.name ?? 'Unknown evaluator'}</div>
              <div className="font-mono text-[10.5px] text-text-faint truncate">
                {ev?.prompt_name ?? '—'} · {r.source}
              </div>
            </div>
            <StatusBadge status={r.status} />
            <span className={cn('font-mono text-[12px] tabular-nums', scoreColor(r.avg_score))}>
              {fmtScore(r.avg_score)}
            </span>
            <span className="font-mono text-[11.5px] text-text-muted tabular-nums">
              {r.scored_count}/{r.sample_size}
            </span>
            <span className="font-mono text-[11.5px] text-text-muted text-right tabular-nums">
              {fmtUsd(r.total_cost_usd)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function EvalsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  const evaluators = useEvaluators()
  const templatesByCategory = useEvaluatorTemplatesByCategory()
  const [newOpen, setNewOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<EvaluatorTemplate | undefined>(undefined)
  // Incremented on every open call so the dialog remounts with fresh useState
  // initializers — avoids prop-to-state syncing via useEffect.
  const [dialogSession, setDialogSession] = useState(0)
  const [runDialog, setRunDialog] = useState<Evaluator | null>(null)
  const [activeCategory, setActiveCategory] = useState<EvaluatorTemplateCategory>('quality')

  function openNewEvaluator(template?: EvaluatorTemplate) {
    setPendingTemplate(template)
    setNewOpen(true)
    setDialogSession((v) => v + 1)
  }
  function closeNewEvaluator() {
    setNewOpen(false)
    setPendingTemplate(undefined)
  }

  // URL-backed state — run pane survives reload, search is shareable.
  const selectedRunId = sp.get('run')
  const search = sp.get('q') ?? ''
  const tabParam = sp.get('tab')
  const tab: 'evaluators' | 'results' = tabParam === 'results' ? 'results' : 'evaluators'
  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/evals?${next.toString()}`)
  }
  function setSelectedRunId(id: string | null) { updateQuery({ run: id }) }
  function clearRun() { updateQuery({ run: null }) }
  function setTab(t: 'evaluators' | 'results') {
    updateQuery({ tab: t === 'evaluators' ? null : t, run: null })
  }

  const evaluatorsById = useMemo(() => {
    const m = new Map<string, Evaluator>()
    for (const ev of evaluators.data ?? []) m.set(ev.id, ev)
    return m
  }, [evaluators.data])

  // Search input — debounced 300ms to URL so each keystroke doesn't push.
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const list = useMemo(() => evaluators.data ?? [], [evaluators.data])
  const filtered = useMemo(() => {
    if (!search) return list
    const needle = search.toLowerCase()
    return list.filter((ev) =>
      ev.name.toLowerCase().includes(needle) ||
      ev.prompt_name.toLowerCase().includes(needle),
    )
  }, [list, search])

  // Stat-strip values — only metadata that's derivable from the evaluator
  // list itself. Per-evaluator runs / cost / score live in the row's own
  // useEvalRuns query; pulling them up here would require an n+1 round
  // trip just for the strip, so we skip.
  const distinctPrompts = new Set(list.map((ev) => ev.prompt_name)).size
  const distinctJudges  = new Set(list.map((ev) => ev.config.judge_model)).size
  const archivedCount   = list.filter((ev) => ev.archived_at != null).length

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Evals' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={evaluators.isFetching} />
              <button
                type="button"
                onClick={() => void evaluators.refetch()}
                disabled={evaluators.isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', evaluators.isFetching && 'animate-spin')}>↻</span>
              </button>
              <button
                type="button"
                onClick={() => openNewEvaluator()}
                className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                New evaluator
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Evals</h1>
      </div>

      {/* Stat strip — counts that are derivable from the evaluator list
          itself. Per-evaluator run / cost / score totals stay inside each
          row to avoid an n+1 fetch just to populate the strip. */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-4 min-w-[480px]">
          {[
            { label: 'Evaluators',       value: String(list.length) },
            { label: 'Distinct prompts', value: String(distinctPrompts) },
            { label: 'Distinct judges',  value: String(distinctJudges) },
            { label: 'Archived',         value: String(archivedCount) },
          ].map((s, i) => (
            <div key={s.label} className={cn('px-[18px] py-[14px]', i < 3 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className="text-[24px] font-medium leading-none tracking-[-0.6px] tabular-nums text-text">
                {mounted ? s.value : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tab strip: Evaluators (definitions) vs Results (runs) */}
      <div className="shrink-0 border-b border-border bg-bg flex items-center gap-1 px-[22px]">
        {(['evaluators', 'results'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.06em] px-3 py-2.5 transition-colors relative',
              tab === t ? 'text-text' : 'text-text-faint hover:text-text-muted',
            )}
          >
            {t === 'evaluators' ? 'Evaluators' : 'Results'}
            {tab === t && (
              <span className="absolute bottom-[-1px] left-3 right-3 h-[2px] bg-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-w-0">
          {tab === 'results' ? (
            <RunsView
              evaluatorsById={evaluatorsById}
              onSelectRun={setSelectedRunId}
              selectedRunId={selectedRunId}
            />
          ) : (
          <>
          {/* Info banner with docs link */}
          <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted flex-wrap">
            <Beaker className="h-3.5 w-3.5 shrink-0" />
            <span>
              LLM-as-judge scores production responses against a criterion you define.
              Cost is billed to your provider key.
            </span>
            <Link
              href="/docs/features/evals"
              className="text-text hover:opacity-80 transition-opacity ml-auto"
            >
              How evals work →
            </Link>
          </div>

          {/* Search bar */}
          <div className="px-[22px] py-[10px] border-b border-border flex items-center gap-2">
            <div className="relative max-w-md flex-1">
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
                placeholder="Search evaluator or prompt name…"
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
            <span className="font-mono text-[11px] text-text-faint">
              {mounted ? (filtered.length === list.length ? `${list.length} evaluators` : `${filtered.length} of ${list.length}`) : ' '}
            </span>
          </div>

          {/* Correlation card, appears only if Annotation has paired samples */}
          {list.length > 0 && <CorrelationRow evaluators={list} />}

          {evaluators.isLoading ? (
            <div className="p-[22px] space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-6 text-text-muted px-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Beaker className="h-9 w-9 text-text-faint" />
                <p className="text-[13px] text-text">Start with a template</p>
                <p className="font-mono text-[11.5px] text-text-faint max-w-[400px]">
                  Pre-filled criteria you can tune. Pick a prompt, edit the scoring rule, and run.
                </p>
              </div>

              <div className="w-full max-w-[820px] space-y-4">
                {/* Category tabs — every tab is always visible so the user
                    knows the catalogue spans more than the default bucket
                    they're staring at. */}
                <div className="flex items-center gap-1 border-b border-border">
                  {(['quality', 'safety', 'cost'] as const).map((cat) => {
                    const count = templatesByCategory[cat].length
                    const isActive = activeCategory === cat
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setActiveCategory(cat)}
                        className={cn(
                          'relative px-3 py-2 text-[12.5px] font-medium transition-colors -mb-px border-b-2',
                          isActive
                            ? 'border-accent text-text'
                            : 'border-transparent text-text-faint hover:text-text-muted',
                        )}
                      >
                        {CATEGORY_LABELS[cat]}
                        <span className="ml-1.5 font-mono text-[10.5px] text-text-faint">
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="font-mono text-[11px] text-text-faint">
                  {CATEGORY_HELP[activeCategory]}
                </p>

                {templatesByCategory.isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-[120px] bg-bg-elev rounded-[6px] animate-pulse" />
                    ))}
                  </div>
                ) : templatesByCategory[activeCategory].length === 0 ? (
                  <div className="font-mono text-[11.5px] text-text-faint py-6 text-center">
                    No templates in this category yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {templatesByCategory[activeCategory].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openNewEvaluator(templateFromDb(t))}
                        className="text-left p-4 rounded-[6px] border border-border bg-bg hover:bg-bg-elev hover:border-border-strong transition-colors group"
                      >
                        <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-2">
                          Template · {t.recommended_judge_model}
                        </div>
                        <div className="text-[13px] font-medium text-text mb-1.5">{t.name}</div>
                        <p className="text-[11.5px] text-text-muted leading-relaxed">{t.description}</p>
                        <div className="font-mono text-[10.5px] text-text-faint mt-3 flex items-center gap-1 group-hover:text-text transition-colors">
                          <Plus className="h-3 w-3" />
                          Use template
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 font-mono text-[11px] text-text-faint">
                <button
                  type="button"
                  onClick={() => openNewEvaluator()}
                  className="text-text-muted hover:text-text underline underline-offset-2"
                >
                  Or start blank
                </button>
                <span>·</span>
                <Link
                  href="/docs/features/evals"
                  className="text-text-muted hover:text-text underline underline-offset-2"
                >
                  How evals work
                </Link>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-text-muted">
              <p className="font-mono text-[12.5px]">No evaluators match the current search.</p>
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
              {/* Header row */}
              <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                <span className="flex-1">Evaluator</span>
                <span className="w-[100px] text-right">Avg score</span>
                <span className="w-[80px] text-right">Runs</span>
                <span className="w-[150px]" />
              </div>
              {filtered.map((ev) => (
                <EvaluatorRow
                  key={ev.id}
                  evaluator={ev}
                  onRun={(e) => setRunDialog(e)}
                  onSelectRun={(rid) => setSelectedRunId(rid)}
                />
              ))}
            </>
          )}
          </>
          )}
        </div>

        {selectedRunId && (
          <RunDetailPanel runId={selectedRunId} onClose={clearRun} />
        )}
      </div>

      <NewEvaluatorDialog
        key={dialogSession}
        open={newOpen}
        onClose={closeNewEvaluator}
        {...(pendingTemplate ? { initialTemplate: pendingTemplate } : {})}
      />

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
