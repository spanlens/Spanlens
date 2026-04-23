'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, RotateCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useRequest, useReplayRequest } from '@/lib/queries/use-requests'

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

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold font-mono">{req.id.slice(0, 8)}…</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(req.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ReplayButton requestId={req.id} originalModel={req.model} />
          <Badge variant={isSuccess ? 'success' : 'destructive'} className="text-sm">
            {req.status_code}
          </Badge>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Provider',
            value: req.provider_key_name
              ? `${req.provider} · ${req.provider_key_name}`
              : req.provider,
          },
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

// ── Replay button + dialog ─────────────────────────────────────────────

interface ReplayButtonProps {
  requestId: string
  originalModel: string
}

/**
 * Opens a dialog with curl + JSON body for the replay. We don't execute the
 * upstream call from the dashboard — that would skip the org's API-key auth
 * path. Instead we surface a copy-paste-ready snippet so the user runs it
 * with their own credentials, going through /proxy/* like a normal SDK call.
 *
 * The model field is editable so the user can A/B against alternatives
 * (e.g. swap gpt-4o → gpt-4o-mini and compare cost/latency in /requests).
 */
function ReplayButton({ requestId, originalModel }: ReplayButtonProps) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState(originalModel)
  const [copied, setCopied] = useState(false)
  const replay = useReplayRequest()
  const result = replay.data

  async function handlePrepare(): Promise<void> {
    const trimmed = model.trim()
    await replay.mutateAsync(trimmed ? { id: requestId, model: trimmed } : { id: requestId })
  }

  function reset(): void {
    setModel(originalModel)
    setCopied(false)
    replay.reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <RotateCw className="h-3.5 w-3.5" />
          Replay
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Replay request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="replay-model">Model (override)</Label>
            <Input
              id="replay-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={originalModel}
            />
            <p className="text-xs text-muted-foreground">
              Leave the same as the original ({originalModel}) or swap to compare a different
              model side-by-side.
            </p>
          </div>

          {!result ? (
            <Button onClick={() => void handlePrepare()} disabled={replay.isPending} className="w-full">
              {replay.isPending ? 'Preparing…' : 'Prepare replay snippet'}
            </Button>
          ) : (
            <>
              <div className="rounded border bg-gray-950 text-gray-100 p-3 text-xs font-mono overflow-auto max-h-[280px]">
                <pre>{`curl -X POST 'https://www.spanlens.io${result.proxyPath}' \\
  -H 'Authorization: Bearer <YOUR_SPANLENS_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(result.replayBody)}'`}</pre>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    const cmd = `curl -X POST 'https://www.spanlens.io${result.proxyPath}' \\\n  -H 'Authorization: Bearer <YOUR_SPANLENS_API_KEY>' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(result.replayBody)}'`
                    void navigator.clipboard.writeText(cmd)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy curl'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Run from your terminal — it counts toward your quota and shows up in /requests.
                </p>
              </div>
            </>
          )}

          {replay.isError && (
            <p className="text-sm text-destructive">
              {replay.error instanceof Error ? replay.error.message : 'Failed to prepare replay'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
