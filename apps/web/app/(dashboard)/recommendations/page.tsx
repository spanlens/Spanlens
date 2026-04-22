'use client'

import { Sparkles, TrendingDown } from 'lucide-react'
import { useRecommendations } from '@/lib/queries/use-recommendations'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { DocsLink } from '@/components/layout/docs-link'

function formatUsd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(5)}`
}

export default function RecommendationsPage() {
  const { data, isLoading, error } = useRecommendations({ hours: 24 * 7, minSavings: 5 })
  const recommendations = data ?? []

  const totalSavings = recommendations.reduce(
    (s, r) => s + r.estimatedMonthlySavingsUsd,
    0,
  )

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-purple-500 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Cost Savings</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Model substitutions based on 7 days of usage patterns.
            </p>
          </div>
        </div>
        <DocsLink href="/docs/features/savings" />
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && (
        <div className="rounded-lg border border-destructive bg-red-50 p-4 text-sm text-red-800">
          Failed to load recommendations.
        </div>
      )}

      {!isLoading && !error && recommendations.length === 0 && (
        <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">
          No cost-saving recommendations right now. Either you&apos;re already on the
          cheapest models for your workload, or we need more traffic data (min 50
          requests per model).
        </div>
      )}

      {recommendations.length > 0 && (
        <>
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 mb-6 flex items-center gap-3">
            <TrendingDown className="h-5 w-5 text-purple-600" />
            <div>
              <div className="font-semibold text-purple-900">
                Estimated monthly savings: {formatUsd(totalSavings)}
              </div>
              <div className="text-xs text-purple-700 mt-0.5">
                Based on last 7 days extrapolated to 30 days.
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {recommendations.map((r, i) => (
              <div
                key={`${r.currentProvider}-${r.currentModel}-${i}`}
                className="rounded-lg border bg-white p-4"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline">Currently</Badge>
                      <span className="font-mono text-sm">
                        {r.currentProvider} / {r.currentModel}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className="bg-green-600">Suggested</Badge>
                      <span className="font-mono text-sm text-green-700">
                        {r.suggestedProvider} / {r.suggestedModel}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-600">
                      {formatUsd(r.estimatedMonthlySavingsUsd)}
                    </div>
                    <div className="text-xs text-muted-foreground">saved / month</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{r.reason}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Samples: {r.sampleCount}</span>
                  <span>Avg prompt: {Math.round(r.avgPromptTokens)} tokens</span>
                  <span>Avg completion: {Math.round(r.avgCompletionTokens)} tokens</span>
                  <span>7-day cost: {formatUsd(r.totalCostUsdLastNDays)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
