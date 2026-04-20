import { Suspense } from 'react'
import { Activity, DollarSign, Zap, TrendingUp } from 'lucide-react'
import { StatsCard } from '@/components/dashboard/stats-card'
import { RequestChart } from '@/components/dashboard/request-chart'
import { apiGetServer } from '@/lib/api-server'

export const metadata = { title: 'Dashboard' }

interface OverviewData {
  totalRequests: number
  successRequests: number
  errorRequests: number
  totalCostUsd: number
  totalTokens: number
  avgLatencyMs: number
}

interface TimeseriesPoint {
  date: string
  requests: number
  cost: number
  tokens: number
  errors: number
}

async function DashboardContent() {
  const [overviewRes, timeseriesRes] = await Promise.allSettled([
    apiGetServer<{ success: boolean; data: OverviewData }>('/api/v1/stats/overview'),
    apiGetServer<{ success: boolean; data: TimeseriesPoint[] }>('/api/v1/stats/timeseries'),
  ])

  const overview: OverviewData =
    overviewRes.status === 'fulfilled' && overviewRes.value.success
      ? overviewRes.value.data
      : { totalRequests: 0, successRequests: 0, errorRequests: 0, totalCostUsd: 0, totalTokens: 0, avgLatencyMs: 0 }

  const timeseries: TimeseriesPoint[] =
    timeseriesRes.status === 'fulfilled' && timeseriesRes.value.success
      ? timeseriesRes.value.data
      : []

  const errorRate =
    overview.totalRequests > 0
      ? ((overview.errorRequests / overview.totalRequests) * 100).toFixed(1)
      : '0.0'

  return (
    <>
      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard
          title="Total requests"
          value={overview.totalRequests.toLocaleString()}
          icon={Activity}
          subtitle={`${errorRate}% error rate`}
        />
        <StatsCard
          title="Total cost"
          value={`$${overview.totalCostUsd.toFixed(4)}`}
          icon={DollarSign}
        />
        <StatsCard
          title="Total tokens"
          value={overview.totalTokens.toLocaleString()}
          icon={TrendingUp}
        />
        <StatsCard
          title="Avg latency"
          value={`${overview.avgLatencyMs} ms`}
          icon={Zap}
        />
      </div>

      {/* Chart */}
      <div className="grid grid-cols-2 gap-4">
        <RequestChart data={timeseries} />
      </div>
    </>
  )
}

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Last 30 days overview</p>
      </div>
      <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}
