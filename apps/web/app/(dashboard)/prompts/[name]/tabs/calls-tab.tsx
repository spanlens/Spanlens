'use client'
import { useState } from 'react'
import { usePromptCompare } from '@/lib/queries/use-prompts'
import { cn } from '@/lib/utils'

interface Props {
  name: string
}

type DateRange = '7d' | '30d' | '90d'
const HOURS: Record<DateRange, number> = { '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 }

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}
function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

export function CallsTab({ name }: Props) {
  const [range, setRange] = useState<DateRange>('30d')
  const { data: metrics, isLoading } = usePromptCompare(name, HOURS[range])

  const totalCalls = metrics?.reduce((s, m) => s + m.sampleCount, 0) ?? 0
  const totalCost = metrics?.reduce((s, m) => s + m.totalCostUsd, 0) ?? 0
  const totalErrors = metrics?.reduce((s, m) => s + Math.round(m.errorRate * m.sampleCount), 0) ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-[22px] py-[12px] border-b border-border shrink-0 bg-bg-muted">
        <span className="font-mono text-[11.5px] text-text font-medium">Aggregated calls</span>
        <span className="flex-1" />
        <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px]">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                'px-[10px] py-[3px] rounded-[3px] transition-colors',
                range === r ? 'bg-text text-bg' : 'text-text-muted hover:text-text',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-[22px]">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : !metrics || metrics.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-text-muted">
            <p className="text-[13px]">No calls recorded for this prompt in the last {range}.</p>
            <p className="font-mono text-[11px] text-text-faint">
              Tag requests with{' '}
              <code className="bg-bg-elev px-1 rounded">{name}@latest</code>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* KPI row */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total calls',  value: totalCalls.toLocaleString() },
                { label: 'Total spend',  value: fmtUsd(totalCost) },
                { label: 'Total errors', value: String(totalErrors), bad: totalErrors > 0 },
                { label: 'Avg tokens',   value: (() => {
                  const wt = metrics.reduce((s, m) => s + m.sampleCount, 0)
                  if (wt === 0) return '—'
                  const avg = metrics.reduce((s, m) => s + (m.avgPromptTokens + m.avgCompletionTokens) * m.sampleCount, 0) / wt
                  return Math.round(avg).toLocaleString()
                })() },
              ].map((s, i) => (
                <div key={i} className="bg-bg-elev border border-border rounded-[6px] px-[16px] py-[12px]">
                  <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1.5">{s.label}</div>
                  <div className={cn(
                    'font-mono text-[20px] font-medium',
                    s.bad ? 'text-bad' : 'text-text',
                  )}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Per-version table */}
            <div className="bg-bg-elev border border-border rounded-[6px] overflow-hidden">
              <div
                className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[16px] py-[9px] bg-bg-muted border-b border-border"
                style={{ gridTemplateColumns: '80px 70px 100px 100px 100px 110px 100px' }}
              >
                <span>Version</span>
                <span className="text-right">Calls</span>
                <span className="text-right">Avg latency</span>
                <span className="text-right">Error rate</span>
                <span className="text-right">Avg cost</span>
                <span className="text-right">Prompt tokens</span>
                <span className="text-right">Compl. tokens</span>
              </div>
              {metrics.map((m) => (
                <div
                  key={m.promptVersionId}
                  className="grid items-center px-[16px] py-[11px] border-b border-border last:border-0"
                  style={{ gridTemplateColumns: '80px 70px 100px 100px 100px 110px 100px' }}
                >
                  <span className="font-mono text-[11px] text-text-muted">v{m.version}</span>
                  <span className="text-right font-mono text-[12px] text-text-muted">{m.sampleCount.toLocaleString()}</span>
                  <span className="text-right font-mono text-[12px] text-text-muted">{fmtMs(m.avgLatencyMs)}</span>
                  <span className={cn(
                    'text-right font-mono text-[12px]',
                    m.errorRate === 0 ? 'text-good' : m.errorRate < 0.05 ? 'text-warn' : 'text-bad',
                  )}>
                    {(m.errorRate * 100).toFixed(1)}%
                  </span>
                  <span className="text-right font-mono text-[12px] text-text-muted">{fmtUsd(m.avgCostUsd)}</span>
                  <span className="text-right font-mono text-[12px] text-text-muted">
                    {m.avgPromptTokens > 0 ? Math.round(m.avgPromptTokens).toLocaleString() : '—'}
                  </span>
                  <span className="text-right font-mono text-[12px] text-text-muted">
                    {m.avgCompletionTokens > 0 ? Math.round(m.avgCompletionTokens).toLocaleString() : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
