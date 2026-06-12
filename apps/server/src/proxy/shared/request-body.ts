/**
 * Request-body intake shared by all 4 proxy handlers.
 *
 * Each provider parses the incoming body the same way: read text, attempt
 * JSON parse (non-JSON bodies pass through verbatim), detect streaming.
 * OpenAI + Azure also inject `stream_options: { include_usage: true }` so
 * the last SSE chunk carries token usage — without it the stream parser
 * sees nothing and the log row records zero tokens.
 */

import type { Context } from 'hono'

export interface ParsedProxyBody {
  /** Raw text — forwarded upstream when JSON parse fails or no transform applies. */
  reqBodyText: string
  /** Parsed JSON, or null if the body wasn't valid JSON. */
  reqBodyJson: Record<string, unknown> | null
  /** True when the parsed body has `stream: true`. */
  isStreaming: boolean
}

export interface ParseOptions {
  /** When true, inject `stream_options.include_usage = true` on streaming
   * requests so the last chunk includes usage. OpenAI + Azure require this;
   * Anthropic + Gemini have native usage in their stream protocols. */
  injectOpenAIStreamOptions?: boolean
}

export async function parseProxyRequestBody(
  c: Context,
  opts: ParseOptions = {},
): Promise<ParsedProxyBody> {
  const reqBodyText = await c.req.text()
  let reqBodyJson: Record<string, unknown> | null = null
  let isStreaming = false

  try {
    reqBodyJson = JSON.parse(reqBodyText) as Record<string, unknown>
    isStreaming = reqBodyJson.stream === true
    if (isStreaming && opts.injectOpenAIStreamOptions) {
      reqBodyJson = {
        ...reqBodyJson,
        stream_options: { include_usage: true },
      }
    }
  } catch {
    /* non-JSON body — pass through verbatim */
  }

  return { reqBodyText, reqBodyJson, isStreaming }
}

/**
 * Choose the body string to send upstream. GET/HEAD are body-less.
 * Streaming OpenAI/Azure paths re-serialize the modified JSON (because
 * `stream_options` was injected); other paths forward the original text.
 */
export function chooseFetchBody(
  c: Context,
  parsed: ParsedProxyBody,
  reSerializeOnStream: boolean,
): string | null {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return null
  if (reSerializeOnStream && parsed.isStreaming && parsed.reqBodyJson) {
    return JSON.stringify(parsed.reqBodyJson)
  }
  return parsed.reqBodyText
}
