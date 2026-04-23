'use client'

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { useSecurityFlagged, useSecuritySummary } from '@/lib/queries/use-security'
import { Skeleton } from '@/components/ui/skeleton'
import { Topbar } from '@/components/layout/topbar'
import { MicroLabel } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

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
    <div className="-m-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Security' }]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-7 py-6 max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <ShieldAlert className="h-5 w-5 text-accent shrink-0" />
            <div>
              <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px] mb-0.5">
                Security
              </h1>
              <p className="text-[13px] text-text-muted">
                PII and prompt-injection patterns detected in request bodies.
              </p>
            </div>
          </div>

          {/* Summary — last 24h */}
          <div className="mb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
              Last 24 hours — by pattern
            </div>
            {summary.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (summary.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-good/30 bg-good-bg px-4 py-3 text-[13px] text-good">
                No suspicious patterns detected in the last 24h.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {(summary.data ?? []).map((s) => (
                  <div
                    key={`${s.type}-${s.pattern}`}
                    className={cn(
                      'rounded-lg border p-3',
                      s.type === 'injection'
                        ? 'border-accent-border bg-accent-bg'
                        : 'border-border bg-bg-elev',
                    )}
                  >
                    <div className="mb-1.5">
                      <span
                        className={cn(
                          'font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border',
                          s.type === 'injection'
                            ? 'border-accent-border bg-accent-bg text-accent'
                            : 'border-border bg-bg text-text-muted',
                        )}
                      >
                        {s.type}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-text-muted truncate mb-1">
                      {s.pattern}
                    </div>
                    <div className="font-mono text-[22px] font-medium tracking-[-0.4px] text-text">
                      {s.count}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent flagged requests */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
              Recent flagged requests
            </div>
            {flagged.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (flagged.data ?? []).length === 0 ? (
              <p className="text-[13px] text-text-faint">No flagged requests.</p>
            ) : (
              <div className="rounded-xl border border-border bg-bg-elev overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-bg sticky top-0 z-10">
                      <th className="px-5 py-2.5 text-left">
                        <MicroLabel>When</MicroLabel>
                      </th>
                      <th className="px-4 py-2.5 text-left">
                        <MicroLabel>Model</MicroLabel>
                      </th>
                      <th className="px-4 py-2.5 text-left">
                        <MicroLabel>Flags</MicroLabel>
                      </th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {(flagged.data ?? []).map((r) => (
                      <tr key={r.id} className="border-b border-border hover:bg-bg transition-colors">
                        <td className="px-5 py-3 font-mono text-[11.5px] text-text-muted whitespace-nowrap">
                          {formatRelative(r.created_at)}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-text whitespace-nowrap">
                          {r.provider} / {r.model}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {r.flags.map((f, i) => (
                              <span
                                key={i}
                                className={cn(
                                  'font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border',
                                  f.type === 'injection'
                                    ? 'border-accent-border bg-accent-bg text-accent'
                                    : 'border-border bg-bg text-text-muted',
                                )}
                              >
                                {f.pattern}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/requests/${r.id}`}
                            className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
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
          </div>
        </div>
      </div>
    </div>
  )
}
