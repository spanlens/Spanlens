'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

interface ModelRow {
  name: string
  provider: string
  inputPer1M: number
  outputPer1M: number
  slug?: string
}

const MODELS: ModelRow[] = [
  { name: 'GPT-4o', provider: 'OpenAI', inputPer1M: 2.5, outputPer1M: 10.0, slug: 'gpt-4o' },
  { name: 'GPT-4o-mini', provider: 'OpenAI', inputPer1M: 0.15, outputPer1M: 0.6, slug: 'gpt-4o-mini' },
  { name: 'o3-mini', provider: 'OpenAI', inputPer1M: 1.1, outputPer1M: 4.4, slug: 'o3-mini' },
  { name: 'Claude 3.5 Sonnet', provider: 'Anthropic', inputPer1M: 3.0, outputPer1M: 15.0, slug: 'claude-3-5-sonnet' },
  { name: 'Claude 3.5 Haiku', provider: 'Anthropic', inputPer1M: 0.8, outputPer1M: 4.0 },
  { name: 'Claude Opus 4', provider: 'Anthropic', inputPer1M: 15.0, outputPer1M: 75.0 },
  { name: 'Gemini 2.0 Flash', provider: 'Google', inputPer1M: 0.1, outputPer1M: 0.4, slug: 'gemini-2-0-flash' },
  { name: 'Gemini 1.5 Pro', provider: 'Google', inputPer1M: 1.25, outputPer1M: 5.0 },
  { name: 'Gemini 1.5 Flash', provider: 'Google', inputPer1M: 0.075, outputPer1M: 0.3 },
  { name: 'Mistral Large 2', provider: 'Mistral', inputPer1M: 2.0, outputPer1M: 6.0 },
]

function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function calc(m: ModelRow, inputTokens: number, outputTokens: number, requestsPerMonth: number): number {
  const inputCost = (inputTokens * requestsPerMonth * m.inputPer1M) / 1_000_000
  const outputCost = (outputTokens * requestsPerMonth * m.outputPer1M) / 1_000_000
  return inputCost + outputCost
}

export function CostCalculator() {
  const [inputTokens, setInputTokens] = useState(1500)
  const [outputTokens, setOutputTokens] = useState(500)
  const [requestsPerMonth, setRequestsPerMonth] = useState(100_000)

  const rows = useMemo(() => {
    return MODELS.map((m) => ({
      model: m,
      monthly: calc(m, inputTokens, outputTokens, requestsPerMonth),
      perRequest: calc(m, inputTokens, outputTokens, 1),
    })).sort((a, b) => a.monthly - b.monthly)
  }, [inputTokens, outputTokens, requestsPerMonth])

  const cheapest = rows[0]?.monthly ?? 0

  return (
    <div className="rounded-xl border border-border bg-bg-elev p-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <NumberField
          label="Input tokens / request"
          value={inputTokens}
          onChange={setInputTokens}
          min={0}
          step={100}
        />
        <NumberField
          label="Output tokens / request"
          value={outputTokens}
          onChange={setOutputTokens}
          min={0}
          step={100}
        />
        <NumberField
          label="Requests / month"
          value={requestsPerMonth}
          onChange={setRequestsPerMonth}
          min={0}
          step={1000}
        />
      </div>

      <div className="rounded-xl border border-border bg-bg overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                Model
              </th>
              <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                Provider
              </th>
              <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                Cost / req
              </th>
              <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                Monthly
              </th>
              <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                vs cheapest
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const multiplier = cheapest > 0 ? r.monthly / cheapest : 0
              return (
                <tr
                  key={r.model.name}
                  className={i < rows.length - 1 ? 'border-b border-border' : ''}
                >
                  <td className="px-4 py-2.5 font-semibold text-text">
                    {r.model.slug ? (
                      <Link
                        href={`/pricing/${r.model.slug}`}
                        className="hover:text-accent transition-colors"
                      >
                        {r.model.name}
                      </Link>
                    ) : (
                      r.model.name
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-text-muted">{r.model.provider}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-text-muted">
                    {formatUsd(r.perRequest)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-text">
                    {formatUsd(r.monthly)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-text-faint">
                    {multiplier === 1 ? 'cheapest' : `${multiplier.toFixed(1)}x`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[11px] text-text-faint">
        Standard tier prices, 2026-06-16. No cache or batch discounts applied. Click a
        model name for the full breakdown.
      </p>
    </div>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  step?: number
}

function NumberField({ label, value, onChange, min = 0, step = 1 }: NumberFieldProps) {
  return (
    <label className="block">
      <span className="block font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-2">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) && n >= min ? n : min)
        }}
        className="w-full h-10 px-3 rounded-[6px] border border-border bg-bg text-text font-mono text-[14px] focus:outline-none focus:border-accent transition-colors"
      />
    </label>
  )
}
