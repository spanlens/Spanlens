/**
 * Convert a Spanlens trace + its spans into an OTLP HTTP/JSON envelope.
 *
 * Why: enterprise customers already run Datadog / Honeycomb / Jaeger /
 * Tempo for the rest of their stack and don't want LLM observability to
 * live in a silo. The "Download as OTLP" button on the trace detail page
 * hits this serializer and returns a single JSON file the operator can
 * upload to any OTLP-aware backend, or pipe through
 * `curl -X POST -d @file.json https://<collector>/v1/traces`.
 *
 * Spec references:
 *   - OTLP HTTP encoding: https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding
 *   - GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * What this is NOT: a real-time push exporter. That's a separate feature
 * (per-org collector endpoint + cron-driven forwarding). This module is the
 * one-row download path — the smallest user-visible deliverable that signals
 * "Spanlens is not a data silo".
 */

/** Subset of the Spanlens trace row this exporter needs. */
export interface SpanlensTrace {
  id: string
  name: string
  status: string | null
  started_at: string | null
  ended_at: string | null
  metadata?: Record<string, unknown> | null
}

/** Subset of the Spanlens span row this exporter needs. */
export interface SpanlensSpan {
  id: string
  parent_span_id?: string | null
  name: string
  span_type?: string | null
  status: string | null
  started_at: string | null
  ended_at: string | null
  error_message?: string | null
  metadata?: Record<string, unknown> | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  cost_usd?: number | null
}

/** OTLP attribute value — one of the supported scalar shapes. */
type OtlpAttrValue =
  | { stringValue: string }
  | { intValue: string }    // OTLP spec stores int64 as string in JSON
  | { doubleValue: number }
  | { boolValue: boolean }

interface OtlpAttribute {
  key: string
  value: OtlpAttrValue
}

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
  status: { code: number; message?: string }
}

export interface OtlpExport {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] }
    scopeSpans: Array<{
      scope: { name: string; version: string }
      spans: OtlpSpan[]
    }>
  }>
}

// OpenTelemetry SpanKind enum values (proto). LLM and tool calls are
// client-style (we initiate work against an external system).
const SPAN_KIND_INTERNAL = 1
const SPAN_KIND_CLIENT = 3
// Status codes per the OTLP spec.
const STATUS_CODE_UNSET = 0
const STATUS_CODE_OK = 1
const STATUS_CODE_ERROR = 2

/**
 * Spanlens UUIDs are 32 hex chars (128 bits) — perfect for OTLP traceId
 * (16 bytes / 32 hex). For OTLP spanId (8 bytes / 16 hex) we take the
 * leading half. This is deterministic so re-exporting the same trace
 * always produces the same ids — important if the customer wants to
 * deduplicate against a previous upload.
 */
function uuidToTraceId(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase()
}

function uuidToSpanId(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 16).toLowerCase()
}

function isoToUnixNano(iso: string | null): string {
  if (!iso) return '0'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '0'
  // OTLP timestamps are nanoseconds since Unix epoch, encoded as string
  // because JS numbers lose precision above 2^53.
  return `${ms}000000`
}

function attrStr(key: string, value: string | null | undefined): OtlpAttribute | null {
  if (value == null || value === '') return null
  return { key, value: { stringValue: value } }
}

function attrInt(key: string, value: number | null | undefined): OtlpAttribute | null {
  if (value == null || !Number.isFinite(value)) return null
  return { key, value: { intValue: String(Math.round(value)) } }
}

function attrDouble(key: string, value: number | null | undefined): OtlpAttribute | null {
  if (value == null || !Number.isFinite(value)) return null
  return { key, value: { doubleValue: value } }
}

function statusFromSpan(span: SpanlensSpan): { code: number; message?: string } {
  if (span.status === 'error' || span.error_message) {
    const out: { code: number; message?: string } = { code: STATUS_CODE_ERROR }
    if (span.error_message) out.message = span.error_message
    return out
  }
  if (span.status === 'completed' || span.status === 'ok') {
    return { code: STATUS_CODE_OK }
  }
  return { code: STATUS_CODE_UNSET }
}

/**
 * Build an OTLP HTTP/JSON envelope for one Spanlens trace.
 *
 * The envelope is shaped so any OTLP-aware backend (Datadog, Honeycomb,
 * Jaeger, Tempo, Grafana) accepts it via `POST /v1/traces`. We bake the
 * gen_ai semantic-convention attributes onto every span so the receiving
 * backend's LLM views light up automatically.
 */
export function traceToOtlp(trace: SpanlensTrace, spans: SpanlensSpan[]): OtlpExport {
  const traceIdHex = uuidToTraceId(trace.id)

  const resourceAttributes: OtlpAttribute[] = [
    { key: 'service.name', value: { stringValue: 'spanlens' } },
    { key: 'service.namespace', value: { stringValue: 'llm-observability' } },
    { key: 'telemetry.sdk.name', value: { stringValue: 'spanlens-otel-export' } },
  ]

  const otlpSpans: OtlpSpan[] = spans.map((span) => {
    const spanIdHex = uuidToSpanId(span.id)
    const meta = (span.metadata ?? {}) as Record<string, unknown>
    const provider = typeof meta['provider'] === 'string' ? meta['provider'] : undefined
    const model = typeof meta['model'] === 'string' ? meta['model'] : undefined

    const attrs: OtlpAttribute[] = []
    const pushIf = (a: OtlpAttribute | null): void => { if (a) attrs.push(a) }

    // Spanlens-native attributes — keep so a downstream filter can isolate
    // these spans from non-Spanlens traffic.
    pushIf(attrStr('spanlens.span_type', span.span_type))
    pushIf(attrDouble('spanlens.cost_usd', span.cost_usd))

    // GenAI semantic conventions — what Datadog/Honeycomb LLM views consume.
    // Map only what we actually have; missing attributes are omitted rather
    // than emitted as empty strings.
    pushIf(attrStr('gen_ai.system', provider))
    pushIf(attrStr('gen_ai.request.model', model))
    pushIf(attrInt('gen_ai.usage.input_tokens', span.prompt_tokens))
    pushIf(attrInt('gen_ai.usage.output_tokens', span.completion_tokens))
    pushIf(attrInt('gen_ai.usage.total_tokens', span.total_tokens))

    const kind = span.span_type === 'llm' || span.span_type === 'tool'
      ? SPAN_KIND_CLIENT
      : SPAN_KIND_INTERNAL

    const out: OtlpSpan = {
      traceId: traceIdHex,
      spanId: spanIdHex,
      name: span.name,
      kind,
      startTimeUnixNano: isoToUnixNano(span.started_at),
      endTimeUnixNano: isoToUnixNano(span.ended_at),
      attributes: attrs,
      status: statusFromSpan(span),
    }
    if (span.parent_span_id) {
      out.parentSpanId = uuidToSpanId(span.parent_span_id)
    }
    return out
  })

  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes },
        scopeSpans: [
          {
            scope: { name: 'spanlens', version: '1.0.0' },
            spans: otlpSpans,
          },
        ],
      },
    ],
  }
}
