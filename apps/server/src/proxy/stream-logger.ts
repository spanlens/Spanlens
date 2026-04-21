import { calculateCost, type Provider } from '../lib/cost.js'
import { logRequestAsync, type RequestLogData } from '../lib/logger.js'
import { parseOpenAIStreamChunk } from '../parsers/openai.js'
import { parseAnthropicStreamStart, parseAnthropicStreamChunk } from '../parsers/anthropic.js'

type StreamLogBase = Omit<
  RequestLogData,
  'promptTokens' | 'completionTokens' | 'totalTokens' | 'costUsd' | 'model'
> & { model: string }

/**
 * tee()는 back-pressure 문제로 Vercel 서버리스에서 5분 타임아웃 유발.
 * 대신 TransformStream을 사용해 단일 파이프라인으로 처리:
 *   upstreamRes.body → makeStreamLogger() → Vercel → Client
 * transform(): 청크를 클라이언트에 즉시 전달하면서 동시에 수집
 * flush(): 스트림 종료 후 DB 로깅 (Response가 클라이언트에 전달된 이후)
 */

export function makeOpenAIStreamLogger(
  base: StreamLogBase,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let buf = ''
  const lines: string[] = []

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk) // 클라이언트에 즉시 전달

      buf += decoder.decode(chunk, { stream: true })
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      lines.push(...parts)
    },

    async flush() {
      if (buf) lines.push(buf)

      let model = base.model
      let promptTokens = 0
      let completionTokens = 0
      let totalTokens = 0

      for (const line of lines) {
        const parsed = parseOpenAIStreamChunk(line)
        if (!parsed) continue
        if (parsed.model) model = parsed.model
        if (parsed.promptTokens) promptTokens = parsed.promptTokens
        if (parsed.completionTokens) completionTokens = parsed.completionTokens
        if (parsed.totalTokens) totalTokens = parsed.totalTokens
      }

      const cost = calculateCost('openai' as Provider, model, { promptTokens, completionTokens })

      await logRequestAsync({
        ...base,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: cost?.totalCost ?? null,
      }).catch(console.error)
    },
  })
}

export function makeAnthropicStreamLogger(
  base: StreamLogBase,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let buf = ''
  const lines: string[] = []

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk) // 클라이언트에 즉시 전달

      buf += decoder.decode(chunk, { stream: true })
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      lines.push(...parts)
    },

    async flush() {
      if (buf) lines.push(buf)

      let model = base.model
      let promptTokens = 0
      let completionTokens = 0

      for (const line of lines) {
        const start = parseAnthropicStreamStart(line)
        if (start) {
          if (start.promptTokens) promptTokens = start.promptTokens
          if (start.model) model = start.model
          continue
        }
        const delta = parseAnthropicStreamChunk(line)
        if (delta?.completionTokens) completionTokens += delta.completionTokens
      }

      const totalTokens = promptTokens + completionTokens
      const cost = calculateCost('anthropic' as Provider, model, { promptTokens, completionTokens })

      await logRequestAsync({
        ...base,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: cost?.totalCost ?? null,
      }).catch(console.error)
    },
  })
}
