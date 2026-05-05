'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/layout/topbar'
import { Skeleton } from '@/components/ui/skeleton'
import { TracePanel } from '@/components/traces/trace-panel'
import { useTrace } from '@/lib/queries/use-traces'

export default function TraceDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [navIds, setNavIds] = useState<string[]>([])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('traceNavList')
      const parsed = raw ? (JSON.parse(raw) as { ids: string[] }) : null
      setNavIds(parsed?.ids ?? [])
    } catch { /* ignore */ }
  }, [])

  const navIdx = navIds.indexOf(params.id)
  const prevId = navIdx > 0 ? navIds[navIdx - 1] : null
  const nextId = navIdx < navIds.length - 1 ? navIds[navIdx + 1] : null

  const { data: trace, isLoading, isError } = useTrace(params.id)

  const traceName = trace?.name ?? '…'
  const crumbLabel = traceName.length > 28 ? traceName.slice(0, 28) + '…' : traceName

  if (isLoading) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
        <Topbar crumbs={[{ label: 'Workspace' }, { label: 'Traces', href: '/traces' }, { label: '…' }]} />
        <div className="p-[22px] space-y-4">
          <Skeleton className="h-6 w-64" />
          <div className="grid grid-cols-5 gap-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    )
  }

  if (isError || (!isLoading && !trace)) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
        <Topbar crumbs={[{ label: 'Workspace' }, { label: 'Traces', href: '/traces' }, { label: 'Not found' }]} />
        <div className="m-[22px] p-8 rounded-md border border-border text-center">
          <p className="text-[13px] text-text-muted mb-3">Trace not found or no longer available.</p>
          <button
            type="button"
            onClick={() => router.push('/traces')}
            className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
          >
            ← Back to traces
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[
          { label: 'Workspace' },
          { label: 'Traces', href: '/traces' },
          { label: crumbLabel },
        ]}
        right={
          prevId || nextId ? (
            <div className="flex items-center gap-2">
              {prevId && (
                <button
                  type="button"
                  onClick={() => router.push(`/traces/${prevId}`)}
                  className="font-mono text-[11px] px-[9px] py-1 border border-border rounded-[5px] text-text-muted hover:border-border-strong transition-colors"
                >
                  ← prev
                </button>
              )}
              {nextId && (
                <button
                  type="button"
                  onClick={() => router.push(`/traces/${nextId}`)}
                  className="font-mono text-[11px] px-[9px] py-1 border border-border rounded-[5px] text-text-muted hover:border-border-strong transition-colors"
                >
                  next →
                </button>
              )}
            </div>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-hidden">
        <TracePanel traceId={params.id} />
      </div>
    </div>
  )
}
