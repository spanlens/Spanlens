'use client'

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { useSecurityFlagged, useSecuritySummary } from '@/lib/queries/use-security'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { DocsLink } from '@/components/layout/docs-link'

function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function SecurityPage() {
  const summary = useSecuritySummary(24)
  const flagged = useSecurityFlagged({ limit: 50 })

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-red-500 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Security</h1>
            <p className="text-muted-foreground text-sm mt-1">
              PII and prompt-injection patterns detected in request bodies.
            </p>
          </div>
        </div>
        <DocsLink href="/docs/features/security" />
      </div>

      {/* Summary */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
          Last 24 hours — by pattern
        </h2>
        {summary.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (summary.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            🎉 No suspicious patterns detected in the last 24h.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {(summary.data ?? []).map((s) => (
              <div
                key={`${s.type}-${s.pattern}`}
                className="rounded-lg border bg-white p-3 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant={s.type === 'injection' ? 'destructive' : 'secondary'}
                  >
                    {s.type}
                  </Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground truncate">
                  {s.pattern}
                </div>
                <div className="text-2xl font-bold mt-1">{s.count}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent flagged requests */}
      <section>
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
          Recent flagged requests
        </h2>
        {flagged.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (flagged.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No flagged requests.</p>
        ) : (
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">When</th>
                  <th className="px-4 py-2 text-left">Model</th>
                  <th className="px-4 py-2 text-left">Flags</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {(flagged.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {formatRelative(r.created_at)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.provider} / {r.model}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.flags.map((f, i) => (
                          <Badge
                            key={i}
                            variant={f.type === 'injection' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {f.pattern}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/requests/${r.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
