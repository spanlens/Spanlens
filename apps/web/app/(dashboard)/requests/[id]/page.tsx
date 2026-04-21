'use client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useRequest } from '@/lib/queries/use-requests'

export default function RequestDetailPage({ params }: { params: { id: string } }) {
  const { data: req, isLoading, isError, refetch } = useRequest(params.id)

  if (isLoading) {
    return (
      <div>
        <Link
          href="/requests"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to requests
        </Link>
        <div className="flex items-start justify-between mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-1 pt-4">
                <Skeleton className="h-3 w-20" />
              </CardHeader>
              <CardContent className="pb-4">
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (isError || !req) {
    return (
      <div>
        <Link
          href="/requests"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to requests
        </Link>
        <div className="rounded-lg border bg-white p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Request not found</h2>
          <p className="text-sm text-muted-foreground mb-4">
            This request may have been deleted, or you may not have access to it.
          </p>
          <button
            onClick={() => void refetch()}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const isSuccess = req.status_code < 400

  return (
    <div>
      <Link
        href="/requests"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to requests
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono">{req.id.slice(0, 8)}…</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(req.created_at).toLocaleString()}
          </p>
        </div>
        <Badge variant={isSuccess ? 'success' : 'destructive'} className="text-sm">
          {req.status_code}
        </Badge>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Provider', value: req.provider },
          { label: 'Model', value: req.model },
          { label: 'Latency', value: `${req.latency_ms} ms` },
          { label: 'Cost', value: req.cost_usd != null ? `$${req.cost_usd.toFixed(6)}` : '—' },
          { label: 'Prompt tokens', value: req.prompt_tokens.toLocaleString() },
          { label: 'Completion tokens', value: req.completion_tokens.toLocaleString() },
          { label: 'Total tokens', value: req.total_tokens.toLocaleString() },
          { label: 'Trace ID', value: req.trace_id ?? '—' },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-sm font-mono font-semibold truncate">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Request / Response bodies */}
      <Tabs defaultValue="request">
        <TabsList>
          <TabsTrigger value="request">Request body</TabsTrigger>
          <TabsTrigger value="response">Response body</TabsTrigger>
          {req.error_message && <TabsTrigger value="error">Error</TabsTrigger>}
        </TabsList>
        <TabsContent value="request">
          <div className="rounded-lg border bg-gray-950 p-4 mt-2 overflow-auto max-h-[480px]">
            <pre className="text-sm font-mono text-gray-200">
              {req.request_body ? JSON.stringify(req.request_body, null, 2) : '(no body)'}
            </pre>
          </div>
        </TabsContent>
        <TabsContent value="response">
          <div className="rounded-lg border bg-gray-950 p-4 mt-2 overflow-auto max-h-[480px]">
            <pre className="text-sm font-mono text-gray-200">
              {req.response_body ? JSON.stringify(req.response_body, null, 2) : '(not stored)'}
            </pre>
          </div>
        </TabsContent>
        {req.error_message && (
          <TabsContent value="error">
            <div className="rounded-lg border border-destructive bg-red-50 p-4 mt-2">
              <pre className="text-sm font-mono text-red-800">{req.error_message}</pre>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
