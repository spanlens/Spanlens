/**
 * Deterministic eval runners (regex + JSON schema). Synchronous, no
 * provider key required, no concurrency window.
 *
 * Extracted from lib/eval-runner.ts during the 1273-line split.
 *
 * Both runners produce a binary 0/1 outcome with a reasoning string so
 * the existing eval_results table layout doesn't need a new column.
 * runSimpleEvalRun ties it all together: fetch production samples for
 * the prompt_version, score each row synchronously, write results +
 * aggregate to the eval_runs row.
 */

import Ajv, { type ErrorObject } from 'ajv'

import { supabaseAdmin } from '../db.js'
import { requestsScope, selectRequests } from '../requests-query.js'
import { extractResponseText } from './shared.js'

export interface RegexConfig {
  pattern: string
  flags?: string
}

export interface JsonSchemaConfig {
  // Ajv accepts plain JSON Schema objects. Keep this `unknown` at the
  // boundary so we can hand the validation error back to the operator
  // instead of throwing if they author a bad schema.
  schema: unknown
}

export interface ExactMatchConfig {
  /** The exact string the response must equal. */
  value: string
  /** Default false — comparison is case-insensitive unless set. */
  caseSensitive?: boolean
  /** Default true — both sides are trimmed before comparing. */
  trim?: boolean
}

export interface ContainsConfig {
  /** Substring the response must contain. */
  substring: string
  /** Default false — search is case-insensitive unless set. */
  caseSensitive?: boolean
}

/** Evaluator types scored synchronously with no provider key / network. */
export type DeterministicEvaluatorType = 'regex' | 'json_schema' | 'exact_match' | 'contains'

/**
 * Deterministic 0/1 outcome shared by both code evaluator types. Matches
 * the JudgeOutcome shape on the columns the eval_results table actually
 * stores, so the existing INSERT path doesn't need a new branch.
 */
export interface SimpleEvalResult {
  score: 0 | 1
  value_boolean: boolean
  reasoning: string
}

/**
 * runRegex — pass iff the pattern matches the response text.
 *
 * Throws when the pattern itself is invalid (bad regex syntax, unknown
 * flag). The runEvalRun wrapper catches the throw and writes a 0 row
 * with the error message in reasoning, so a typo in a customer's
 * evaluator config produces failing samples rather than silently
 * skipping the whole run.
 */
export function runRegex(config: RegexConfig, output: string): SimpleEvalResult {
  // No defensive normalisation of flags. Ajv's "user-authored config"
  // policy applies here too — surface the SyntaxError verbatim if they
  // pass an unsupported flag like 'q'.
  const re = new RegExp(config.pattern, config.flags ?? '')
  const matched = re.test(output)
  return {
    score: matched ? 1 : 0,
    value_boolean: matched,
    reasoning: matched ? `regex matched: /${config.pattern}/${config.flags ?? ''}` : `no match for /${config.pattern}/${config.flags ?? ''}`,
  }
}

/**
 * runJsonSchema — pass iff the response parses as JSON and validates
 * against the schema.
 *
 * Two failure modes share a single returned shape: parse error (invalid
 * JSON) and validation error (well-formed JSON that doesn't match the
 * schema). Operators reading /evals/runs/:id need to tell those apart,
 * so the reasoning field carries the actual Ajv error text or the
 * SyntaxError message — never a generic 'failed'.
 */
export function runJsonSchema(
  config: JsonSchemaConfig,
  output: string,
): SimpleEvalResult {
  // Lazy Ajv instance — `new Ajv()` allocates its own validator cache.
  // Per-call instantiation keeps the test surface tiny (no shared state
  // between samples) and is cheap enough for the deterministic path.
  const ajv = new Ajv({ allErrors: false })

  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      score: 0,
      value_boolean: false,
      reasoning: `not JSON: ${message}`,
    }
  }

  let validate: ReturnType<typeof ajv.compile>
  try {
    // Ajv requires the schema to be a plain object. A non-object schema
    // is a config error, not a sample failure — surface it as a failing
    // sample so the operator sees it on the first run.
    validate = ajv.compile(config.schema as Parameters<typeof ajv.compile>[0])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      score: 0,
      value_boolean: false,
      reasoning: `schema compile error: ${message}`,
    }
  }

  const valid = validate(parsed)
  if (valid) {
    return { score: 1, value_boolean: true, reasoning: 'valid' }
  }

  const errs = (validate.errors ?? []) as ErrorObject[]
  const reasoning = errs.length > 0 ? ajv.errorsText(errs) : 'invalid (no error details)'
  return { score: 0, value_boolean: false, reasoning }
}

/** Truncate a value for a readable reasoning line. */
function snippet(s: string, max = 80): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

/**
 * runExactMatch — pass iff the response equals the configured value.
 * Case-insensitive and trimmed by default (the common intent for a short
 * canonical answer like "yes" / "approved").
 */
