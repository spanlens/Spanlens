/**
 * Anthropic client helper — pre-configured for the Spanlens proxy.
 *
 *   import { createAnthropic } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 * `@anthropic-ai/sdk` is a peer dependency.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ClientOptions } from '@anthropic-ai/sdk'

export const PROMPT_VERSION_HEADER = 'x-spanlens-prompt-version'

export const DEFAULT_SPANLENS_ANTHROPIC_PROXY =
  'https://spanlens-server.vercel.app/proxy/anthropic'

export function createAnthropic(options: ClientOptions = {}): Anthropic {
  const apiKey = options.apiKey ?? readEnv('SPANLENS_API_KEY')

  if (!apiKey) {
    throw new Error(
      '[spanlens] SPANLENS_API_KEY is not set. Pass { apiKey } to createAnthropic() ' +
        'or add SPANLENS_API_KEY to your environment.',
    )
  }

  return new Anthropic({
    ...options,
    apiKey,
    baseURL: options.baseURL ?? DEFAULT_SPANLENS_ANTHROPIC_PROXY,
  })
}

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name]
  }
  return undefined
}

/**
 * Tag a single Anthropic request with a Spanlens prompt version.
 *
 * @param id Either a raw `prompt_versions.id` UUID, `"<name>@<version>"`, or
 *           `"<name>@latest"`.
 *
 * @example
 *   import { createAnthropic, withPromptVersion } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 *   const msg = await anthropic.messages.create(
 *     { model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, messages: [...] },
 *     withPromptVersion('greeter@latest'),
 *   )
 */
export function withPromptVersion(id: string): { headers: Record<string, string> } {
  return { headers: { [PROMPT_VERSION_HEADER]: id } }
}
