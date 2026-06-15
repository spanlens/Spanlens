/**
 * Evals API — run prompt evaluations from CI / scripts.
 *
 * Unlike the ingest transport (fire-and-forget, silent, retries swallowed),
 * this client is BLOCKING and THROWS on failure: a CI job needs an eval that
 * fails to fail the build, and needs to read back the score to gate on it.
 *
 * @example  Fail the build when quality regresses.
 *   const client = new SpanlensClient({ apiKey: 'sl_live_...' }) // full key, not pub
 *   const run = await client.evals.run({
 *     evaluatorId: 'ev_...',
 *     promptVersionId: 'pv_...',
 *     sampleSize: 50,
 *   })
 *   if ((run.avg_score ?? 0) < 0.8) {
 *     console.error(`avg score ${run.avg_score} below gate`)
 *     process.exit(1)
 *   }
 */

import { SpanlensApiError } from './transport.js'

const DEFAULT_BASE_URL = 'https://spanlens-server.vercel.app'
const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 300_000

export type EvalRunStatus = 'pending' | 'running' | 'completed' | 'failed'

/** An eval run as returned by the API (snake_case, 1:1 with the REST shape). */
export interface EvalRun {
  id: string
  organization_id: string
  evaluator_id: string
  prompt_version_id: string
  dataset_id: string | null
  source: 'production' | 'dataset'
  /** P1-7 (3/3): 'single' (absolute scoring) or 'pairwise' (A vs B). Absent on
   * rows created before the feature — treat undefined as 'single'. */
  mode?: 'single' | 'pairwise'
  /** The "B" prompt version for a pairwise run (vs prompt_version_id = A). */
  prompt_version_b_id?: string | null
  /** Pairwise tally (null/absent for single-mode runs). avg_score is B's win-rate. */
  a_wins?: number | null
  b_wins?: number | null
  ties?: number | null
  sample_size: number
  status: EvalRunStatus
  /** Samples that were successfully scored. */
  scored_count: number
  /** Samples sent to the judge after the empty-response filter. */
  attempted_count: number
  /** Samples whose scoring failed (attempted - scored). */
  failed_count: number
  /** Mean score in 0..1 (NUMERIC) / pass-rate (BOOLEAN); null for other types or empty runs. */
  avg_score: number | null
  /** P1-7: sample standard deviation of the scores behind avg_score. Backs the
   * 95% confidence interval (see {@link scoreConfidenceInterval}). null when
   * the run has <2 numeric samples or the evaluator has no mean. */
  score_stddev: number | null
  total_cost_usd: number
  error: string | null
  started_at: string
  completed_at: string | null
}

export interface EvalResult {
  id: string
  eval_run_id: string
  request_id: string | null
  dataset_item_id: string | null
  score: number | null
  reasoning: string | null
  value_number: number | null
  value_string: string | null
  value_boolean: boolean | null
  /** P1-7 (3/3): pairwise winner ('a' | 'b' | 'tie'); null for single-mode results. */
  winner?: 'a' | 'b' | 'tie' | null
}

export interface RunEvalInput {
  evaluatorId: string
  promptVersionId: string
  /** Defaults to 'production' (samples recent traffic for the prompt version). */
  source?: 'production' | 'dataset'
  /** Required when source = 'dataset'. */
  datasetId?: string
  /** 1..1000, defaults to 50. */
  sampleSize?: number
  sampleFrom?: string
  sampleTo?: string
  /** Production sampling: 'recent' (default) or 'random' (representative). */
  sampleStrategy?: 'recent' | 'random'
  /** Dataset generation temperature, 0..2. Defaults to 0 (reproducible). */
  generationTemperature?: number
  /** Required when source = 'dataset'. */
  runProvider?: string
  /** Required when source = 'dataset'. */
  runModel?: string
  /** P1-7 (3/3): 'pairwise' compares promptVersionId (A) against
   * promptVersionBId (B) head-to-head. Requires source = 'dataset' +
   * runProvider/runModel. The completed run's avg_score is B's win-rate. */
  mode?: 'single' | 'pairwise'
  /** The "B" prompt version for a pairwise run. Required when mode = 'pairwise'. */
  promptVersionBId?: string
}

export interface RunEvalOptions {
  /** Poll until the run reaches a terminal state. Default true. */
  wait?: boolean
  /** Poll cadence in ms. Default 2000. */
  pollIntervalMs?: number
  /** Give up after this many ms of polling. Default 300000 (5 min). */
  timeoutMs?: number
}

interface EvalsApiConfig {
  apiKey: string
  baseUrl: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class EvalsApi {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: EvalsApiConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }

