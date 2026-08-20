'use client'
import { useState } from 'react'
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

// D4's TRAFFIC column draws a live share on the accent tint and everything
// else on the neutral chip. Neither is a status, so they carry their own
// classes rather than borrowing a status colour.
const SHARE_CHIP =
  'inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-semibold leading-[15px]'

interface Props {
  name: string
}

type DateRange = '7d' | '30d' | '90d'
const HOURS: Record<DateRange, number> = { '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 }

// Mirrors D4's versions table: the traffic share reads as a lozenge plus a
// meter, with the numeric columns fixed-width behind it.
const TRAFFIC_GRID: React.CSSProperties = {
  gridTemplateColumns: '90px 90px minmax(120px,1fr) 90px 110px 100px 110px',
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}
function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

export function TrafficTab({ name }: Props) {
  const [range, setRange] = useState<DateRange>('30d')
  const { data: metrics, isLoading } = usePromptCompare(name, HOURS[range])

  const totalSamples = metrics?.reduce((s, m) => s + m.sampleCount, 0) ?? 0
  const maxSamples = Math.max(...(metrics?.map((m) => m.sampleCount) ?? [1]), 1)

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <span className="text-[12.5px] font-medium leading-[18px] text-text">Traffic by version</span>
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
          <p className="text-[12.5px]">No traffic data for this prompt in the last {range}.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Total calls" value={totalSamples.toLocaleString()} foot={`last ${range}`} />
            <StatCard
              label="Active versions"
              value={metrics.filter((m) => m.sampleCount > 0).length}
              foot={`of ${metrics.length} tracked`}
            />
            <StatCard
              label="Best error rate"
              value={(() => {
                const best = metrics.filter((m) => m.sampleCount > 0).sort((a, b) => a.errorRate - b.errorRate)[0]
                return best ? `${(best.errorRate * 100).toFixed(1)}%` : '—'
              })()}
              foot="lowest of any live version"
            />
          </div>

          <TableCard>
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <TableHead>
                  <div className="grid items-center gap-3" style={TRAFFIC_GRID}>
                    <Th>Version</Th>
                    <Th>Share</Th>
                    <Th>Traffic</Th>
                    <Th className="block text-right">Calls</Th>
                    <Th className="block text-right">Avg latency</Th>
                    <Th className="block text-right">Error rate</Th>
                    <Th className="block text-right">Avg cost</Th>
                  </div>
                </TableHead>
                {metrics.map((m) => {
                  const share = totalSamples > 0 ? m.sampleCount / totalSamples : 0
                  const barWidth = totalSamples > 0 ? (m.sampleCount / maxSamples) * 100 : 0
                  const clean = 1 - m.errorRate
                  const meterTone = clean >= 0.9 ? 'bg-good' : clean >= 0.7 ? 'bg-warn' : 'bg-bad'
                  return (
                    <div
                      key={m.promptVersionId}
                      className={cn(ROW, 'grid items-center gap-3')}
                      style={TRAFFIC_GRID}
                    >
                      <span className="font-mono text-[12px] text-text">v{m.version}</span>
                      <span>
                        <span
                          className={cn(
                            SHARE_CHIP,
                            m.sampleCount > 0
                              ? 'bg-accent-bg text-accent'
                              : 'bg-bg-chip text-text-muted',
                          )}
                        >
                          {(share * 100).toFixed(0)}%
                        </span>
                      </span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-track">
                        <span
                          className={cn('block h-full rounded-full transition-all', meterTone)}
                          style={{ width: `${barWidth}%` }}
                        />
                      </span>
                      <span className="text-right font-mono text-[12px] tabular-nums text-text-muted">
                        {m.sampleCount.toLocaleString()}
                      </span>
                      <span className="text-right font-mono text-[12px] tabular-nums text-text-muted">
                        {fmtMs(m.avgLatencyMs)}
                      </span>
                      <span className={cn(
                        'text-right font-mono text-[12px] tabular-nums',
                        m.errorRate === 0 ? 'text-good' : m.errorRate < 0.05 ? 'text-warn' : 'text-bad',
                      )}>
                        {(m.errorRate * 100).toFixed(1)}%
                      </span>
                      <span className="text-right font-mono text-[12px] tabular-nums text-text-muted">
                        {fmtUsd(m.avgCostUsd)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </TableCard>
        </>
      )}
    </div>
  )
}
