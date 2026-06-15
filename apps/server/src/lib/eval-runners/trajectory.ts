/**
 * P2-11: agent trajectory evaluation.
 *
 * Existing evaluators judge a single response text. A trajectory evaluator
 * judges the whole AGENT TRACE — the ordered sequence of spans (LLM calls,
 * tool calls, intermediate steps) — against a criterion. This reuses the
 * tracing data that is Spanlens's differentiator: "did the agent take the
 * right steps", not just "is the final answer good".
 *
 * This module is the pure, side-effect-free core: serialize a trace's spans
 * into a readable transcript, and build the judge prompt over it. The runner
 * (eval-runner.ts) fetches the spans + calls the judge LLM.
 */

import { truncateMiddle, MAX_RESPONSE_CHARS } from './shared.js'

/** Minimal projection of a span the serializer needs (spans table subset). */
export interface TrajectorySpan {
  name: string
  span_type: string
  status: string
  input: unknown
  output: unknown
  error_message: string | null
  /** ISO timestamp — used only to order steps by execution time. */
  started_at: string
}

/** Minimal projection of the trace header. */
export interface TrajectoryTrace {
  name: string
  status: string
  duration_ms: number | null
}

// Per-step caps. A trajectory can have many steps, so each step's input/output
// is kept short; the overall transcript is capped again in the prompt builder.
const STEP_INPUT_MAX = 600
const STEP_OUTPUT_MAX = 800
const STEP_ERROR_MAX = 300
// The judge sees a larger budget than a single response — a trajectory is many
// steps — but still bounded so a runaway agent can't blow the context window.
const TRAJECTORY_MAX_CHARS = MAX_RESPONSE_CHARS * 2

/** Render a jsonb value to a compact one-line string, truncated middle-out. */
function stringifyValue(v: unknown, max: number): string {
  if (v == null) return ''
  let s: string
  if (typeof v === 'string') {
    s = v
  } else {
    try {
      s = JSON.stringify(v)
    } catch {
      s = String(v)
    }
  }
  // Collapse whitespace so each step stays on a predictable number of lines.
  return truncateMiddle(s.replace(/\s+/g, ' ').trim(), max)
}

/**
 * Serialize a trace's spans into a step-by-step transcript. Spans are ordered
 * by start time (execution order). Returns '' when there are no spans so the
 * caller can skip a trace with nothing to judge.
 */
export function serializeTrajectory(trace: TrajectoryTrace, spans: TrajectorySpan[]): string {
  if (spans.length === 0) return ''
  // Parse to epoch ms so ordering is robust to offset format variation
  // (Supabase may return +00:00 or Z); a lexical compare would be fragile.
  const ordered = [...spans].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())

  const header =
    `Agent trace: "${trace.name}" — overall status: ${trace.status}, ${ordered.length} steps` +
    (trace.duration_ms != null ? `, ${trace.duration_ms}ms total` : '')

  const steps = ordered.map((s, i) => {
    const lines = [`Step ${i + 1} [${s.span_type}] ${s.name} (status: ${s.status})`]
    const input = stringifyValue(s.input, STEP_INPUT_MAX)
    const output = stringifyValue(s.output, STEP_OUTPUT_MAX)
    if (input) lines.push(`  Input: ${input}`)
    if (output) lines.push(`  Output: ${output}`)
    if (s.error_message) lines.push(`  Error: ${truncateMiddle(s.error_message, STEP_ERROR_MAX)}`)
    return lines.join('\n')
  })

  return [header, '', ...steps].join('\n')
}

/**
 * Build the trajectory judge prompt. Numeric-only (the score normalises to
 * 0..1 like the legacy llm_judge path), with the same optional rubric.
 */
export function buildTrajectoryJudgePrompt(
  criterion: string,
  trajectoryText: string,
  config: { scale_min: number; scale_max: number; rubric?: string | null },
): string {
  const min = config.scale_min
  const max = config.scale_max
  const rubric = config.rubric?.trim()
  const rubricBlock = rubric
    ? `

Scoring rubric (apply consistently):
${rubric}`
    : ''

  return `You are evaluating an AI agent's TRAJECTORY — the sequence of steps and tool calls it took to reach its result, not just the final answer.

Criterion: ${criterion}${rubricBlock}

Agent trajectory (steps in execution order):
"""
${truncateMiddle(trajectoryText, TRAJECTORY_MAX_CHARS)}
"""

Judge how well the trajectory satisfies the criterion. Consider whether the agent took appropriate steps, called the right tools in a sensible order, avoided unnecessary or failed steps, and accomplished the goal.

Reply ONLY in JSON with this exact shape:
{"score": <number between ${min} and ${max}>, "reasoning": "<one short sentence>"}

No prose outside the JSON. No markdown fences.`
}
