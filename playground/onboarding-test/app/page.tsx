'use client'
import { useState } from 'react'

type Provider = 'openai' | 'anthropic' | 'gemini'

interface CallResult {
  ok: boolean
  reply?: string
  usage?: unknown
  latencyMs?: number
  error?: string
}

const PROVIDERS: Array<{ id: Provider; label: string; model: string }> = [
  { id: 'openai',    label: 'OpenAI',    model: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic', model: 'claude-haiku-4-5' },
  { id: 'gemini',    label: 'Gemini',    model: 'gemini-2.0-flash' },
]

export default function Home() {
  const [results, setResults] = useState<Record<Provider, CallResult | null>>({
    openai: null, anthropic: null, gemini: null,
  })
  const [loading, setLoading] = useState<Record<Provider, boolean>>({
    openai: false, anthropic: false, gemini: false,
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

  return (
    <main>
      <h1>Spanlens onboarding test</h1>
      <p className="subtitle">Click a button → request goes through Spanlens → check /requests</p>

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

      <div className="dashboard-link">
        After clicking → check{' '}
        <a href="https://www.spanlens.io/requests" target="_blank" rel="noopener noreferrer">
          spanlens.io/requests →
        </a>
      </div>
    </main>
  )
}
