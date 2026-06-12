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
  evaluatorType: 'regex' | 'json_schema',
  config: RegexConfig | JsonSchemaConfig,
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
          : runJsonSchema(config as JsonSchemaConfig, responseText)

      return {
        eval_run_id: evalRunId,
        request_id: s.id,
        dataset_item_id: null,
        score: result.score,
        reasoning: result.reasoning,
        value_number: null,
        value_string: null,
        value_boolean: result.value_boolean,
        cost_usd: 0,
        tokens: 0,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (scored.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('eval_results').insert(scored)
    if (insErr) throw new Error(`eval_results insert failed: ${insErr.message}`)
  }

  const totalScore = scored.reduce((acc, r) => acc + r.score, 0)
  const aggregateScore = scored.length > 0 ? totalScore / scored.length : 0
  await supabaseAdmin
    .from('eval_runs')
    .update({
      status: 'completed',
      sample_count: scored.length,
      aggregate_score: aggregateScore,
      total_cost_usd: 0,
      total_tokens: 0,
      completed_at: new Date().toISOString(),
    })
    .eq('id', evalRunId)
}
