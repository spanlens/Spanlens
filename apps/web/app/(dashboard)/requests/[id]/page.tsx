import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiGetServer } from '@/lib/api-server'

interface RequestDetail {
  id: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
  latency_ms: number
  status_code: number
  request_body: unknown
  response_body: unknown
  error_message: string | null
  trace_id: string | null
  span_id: string | null
  created_at: string
}

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  let req: RequestDetail
  try {
    const res = await apiGetServer<{ success: boolean; data: RequestDetail }>(
      `/api/v1/requests/${params.id}`,
    )
    if (!res.success) notFound()
    req = res.data
  } catch {
    notFound()
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
