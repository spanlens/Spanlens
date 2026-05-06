'use client'
import { useState } from 'react'

type Provider = 'openai' | 'anthropic' | 'gemini'
type TraceScenario = 'multistep' | 'parallel' | 'error'

interface CallResult {
  ok: boolean
  traceId?: string
  reply?: string
  usage?: unknown
  latencyMs?: number
  error?: string
}

interface TraceResult {
  ok: boolean
  traceId?: string
  errorCaptured?: string
  [key: string]: unknown
}

const PROVIDERS: Array<{ id: Provider; label: string; model: string }> = [
  { id: 'openai',    label: 'OpenAI',    model: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic', model: 'claude-haiku-4-5' },
  { id: 'gemini',    label: 'Gemini',    model: 'gemini-2.0-flash' },
]

const TRACE_SCENARIOS: Array<{ id: TraceScenario; label: string; description: string }> = [
  {
    id: 'multistep',
    label: 'Multi-step agent',
    description: 'classify_intent → kb_search → compose_reply (3-depth tree)',
  },
  {
    id: 'parallel',
    label: 'Parallel fan-out',
    description: 'subtask_a + subtask_b + subtask_c in parallel (bars overlap)',
  },
  {
    id: 'error',
    label: 'Error capture',
    description: 'step_ok succeeds, step_fail throws — trace status=error',
  },
]

export default function Home() {
  const [results, setResults] = useState<Record<Provider, CallResult | null>>({
    openai: null, anthropic: null, gemini: null,
  })
  const [loading, setLoading] = useState<Record<Provider, boolean>>({
    openai: false, anthropic: false, gemini: false,
  })
  const [traceResults, setTraceResults] = useState<Record<TraceScenario, TraceResult | null>>({
    multistep: null, parallel: null, error: null,
  })
  const [traceLoading, setTraceLoading] = useState<Record<TraceScenario, boolean>>({
    multistep: false, parallel: false, error: false,
  })

  async function callProvider(id: Provider) {
    setLoading((s) => ({ ...s, [id]: true }))
    setResults((r) => ({ ...r, [id]: null }))
    const t0 = Date.now()
    try {
      const res = await fetch(`/api/${id}`, { method: 'POST' })
      const data = (await res.json()) as CallResult
      setResults((r) => ({
        ...r,
        [id]: { ...data, latencyMs: Date.now() - t0 },
      }))
    } catch (err) {
      setResults((r) => ({
        ...r,
        [id]: { ok: false, error: err instanceof Error ? err.message : String(err) },
      }))
    } finally {
      setLoading((s) => ({ ...s, [id]: false }))
    }
  }

  async function callTrace(id: TraceScenario) {
    setTraceLoading((s) => ({ ...s, [id]: true }))
    setTraceResults((r) => ({ ...r, [id]: null }))
    try {
      const res = await fetch(`/api/agent-${id}`, { method: 'POST' })
      const data = (await res.json()) as TraceResult
      setTraceResults((r) => ({ ...r, [id]: data }))
    } catch (err) {
      setTraceResults((r) => ({
        ...r,
        [id]: { ok: false, error: err instanceof Error ? err.message : String(err) },
      }))
    } finally {
      setTraceLoading((s) => ({ ...s, [id]: false }))
    }
  }

  return (
    <main>
      <h1>Spanlens onboarding test</h1>
      <p className="subtitle">Click a button → request goes through Spanlens → check /requests or /traces</p>

      {/* ── Proxy requests ── */}
      <h2 style={{ fontFamily: 'monospace', fontSize: 13, color: '#888', marginBottom: 12, marginTop: 24, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Proxy Requests → /requests
      </h2>
      {PROVIDERS.map(({ id, label, model }) => {
        const result = results[id]
        return (
          <div key={id} className="card">
            <div className="card-header">
              <div>
                <div className="provider-name">{label}</div>
                <div className="model-name">{model}</div>
              </div>
              <button onClick={() => callProvider(id)} disabled={loading[id]}>
                {loading[id] ? '...' : '▶ Call'}
              </button>
            </div>

            {result && (
              <div className={`result ${result.ok ? '' : 'error'}`}>
                {result.ok ? (
                  <>
                    {result.traceId && (
                      <div>
                        trace:{' '}
                        <a
                          href={`https://www.spanlens.io/traces/${result.traceId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#6ee7b7', textDecoration: 'underline' }}
                        >
                          {result.traceId}
                        </a>
                      </div>
                    )}
                    {result.reply}
                    <div className="meta">
                      {result.latencyMs}ms · usage: {JSON.stringify(result.usage)}
                    </div>
                  </>
                ) : (
                  <>Error: {result.error}</>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Trace scenarios ── */}
      <h2 style={{ fontFamily: 'monospace', fontSize: 13, color: '#888', marginBottom: 12, marginTop: 32, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Agent Traces → /traces
      </h2>
      {TRACE_SCENARIOS.map(({ id, label, description }) => {
        const result = traceResults[id]
        return (
          <div key={id} className="card">
            <div className="card-header">
              <div>
                <div className="provider-name">{label}</div>
                <div className="model-name">{description}</div>
              </div>
              <button onClick={() => callTrace(id)} disabled={traceLoading[id]}>
                {traceLoading[id] ? '...' : '▶ Run'}
              </button>
            </div>

            {result && (
              <div className={`result ${result.ok ? '' : 'error'}`}>
                {result.ok ? (
                  <>
                    {result.traceId && (
                      <div>
                        trace:{' '}
                        <a
                          href={`https://www.spanlens.io/traces/${result.traceId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#6ee7b7', textDecoration: 'underline' }}
                        >
                          {result.traceId}
                        </a>
                      </div>
                    )}
                    {result.errorCaptured && (
                      <div className="meta">captured error: {result.errorCaptured}</div>
                    )}
                    <div className="meta">{JSON.stringify(result, null, 2)}</div>
                  </>
                ) : (
                  <>Error: {String(result.error ?? 'unknown')}</>
                )}
              </div>
            )}
          </div>
        )
      })}

      <div className="dashboard-link">
        Requests:{' '}
        <a href="https://www.spanlens.io/requests" target="_blank" rel="noopener noreferrer">
          spanlens.io/requests →
        </a>
        {'  ·  '}
        Traces:{' '}
        <a href="https://www.spanlens.io/traces" target="_blank" rel="noopener noreferrer">
          spanlens.io/traces →
        </a>
      </div>
    </main>
  )
}
