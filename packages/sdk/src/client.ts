import type { SpanlensConfig, TraceOptions, SpanOptions, Trace, Span } from './types.js'

export class SpanlensClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: SpanlensConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl ?? 'https://api.spanlens.io'
  }

  async startTrace(options: TraceOptions): Promise<Trace> {
    const traceId = crypto.randomUUID()
    const startedAt = new Date()

    await this.post('/api/v1/traces', {
      trace_id: traceId,
      name: options.name,
      metadata: options.metadata,
      started_at: startedAt.toISOString(),
    })

    return { traceId, name: options.name, startedAt }
  }

  async span(trace: Trace, options: SpanOptions): Promise<Span> {
    const spanId = crypto.randomUUID()
    const startedAt = new Date()

    const end = async (output?: unknown): Promise<void> => {
      await this.post('/api/v1/spans', {
        span_id: spanId,
        trace_id: trace.traceId,
        name: options.name,
        parent_span_id: options.parentSpanId,
        metadata: options.metadata,
        output,
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
      })
    }

    return {
      spanId,
      traceId: trace.traceId,
      name: options.name,
      parentSpanId: options.parentSpanId,
      startedAt,
      end,
    }
  }

  private async post(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      console.error(`[spanlens] ${path} failed: ${response.status}`)
    }
  }
}
