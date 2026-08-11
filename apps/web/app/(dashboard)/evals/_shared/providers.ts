// Judge / run provider vocabulary shared by the two eval dialogs.

// Fallback used only when /api/v1/models is still loading. Real list comes
// from useModels(). Keep this minimal — just enough to render <select>
// without an empty initial frame.
export const JUDGE_MODELS_FALLBACK = {
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-haiku-4-5'],
  gemini: ['gemini-2.5-flash-lite'],
  azure: ['gpt-4o-mini'],
  mistral: ['mistral-small-latest'],
  openrouter: ['openai/gpt-4o-mini'],
} as const

export type EvalProvider = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'

export const PROVIDER_OPTIONS: Array<{ value: EvalProvider; label: string }> = [
  { value: 'openai',     label: 'OpenAI' },
  { value: 'anthropic',  label: 'Anthropic' },
  { value: 'gemini',     label: 'Gemini' },
  { value: 'azure',      label: 'Azure OpenAI' },
  { value: 'mistral',    label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
]
