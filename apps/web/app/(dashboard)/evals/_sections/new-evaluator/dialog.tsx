'use client'
import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import {
  useCreateEvaluator,
  type CreateEvaluatorInput,
  type EvaluatorType,
  type JudgeAnchor,
} from '@/lib/queries/use-evals'
import { usePrompts } from '@/lib/queries/use-prompts'
import type { PromptVersion } from '@/lib/queries/use-prompts'
import { useModels } from '@/lib/queries/use-models'
import { useScoreConfigs } from '@/lib/queries/use-score-configs'
import { JUDGE_MODELS_FALLBACK, type EvalProvider } from '../../_shared/providers'
import type { EvaluatorTemplate } from '../../_shared/templates'
import { JudgeFields } from './judge-fields'
import {
  RegexFields,
  JsonSchemaField,
  ExactMatchFields,
  ContainsFields,
  EmbeddingFields,
} from './deterministic-fields'
import { AutoRunSection } from './auto-run-fields'

// ── New evaluator dialog ─────────────────────────────────────────────────────

export function NewEvaluatorDialog({
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
  // P1-7 — optional judge-prompt quality controls (llm_judge only). Rubric is
  // free-form guidance; anchors are few-shot calibration examples.
  const [rubric, setRubric] = useState('')
  const [anchors, setAnchors] = useState<JudgeAnchor[]>([])
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
  const [evaluatorType, setEvaluatorType] = useState<EvaluatorType>('llm_judge')
  // P2-11 — trajectory evaluators target traces by name instead of a prompt.
  const [traceName, setTraceName] = useState('')
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
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (evaluatorType === 'trajectory') {
      if (!traceName.trim()) { setError('Trace name is required for trajectory evaluators'); return }
    } else if (!promptName) {
      setError('Prompt is required')
      return
    }
    if (autoRunOnVersion && (!autoRunDatasetId || !autoRunModel.trim())) {
      setError('Auto-run needs a dataset and a model')
      return
    }
    try {
      if (evaluatorType === 'trajectory') {
        if (!criterion.trim()) {
          setError('Criterion is required for trajectory evaluators')
          return
        }
        await submitEvaluator({
          name: name.trim(),
          type: 'trajectory',
          traceName: traceName.trim(),
          config: {
            criterion: criterion.trim(),
            judge_provider: judgeProvider,
            judge_model: judgeModel,
            scale_min: scaleMin,
            scale_max: scaleMax,
            trace_name: traceName.trim(),
            ...(rubric.trim() ? { rubric: rubric.trim() } : {}),
          },
        })
      } else if (evaluatorType === 'llm_judge') {
        if (!criterion.trim()) {
          setError('Criterion is required for LLM-as-judge evaluators')
          return
        }
        // P1-7: keep only complete anchors (a response + a numeric score in range).
        const cleanAnchors = anchors
          .map((a) => ({ ...a, response: a.response.trim(), reasoning: a.reasoning?.trim() }))
          .filter((a) => a.response && Number.isFinite(a.score) && a.score >= scaleMin && a.score <= scaleMax)
          .map((a) => ({ response: a.response, score: a.score, ...(a.reasoning ? { reasoning: a.reasoning } : {}) }))
        await submitEvaluator({
          promptName,
          name: name.trim(),
          config: {
            criterion: criterion.trim(),
            judge_provider: judgeProvider,
            judge_model: judgeModel,
            scale_min: scaleMin,
            scale_max: scaleMax,
            ...(rubric.trim() ? { rubric: rubric.trim() } : {}),
            ...(cleanAnchors.length > 0 ? { anchors: cleanAnchors } : {}),
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
      setName(''); setCriterion(''); setPromptName(''); setTraceName('')
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
          {evaluatorType === 'trajectory' ? (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Trace name
              </label>
              <input
                type="text"
                value={traceName}
                onChange={(e) => setTraceName(e.target.value)}
                placeholder="e.g. customer-support-agent"
                className="w-full h-9 px-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
              />
              <p className="font-mono text-[10.5px] text-text-faint mt-1">
                The trace name your SDK sets (<code>createTrace(&quot;…&quot;)</code>). Recent traces with this name are scored.
              </p>
            </div>
          ) : (
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
          )}

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
              onValueChange={(v) => setEvaluatorType(v as EvaluatorType)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="llm_judge">LLM as judge</SelectItem>
                <SelectItem value="trajectory">Agent trajectory (judge the trace)</SelectItem>
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
                : evaluatorType === 'trajectory'
                  ? 'Judge model scores 0..1 over the whole agent trace (tool-call sequence), not just the final text.'
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

          {(evaluatorType === 'llm_judge' || evaluatorType === 'trajectory') && (
            <JudgeFields
              evaluatorType={evaluatorType}
              criterion={criterion}
              setCriterion={setCriterion}
              judgeProvider={judgeProvider}
              setJudgeProvider={setJudgeProvider}
              judgeModel={judgeModel}
              setJudgeModel={setJudgeModel}
              judgeModels={judgeModels}
              rubric={rubric}
              setRubric={setRubric}
              anchors={anchors}
              setAnchors={setAnchors}
              scaleMin={scaleMin}
              scaleMax={scaleMax}
            />
          )}

          {evaluatorType === 'regex' && (
            <RegexFields
              pattern={regexPattern}
              setPattern={setRegexPattern}
              flags={regexFlags}
              setFlags={setRegexFlags}
            />
          )}

          {evaluatorType === 'json_schema' && (
            <JsonSchemaField
              schemaText={jsonSchemaText}
              setSchemaText={setJsonSchemaText}
            />
          )}

          {evaluatorType === 'exact_match' && (
            <ExactMatchFields
              value={exactValue}
              setValue={setExactValue}
              caseSensitive={exactCaseSensitive}
              setCaseSensitive={setExactCaseSensitive}
            />
          )}

          {evaluatorType === 'contains' && (
            <ContainsFields
              substring={containsSubstring}
              setSubstring={setContainsSubstring}
              caseSensitive={containsCaseSensitive}
              setCaseSensitive={setContainsCaseSensitive}
            />
          )}

          {evaluatorType === 'embedding' && (
            <EmbeddingFields
              provider={embedProvider}
              setProvider={setEmbedProvider}
              model={embedModel}
              setModel={setEmbedModel}
              referenceText={embedReferenceText}
              setReferenceText={setEmbedReferenceText}
              threshold={embedThreshold}
              setThreshold={setEmbedThreshold}
            />
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

          <AutoRunSection
            enabled={autoRunOnVersion}
            setEnabled={setAutoRunOnVersion}
            datasetId={autoRunDatasetId}
            setDatasetId={setAutoRunDatasetId}
            provider={autoRunProvider}
            setProvider={setAutoRunProvider}
            model={autoRunModel}
            setModel={setAutoRunModel}
            judgeModels={judgeModels}
          />

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
