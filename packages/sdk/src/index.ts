export { SpanlensClient } from './client.js'
export { TraceHandle } from './trace.js'
export { SpanHandle } from './span.js'
export {
  observe,
  observeOpenAI,
  observeAnthropic,
  observeGemini,
  observeOllama,
  observeGroq,
  observeDeepSeek,
  observeXai,
  observeCohere,
  observeMistral,
  observeOpenRouter,
} from './observe.js'
export type { ProviderObserveOptions } from './observe.js'
export { parseOpenAIUsage, parseAnthropicUsage, parseGeminiUsage } from './parsers.js'
// Sprint 7 R-15 + R-20: typed exception thrown on Spanlens server errors
// that follow the standard envelope. See transport.ts for the shape.
// SpanlensTransportError is the base class covering every classified HTTP
// failure (status, code, message, endpoint) handed to onError.
export { SpanlensApiError, SpanlensTransportError } from './transport.js'

// Evals API (CI / script-driven prompt evaluation — "prompt CI").
export { EvalsApi, scoreConfidenceInterval } from './evals.js'
export type {
  EvalRun,
  EvalResult,
  EvalRunStatus,
  RunEvalInput,
  RunEvalOptions,
  ScoreInterval,
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