export function runExactMatch(config: ExactMatchConfig, output: string): SimpleEvalResult {
  let a = output
  let b = config.value
  if (config.trim !== false) {
    a = a.trim()
    b = b.trim()
  }
  if (!config.caseSensitive) {
    a = a.toLowerCase()
    b = b.toLowerCase()
  }
  const matched = a === b
  return {
    score: matched ? 1 : 0,
    value_boolean: matched,
    reasoning: matched
      ? `exact match: "${snippet(config.value)}"`
      : `expected "${snippet(config.value)}" but got "${snippet(output)}"`,
  }
}

/**
 * runContains — pass iff the response contains the configured substring.
 * Case-insensitive by default.
 */
export function runContains(config: ContainsConfig, output: string): SimpleEvalResult {
  let haystack = output
  let needle = config.substring
  if (!config.caseSensitive) {
    haystack = haystack.toLowerCase()
    needle = needle.toLowerCase()
  }
  const matched = haystack.includes(needle)
  return {
    score: matched ? 1 : 0,
    value_boolean: matched,
    reasoning: matched
      ? `contains "${snippet(config.substring)}"`
      : `does not contain "${snippet(config.substring)}"`,
  }
}

/**
 * Run a deterministic eval against the production sample set. Mirrors
 * the sample-fetch step of runEvalRun (LLM-as-judge production path)
 * but skips provider-key resolution, the judge prompt, and concurrency
 * windowing. Used by runEvalRun when evaluator.type is regex or
 * json_schema.
 */
export async function runSimpleEvalRun(
  evalRunId: string,
  organizationId: string,
  promptVersionId: string,
  sampleSize: number,
  sampleFrom: string | null | undefined,
  sampleTo: string | null | undefined,
  evaluatorType: DeterministicEvaluatorType,
  config: RegexConfig | JsonSchemaConfig | ExactMatchConfig | ContainsConfig,
): Promise<void> {
  const sampleFilters: string[] = [
    'prompt_version_id = {promptVersionId:UUID}',
    "response_body != ''",
  ]
  const sampleParams: Record<string, unknown> = { promptVersionId }
  if (sampleFrom) {
    sampleFilters.push('created_at >= parseDateTime64BestEffort({sampleFrom:String})')
    sampleParams['sampleFrom'] = sampleFrom
  }
  if (sampleTo) {
    sampleFilters.push('created_at <= parseDateTime64BestEffort({sampleTo:String})')
    sampleParams['sampleTo'] = sampleTo
  }

  interface SampleQueryRow {
    id: string
    response_body: string
  }
  const scope = await requestsScope(organizationId)
  const samples = await selectRequests<SampleQueryRow>({
    scope,
    select: 'id, response_body',
    filters: sampleFilters.join(' AND '),
    orderBy: 'created_at DESC',
    limit: sampleSize,
    params: sampleParams,
  })

  // Score each sample synchronously — no I/O after the initial fetch.
  const scored = samples
    .map((s) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(s.response_body)
      } catch {
        parsed = s.response_body
      }
      const responseText = extractResponseText(parsed) ?? ''
      if (!responseText) return null

      const result: SimpleEvalResult =
        evaluatorType === 'regex'
          ? runRegex(config as RegexConfig, responseText)
          : evaluatorType === 'json_schema'
            ? runJsonSchema(config as JsonSchemaConfig, responseText)
            : evaluatorType === 'exact_match'
              ? runExactMatch(config as ExactMatchConfig, responseText)
              : runContains(config as ContainsConfig, responseText)

      return {
        // organization_id is NOT NULL on eval_results — omitting it (the prior
        // bug) made every deterministic INSERT fail at runtime. Column names
        // must match the judge path: judge_cost_usd / judge_tokens (there are
        // no cost_usd / tokens columns).
        organization_id: organizationId,
        eval_run_id: evalRunId,
        request_id: s.id,
        dataset_item_id: null,
        score: result.score,
        reasoning: result.reasoning,
        value_number: null,
        value_string: null,
        value_boolean: result.value_boolean,
        judge_cost_usd: 0,
        judge_tokens: 0,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (scored.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('eval_results').insert(scored)
    if (insErr) throw new Error(`eval_results insert failed: ${insErr.message}`)
  }

  // Use the SAME eval_runs columns as the judge path (scored_count / avg_score).
  // The previous code wrote sample_count / aggregate_score / total_tokens, none
  // of which exist on eval_runs — supabaseAdmin is an untyped client so the bad
  // keys compiled but PostgREST silently dropped them, leaving every
  // deterministic run showing "0 scored / no average" in the dashboard.
  //
  // Deterministic scoring can't fail per-sample (runRegex/runJsonSchema always
  // return 0|1; a bad evaluator config throws and fails the whole run), so the
  // only drops are empty-response samples already excluded above. Mirroring the
  // judge path's "attempted = post-empty-filter samples": attempted == scored
  // and failed == 0 here.
  const totalScore = scored.reduce((acc, r) => acc + r.score, 0)
  const avgScore = scored.length > 0 ? totalScore / scored.length : null
  await supabaseAdmin
    .from('eval_runs')
    .update({
      status: 'completed',
      scored_count: scored.length,
      attempted_count: scored.length,
      failed_count: 0,
      avg_score: avgScore,
      total_cost_usd: 0,
      completed_at: new Date().toISOString(),
    })
    .eq('id', evalRunId)
}
