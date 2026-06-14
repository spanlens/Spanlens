export { SpanlensClient } from './client.js'
export { TraceHandle } from './trace.js'
export { SpanHandle } from './span.js'
export { observe, observeOpenAI, observeAnthropic, observeGemini, observeOllama } from './observe.js'
export { parseOpenAIUsage, parseAnthropicUsage, parseGeminiUsage } from './parsers.js'
// Sprint 7 R-15 + R-20: typed exception thrown on Spanlens server errors
// that follow the standard envelope. See transport.ts for the shape.
export { SpanlensApiError } from './transport.js'

// Evals API (CI / script-driven prompt evaluation — "prompt CI").
export { EvalsApi } from './evals.js'
export type {
  EvalRun,
  EvalResult,
  EvalRunStatus,
  RunEvalInput,
  RunEvalOptions,
} from './evals.js'

export type {
  SpanlensConfig,
  TraceOptions,
  SpanOptions,
  EndTraceOptions,
  EndSpanOptions,
  LogBodyMode,
  SpanType,
  Status,
} from './types.js'
