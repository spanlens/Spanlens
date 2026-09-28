export type Provider = 'openai' | 'anthropic' | 'gemini'

export interface ProviderConfig {
  /** Module specifier the user is importing from. */
  importedFrom: string
  /** Original imported name (default or named). */
  originalName: string
  /** 'default' = default import, 'named' = named import. */
  importStyle: 'default' | 'named'
  /** Replacement: factory function name. */
  factoryName: string
  /** Replacement module specifier. */
  spanlensSdk: string
  /** Constructor arg shape: 'options' (object) or 'string' (positional apiKey). */
  argShape: 'options' | 'string'
  /**
   * Constructor options that carry a provider credential or the upstream
   * address. They must never reach the Spanlens factory: a leftover key is
   * sent to the Spanlens server, and a leftover baseURL skips the proxy.
   */
  credentialProps: readonly string[]
  /** Path the SDK factory appends to the Spanlens server origin. */
  proxyPath: string
}

export const PROVIDER_CONFIGS: Readonly<Record<Provider, ProviderConfig>> = {
  openai: {
    importedFrom: 'openai',
    originalName: 'OpenAI',
    importStyle: 'default',
    factoryName: 'createOpenAI',
    spanlensSdk: '@spanlens/sdk/openai',
    argShape: 'options',
    credentialProps: ['apiKey', 'baseURL', 'adminAPIKey', 'workloadIdentity'],
    proxyPath: '/proxy/openai/v1',
  },
  anthropic: {
    importedFrom: '@anthropic-ai/sdk',
    originalName: 'Anthropic',
    importStyle: 'default',
    factoryName: 'createAnthropic',
    spanlensSdk: '@spanlens/sdk/anthropic',
    argShape: 'options',
    // authToken / credentials / config / profile all produce an
    // `Authorization: Bearer` header, which the Spanlens server reads before
    // x-api-key. Leaving any of them in would send the Anthropic credential
    // to Spanlens and fail authentication.
    credentialProps: ['apiKey', 'authToken', 'baseURL', 'credentials', 'config', 'profile'],
    proxyPath: '/proxy/anthropic',
  },
  gemini: {
    importedFrom: '@google/generative-ai',
    originalName: 'GoogleGenerativeAI',
    importStyle: 'named',
    factoryName: 'createGemini',
    spanlensSdk: '@spanlens/sdk/gemini',
    argShape: 'string',
    credentialProps: [],
    proxyPath: '/proxy/gemini',
  },
}

/** "a", "a or b", "a, b, or c". */
export function joinOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} or ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
}
