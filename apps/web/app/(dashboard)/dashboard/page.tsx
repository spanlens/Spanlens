'use client'
import { Activity, DollarSign, Zap, TrendingUp } from 'lucide-react'
import { StatsCard } from '@/components/dashboard/stats-card'
import { RequestChart } from '@/components/dashboard/request-chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useStatsOverview, useStatsTimeseries } from '@/lib/queries/use-stats'

export default function DashboardPage() {
  const overview = useStatsOverview()
  const timeseries = useStatsTimeseries()

  const isError = overview.isError || timeseries.isError
  const isLoading = overview.isLoading || timeseries.isLoading

  const o = overview.data
  const errorRate =
    o && o.totalRequests > 0
      ? ((o.errorRequests / o.totalRequests) * 100).toFixed(1)
      : '0.0'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Last 30 days overview</p>
      </div>

      {isError && (
        <div className="rounded-lg border border-destructive bg-red-50 p-4 mb-4 flex items-center justify-between">
          <p className="text-sm text-red-800">Failed to load dashboard data.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void overview.refetch()
              void timeseries.refetch()
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {isLoading || !o ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-white p-4">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))
        ) : (
          <>
            <StatsCard
              title="Total requests"
              value={o.totalRequests.toLocaleString()}
              icon={Activity}
              subtitle={`${errorRate}% error rate`}
            />
            <StatsCard
              title="Total cost"
              value={`$${o.totalCostUsd.toFixed(4)}`}
              icon={DollarSign}
            />
            <StatsCard
              title="Total tokens"
              value={o.totalTokens.toLocaleString()}
              icon={TrendingUp}
            />
            <StatsCard
              title="Avg latency"
              value={`${o.avgLatencyMs} ms`}
              icon={Zap}
            />
          </>
        )}
      </div>

      {/* Chart */}
      <div className="grid grid-cols-2 gap-4">
        {isLoading || !timeseries.data ? (
          <div className="rounded-lg border bg-white p-4">
            <Skeleton className="h-4 w-40 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <RequestChart data={timeseries.data} />
        )}
      </div>
    </div>
  )
}
