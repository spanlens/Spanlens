'use client'
import { useState } from 'react'
import { Section, FormRow, GhostBtn } from '@/components/ui/primitives'
import { MonoPill, TabHeader } from '../_shared/ui'

// ─── OPENTELEMETRY tab ────────────────────────────────────────────────────────

const OTEL_ENDPOINT = 'https://api.spanlens.io/v1/traces'

const OTEL_CODE_EXAMPLE = `import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: '${OTEL_ENDPOINT}',
    headers: {
      Authorization: 'Bearer <your-api-key>',
    },
  }),
})

sdk.start()`

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-[11px] text-text-faint hover:text-text transition-colors shrink-0"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export function OpenTelemetryTab() {
  const [healthStatus, setHealthStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  async function handleTestConnection() {
    setHealthStatus('idle')
    try {
      const res = await fetch('/health')
      setHealthStatus(res.ok ? 'ok' : 'error')
    } catch {
      setHealthStatus('error')
    }
  }

  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="OpenTelemetry"
        description="Ingest OTLP traces directly from any OpenTelemetry-compatible SDK."
      />

      <Section title="OTLP endpoint" className="mb-5">
        <FormRow label="Endpoint URL" hint="Use this as the OTLP HTTP exporter endpoint.">
          <div className="flex items-center gap-3 w-full max-w-[560px]">
            <div className="flex-1 font-mono text-[12px] text-text bg-bg-muted px-3 py-2 rounded border border-border truncate">
              {OTEL_ENDPOINT}
            </div>
            <CopyButton value={OTEL_ENDPOINT} />
          </div>
        </FormRow>
        <FormRow label="Authentication" hint="Pass your Spanlens API key as a Bearer token.">
          <div className="font-mono text-[12px] text-text-muted">
            <span className="text-text">Authorization:</span> Bearer &lt;your-api-key&gt;
          </div>
        </FormRow>
      </Section>

      <Section title="SDK setup example" className="mb-5">
        <div className="px-6 pb-5">
          <div className="relative">
            <pre className="rounded-[6px] bg-bg-muted border border-border px-4 py-4 font-mono text-[11.5px] text-text-muted overflow-x-auto leading-relaxed whitespace-pre">
              {OTEL_CODE_EXAMPLE}
            </pre>
            <div className="absolute top-3 right-3">
              <CopyButton value={OTEL_CODE_EXAMPLE} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Connection" className="mb-5">
        <div className="px-6 py-4 flex items-center gap-4">
          <GhostBtn onClick={() => void handleTestConnection()}>
            Test connection
          </GhostBtn>
          {healthStatus === 'ok' && (
            <MonoPill variant="good" dot>Server reachable</MonoPill>
          )}
          {healthStatus === 'error' && (
            <MonoPill variant="faint" dot>Unreachable</MonoPill>
          )}
        </div>
      </Section>
    </div>
  )
}
