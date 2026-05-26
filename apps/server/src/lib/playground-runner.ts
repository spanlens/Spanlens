const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function interpolate(
  content: string,
  vars: Record<string, string>,
): { result: string; missingVars: string[] } {
  const missing: string[] = []
  const result = content.replace(VAR_RE, (_, name: string) => {
    if (name in vars) return vars[name]!
    missing.push(name)
    return ''
  })
  return { result, missingVars: [...new Set(missing)] }
}

export function inferProvider(model: string): 'openai' | 'anthropic' {
  if (model.startsWith('claude-')) return 'anthropic'
  return 'openai'
}

// Models that reject custom temperature (only the default value of 1 is accepted).
// Includes o-series reasoning models and newer gpt-5 base models.
const NO_TEMPERATURE_MODELS = new Set([
  'chat-latest',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5.5',
])

export function isOpenAIReasoningModel(model: string): boolean {
  return /^o\d/.test(model)
}

function skipTemperature(model: string): boolean {
  return isOpenAIReasoningModel(model) || NO_TEMPERATURE_MODELS.has(model)
}

export function buildOpenAIBody(
  model: string,
  messages: Array<{ role: string; content: string }>,
  opts: { temperature: number; maxTokens: number; responseFormat?: { type: string } },
): Record<string, unknown> {
  // max_completion_tokens is the current OpenAI standard — max_tokens is
  // rejected by newer models (o-series, gpt-5.x, chat-latest, etc.).
  // All models that still accept max_tokens also accept max_completion_tokens,
  // so we use it universally.
  return {
    model,
    messages,
    max_completion_tokens: opts.maxTokens,
    ...(skipTemperature(model) ? {} : { temperature: opts.temperature }),
    ...(opts.responseFormat && { response_format: opts.responseFormat }),
  }
}
