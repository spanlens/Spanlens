import type {
  EvaluatorTemplate as DbEvaluatorTemplate,
  EvaluatorTemplateCategory,
} from '@/lib/queries/use-evaluator-templates'
import type { EvalProvider } from './providers'

// ── Evaluator templates (used by empty-state quick-start cards) ──────────────
//
// The catalogue lives in the `evaluator_templates` DB table; the evals client
// consumes it through `useEvaluatorTemplatesByCategory()`. The legacy
// hard-coded list was inlined here before 4A.5.

export interface EvaluatorTemplate {
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
export function templateFromDb(t: DbEvaluatorTemplate): EvaluatorTemplate {
  return {
    name: t.name,
    criterion: t.criterion,
    judgeProvider: t.recommended_judge_provider,
    judgeModel: t.recommended_judge_model,
  }
}

export const CATEGORY_LABELS: Record<EvaluatorTemplateCategory, string> = {
  quality: 'Quality',
  safety: 'Safety',
  cost: 'Cost',
}

export const CATEGORY_HELP: Record<EvaluatorTemplateCategory, string> = {
  quality: 'Did the response actually answer the question, in voice, without padding.',
  safety: 'Catch responses that leak data, hallucinate, or follow hidden instructions.',
  cost: 'Find calls where a cheaper model could have produced the same answer.',
}
