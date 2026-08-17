'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePromptCompare } from '@/lib/queries/use-prompts'
import { cn } from '@/lib/utils'
import {
  FilterBar,
  Segment,
  SegmentItem,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../../../_board/surfaces'

interface Props {
  name: string
}

type DateRange = '7d' | '30d' | '90d'
const HOURS: Record<DateRange, number> = { '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 }

// Eight numeric columns need more room than a narrow viewport has, so the card
// scrolls its own table sideways rather than the page.
const CALLS_GRID: React.CSSProperties = {
  gridTemplateColumns: '90px 90px 110px 100px 90px 110px 120px 120px',
}

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
  const avgTokens = (() => {
    if (!metrics) return '—'
    const wt = metrics.reduce((s, m) => s + m.sampleCount, 0)
    if (wt === 0) return '—'
    const avg = metrics.reduce((s, m) => s + (m.avgPromptTokens + m.avgCompletionTokens) * m.sampleCount, 0) / wt
    return Math.round(avg).toLocaleString()
  })()

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <span className="text-[12.5px] font-medium leading-[18px] text-text">Aggregated calls</span>
        <Segment className="ml-auto">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <SegmentItem key={r} active={range === r} onClick={() => setRange(r)}>
              {r}
            </SegmentItem>
          ))}
        </Segment>
      </FilterBar>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-card bg-bg-chip" />)}
        </div>
      ) : !metrics || metrics.length === 0 ? (
        <div className="card-surface rounded-card flex h-48 flex-col items-center justify-center gap-2 text-text-muted">
          <p className="text-[12.5px]">No calls recorded for this prompt in the last {range}.</p>
          <p className="font-mono text-[11px] text-text-faint">
            Tag requests with{' '}
            <code className="rounded border border-border bg-bg-sunk px-1 text-text">{name}@latest</code>
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total calls" value={totalCalls.toLocaleString()} foot={`last ${range}`} />
            <StatCard label="Total spend" value={fmtUsd(totalCost)} foot={`last ${range}`} />
            <StatCard
              label="Total errors"
              value={totalErrors.toLocaleString()}
              foot={totalErrors > 0 ? 'non-200 responses' : 'all responses succeeded'}
              {...(totalErrors > 0 ? { footClass: 'text-bad' } : {})}
            />
            <StatCard label="Avg tokens" value={avgTokens} foot="prompt plus completion" />
          </div>

          <TableCard>
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                <TableHead>
                  <div className="grid items-center gap-3" style={CALLS_GRID}>
                    <Th>Version</Th>
                    <Th className="block text-right">Calls</Th>
                    <Th className="block text-right">Avg latency</Th>
                    <Th className="block text-right">Error rate</Th>
                    <Th className="block text-right">Quality</Th>
                    <Th className="block text-right">Avg cost</Th>
                    <Th className="block text-right">Prompt tokens</Th>
                    <Th className="block text-right">Compl. tokens</Th>
                  </div>
                </TableHead>
                {metrics.map((m) => (
                  <Link
                    key={m.promptVersionId}
                    href={`/requests?promptVersionId=${m.promptVersionId}`}
                    className={cn(
                      ROW,
                      'grid items-center gap-3 font-mono text-[12px] transition-colors hover:bg-bg-muted',
                    )}
                    style={CALLS_GRID}
                  >
                    <span className="text-text">v{m.version}</span>
                    <span className="text-right tabular-nums text-text-muted">
                      {m.sampleCount.toLocaleString()}
                    </span>
                    <span className="text-right tabular-nums text-text-muted">{fmtMs(m.avgLatencyMs)}</span>
                    <span className={cn(
                      'text-right tabular-nums',
                      m.errorRate === 0 ? 'text-good' : m.errorRate < 0.05 ? 'text-warn' : 'text-bad',
                    )}>
                      {(m.errorRate * 100).toFixed(1)}%
                    </span>
                    <span
                      className={cn(
                        'text-right tabular-nums',
                        m.avgQualityScore == null
                          ? 'text-text-faint'
                          : m.avgQualityScore >= 0.7
                            ? 'text-good'
                            : m.avgQualityScore >= 0.4
                              ? 'text-warn'
                              : 'text-bad',
                      )}
                      title={m.qualitySampleCount > 0 ? `${m.qualitySampleCount} eval samples` : 'No evals run'}
                    >
                      {m.avgQualityScore == null ? '—' : (m.avgQualityScore * 100).toFixed(0)}
                    </span>
                    <span className="text-right tabular-nums text-text-muted">{fmtUsd(m.avgCostUsd)}</span>
                    <span className="text-right tabular-nums text-text-muted">
                      {m.avgPromptTokens > 0 ? Math.round(m.avgPromptTokens).toLocaleString() : '—'}
                    </span>
                    <span className="text-right tabular-nums text-text-muted">
                      {m.avgCompletionTokens > 0 ? Math.round(m.avgCompletionTokens).toLocaleString() : '—'}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </TableCard>
        </>
      )}
    </div>
  )
}