  /**
   * Trigger an eval run. By default waits for it to finish and returns the
   * completed run (with avg_score / scored_count populated). Pass
   * `{ wait: false }` to return immediately after the run is queued.
   *
   * Throws SpanlensApiError on a 4xx (e.g. a public key hitting this
   * write route → PUBLIC_KEY_WRITE_FORBIDDEN), and a plain Error on a
   * server error, network failure, or wait timeout.
   */
  async run(input: RunEvalInput, options: RunEvalOptions = {}): Promise<EvalRun> {
    const created = await this.request<EvalRun>('POST', '/api/v1/eval-runs', {
      evaluatorId: input.evaluatorId,
      promptVersionId: input.promptVersionId,
      source: input.source ?? 'production',
      datasetId: input.datasetId,
      sampleSize: input.sampleSize ?? 50,
      sampleFrom: input.sampleFrom,
      sampleTo: input.sampleTo,
      sampleStrategy: input.sampleStrategy,
      generationTemperature: input.generationTemperature,
      runProvider: input.runProvider,
      runModel: input.runModel,
      mode: input.mode,
      promptVersionBId: input.promptVersionBId,
    })

    if (options.wait === false) return created

    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs

    let run = created
    while (run.status === 'pending' || run.status === 'running') {
      if (Date.now() > deadline) {
        throw new Error(
          `[spanlens] eval run ${run.id} did not finish within ${timeoutMs}ms (last status: ${run.status})`,
        )
      }
      await sleep(pollIntervalMs)
      run = await this.getRun(run.id)
    }
    return run
  }

  /** Fetch a single run by id. */
  getRun(id: string): Promise<EvalRun> {
    return this.request<EvalRun>('GET', `/api/v1/eval-runs/${encodeURIComponent(id)}`)
  }

  /** List recent runs, optionally filtered by evaluator / prompt version. */
  listRuns(filter: { evaluatorId?: string; promptVersionId?: string } = {}): Promise<EvalRun[]> {
    const params = new URLSearchParams()
    if (filter.evaluatorId) params.set('evaluatorId', filter.evaluatorId)
    if (filter.promptVersionId) params.set('promptVersionId', filter.promptVersionId)
    const qs = params.toString()
    return this.request<EvalRun[]>('GET', `/api/v1/eval-runs${qs ? `?${qs}` : ''}`)
  }

  /** Fetch the per-sample results for a run. */
  getResults(id: string): Promise<EvalResult[]> {
    return this.request<EvalResult[]>('GET', `/api/v1/eval-runs/${encodeURIComponent(id)}/results`)
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    const text = await res.text().catch(() => '')

    if (!res.ok) {
      const apiError = parseApiError(text, res.status)
      if (apiError) throw apiError
      throw new Error(`[spanlens] ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
    }

    // Success envelope: { success: true, data: T }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`[spanlens] ${method} ${path} returned a non-JSON body`)
    }
    const env = parsed as { data?: T }
    return env.data as T
  }
}

/** Parse a standard ApiErrorEnvelope into a typed SpanlensApiError, or null. */
function parseApiError(text: string, status: number): SpanlensApiError | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== 'object') return null
  const maybe = parsed as { error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown } }
  if (maybe.error == null || typeof maybe.error !== 'object') return null
  if (typeof maybe.error.code !== 'string' || typeof maybe.error.message !== 'string') return null
  return new SpanlensApiError({
    code: maybe.error.code,
    message: maybe.error.message,
    status,
    ...(maybe.error.details && typeof maybe.error.details === 'object'
      ? { details: maybe.error.details as Record<string, unknown> }
      : {}),
    requestId: typeof maybe.error.requestId === 'string' ? maybe.error.requestId : null,
  })
}

export function createEvalsApi(config: { apiKey: string; baseUrl?: string }): EvalsApi {
  return new EvalsApi({ apiKey: config.apiKey, baseUrl: config.baseUrl ?? DEFAULT_BASE_URL })
}

/** The 95% confidence interval for a run's mean score (P1-7). */
export interface ScoreInterval {
  /** The point estimate — same as run.avg_score. */
  mean: number
  /** Half-width: the interval is `mean ± margin`. */
  margin: number
  /** Lower bound, clamped to 0. */
  low: number
  /** Upper bound, clamped to 1. */
  high: number
}

/**
 * Compute the 95% confidence interval for an eval run's mean score, using the
 * normal approximation (z = 1.96): `margin = 1.96 * stddev / sqrt(n)`.
 *
 * Use this in CI to gate on a *meaningful* regression rather than noise: a new
 * version that scores 0.78 ± 0.06 vs a baseline of 0.80 has not clearly
 * regressed, so you can avoid failing the build on sampling jitter.
 *
 * Returns null when the run can't support an interval (no avg_score, no
 * score_stddev, or fewer than 2 scored samples).
 *
 * @example
 *   const run = await client.evals.run({ evaluatorId, promptVersionId, sampleSize: 100 })
 *   const ci = scoreConfidenceInterval(run)
 *   if (ci && ci.high < GATE) {        // even the optimistic bound is below gate
 *     console.error(`score ${ci.mean.toFixed(2)} ±${ci.margin.toFixed(2)} below ${GATE}`)
 *     process.exit(1)
 *   }
 */
export function scoreConfidenceInterval(run: EvalRun): ScoreInterval | null {
  const { avg_score: mean, score_stddev: stddev, scored_count: n } = run
  if (mean == null || stddev == null || !Number.isFinite(stddev) || n < 2) return null
  const margin = (1.96 * stddev) / Math.sqrt(n)
  return {
    mean,
    margin,
    low: Math.max(0, mean - margin),
    high: Math.min(1, mean + margin),
  }
}
