export { SpanlensClient } from './client.js'
export { TraceHandle } from './trace.js'
export { SpanHandle } from './span.js'
export { observe, observeOpenAI, observeAnthropic, observeGemini } from './observe.js'
export { parseOpenAIUsage, parseAnthropicUsage, parseGeminiUsage } from './parsers.js'

export type {
  SpanlensConfig,
  TraceOptions,
  SpanOptions,
  EndTraceOptions,
  EndSpanOptions,
  SpanType,
  Status,
} from './types.js'
