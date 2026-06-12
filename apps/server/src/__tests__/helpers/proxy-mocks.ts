import { vi } from 'vitest'

/**
 * Shared state + helpers for the proxy-{openai,anthropic,gemini,azure}
 * integration tests. The mocks themselves are declared *inline* in each test
 * file because `vi.mock` calls are hoisted — they must syntactically appear at
 * the top of the test file, and a factory imported from a helper cannot run
 * at hoist time. This module exposes the shared *state* the inline mocks read
 * from (key id, scope, decrypted key, captured logger args, captured fetch
 * calls) plus a `mockUpstream(...)` fetch installer and a `resetProxyMocks()`
 * reset, so the per-provider test files stay tiny.
 *
 * The pattern:
 *   - proxyState.* — what the mocks return / capture
 *   - mockUpstream(resp) — installs fetch spy that records call + returns resp
 *   - drainPendingTasks() — awaits fire-and-forget logger inserts so tests
 *     can assert `proxyState.loggerCalls` right after `app.request(...)`
 */

export interface FetchCall {
  url: string
  method: string
  headers: Headers
  body: string | null
}

export interface ProxyState {
  /** Set by mocked authApiKey middleware onto Hono context. */
  apiKeyId: string
  organizationId: string
  projectId: string
  scope: 'full' | 'public'
  /** Returned by mocked getDecryptedProviderKey. Empty string → return null. */
  decryptedKey: string
  providerKeyId: string
  /** For azure only — populated as provider_metadata.resource_url. */
  resourceUrl: string
  /** True → isBlockingEnabled returns true (lets the injection-block 422 path fire). */
  blockingEnabled: boolean
  /** Captured outbound fetches (post header-stripping, with provider auth applied). */
  fetchCalls: FetchCall[]
  /** Captured logRequestAsync invocations (after fire-and-forget settles). */
  loggerCalls: Record<string, unknown>[]
  /** Background tasks queued via fireAndForget — awaited in drainPendingTasks. */
  pendingTasks: Promise<unknown>[]
}

export const proxyState: ProxyState = {
  apiKeyId: 'key_test',
  organizationId: 'org_test',
  projectId: 'proj_test',
  scope: 'full',
  decryptedKey: 'sk-decrypted-test-key',
  providerKeyId: 'pk_test',
  resourceUrl: '',
  blockingEnabled: false,
  fetchCalls: [],
  loggerCalls: [],
  pendingTasks: [],
}

export function resetProxyMocks(): void {
  proxyState.apiKeyId = 'key_test'
  proxyState.organizationId = 'org_test'
  proxyState.projectId = 'proj_test'
  proxyState.scope = 'full'
  proxyState.decryptedKey = 'sk-decrypted-test-key'
  proxyState.providerKeyId = 'pk_test'
  proxyState.resourceUrl = ''
  proxyState.blockingEnabled = false
  proxyState.fetchCalls = []
  proxyState.loggerCalls = []
  proxyState.pendingTasks = []
}

/** Build a JSON 200 response for OpenAI/Azure-shaped chat completions. */
export function openAIChatResponse(opts: {
  model?: string
  promptTokens?: number
  completionTokens?: number
  content?: string
} = {}): Response {
  const model = opts.model ?? 'gpt-4o-mini-2024-07-18'
  const body = {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: opts.content ?? 'hello back' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: opts.promptTokens ?? 10,
      completion_tokens: opts.completionTokens ?? 5,
      total_tokens: (opts.promptTokens ?? 10) + (opts.completionTokens ?? 5),
    },
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Build a JSON 200 response for Anthropic-shaped Messages API. */
export function anthropicMessagesResponse(opts: {
  model?: string
  inputTokens?: number
  outputTokens?: number
} = {}): Response {
  const body = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'hello back' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: opts.inputTokens ?? 20,
      output_tokens: opts.outputTokens ?? 7,
    },
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Build a JSON 200 response for Gemini generateContent. */
export function geminiResponse(opts: {
  model?: string
  promptTokens?: number
  completionTokens?: number
} = {}): Response {
  const body = {
    candidates: [
      {
        content: { parts: [{ text: 'hello back' }], role: 'model' },
        finishReason: 'STOP',
      },
    ],
    modelVersion: opts.model ?? 'gemini-1.5-pro',
    usageMetadata: {
      promptTokenCount: opts.promptTokens ?? 12,
      candidatesTokenCount: opts.completionTokens ?? 4,
      totalTokenCount: (opts.promptTokens ?? 12) + (opts.completionTokens ?? 4),
    },
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Install a fetch spy that records the call into proxyState.fetchCalls and
 * returns the configured response. Pass a function to vary per-call (e.g.
 * upstream 401 vs 200). Returns the spy for fine-grained assertions.
 */
export function mockUpstream(
  responder: Response | ((call: FetchCall) => Response | Promise<Response>),
): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers as HeadersInit | undefined)
    let body: string | null = null
    if (init?.body) {
      body = typeof init.body === 'string' ? init.body : String(init.body)
    }
    const call: FetchCall = { url, method, headers, body }
    proxyState.fetchCalls.push(call)
    const resp = typeof responder === 'function' ? await responder(call) : responder
    // Clone so multiple consumers (proxy body read + assertion) get independent
    // streams even though most tests only read once.
    return resp.clone()
  })
}

/** Await any pending fire-and-forget tasks queued via the wait-until mock. */
export async function drainPendingTasks(): Promise<void> {
  // Two flushes — the logger mock awaits internally, but if a test chains
  // additional micro-tasks one round can leave a trailing promise.
  for (let i = 0; i < 2; i++) {
    if (proxyState.pendingTasks.length === 0) break
    const tasks = proxyState.pendingTasks.splice(0)
    await Promise.all(tasks)
  }
}
