'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiGet } from '@/lib/api'

interface Request {
  id: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
  latency_ms: number
  status_code: number
  error_message: string | null
  created_at: string
}

interface RequestsResponse {
  success: boolean
  data: Request[]
  meta: { total: number; page: number; limit: number }
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<Request[]>([])
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 50 })
  const [loading, setLoading] = useState(true)

  const [filterProvider, setFilterProvider] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterModel, setFilterModel] = useState('')
  const [page, setPage] = useState(1)

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '50' })
    if (filterProvider !== 'all') params.set('provider', filterProvider)
    if (filterModel.trim()) params.set('model', filterModel.trim())
    try {
      const res = await apiGet<RequestsResponse>(`/api/v1/requests?${params}`)
      let data = res.data
      if (filterStatus === 'error') data = data.filter((r) => r.status_code >= 400)
      if (filterStatus === 'success') data = data.filter((r) => r.status_code < 400)
      setRequests(data)
      setMeta(res.meta)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [page, filterProvider, filterStatus, filterModel])

  useEffect(() => { void fetchRequests() }, [fetchRequests])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Requests</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {meta.total.toLocaleString()} total requests
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <Select value={filterProvider} onValueChange={setFilterProvider}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="gemini">Gemini</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="w-48"
          placeholder="Filter by model…"
          value={filterModel}
          onChange={(e) => setFilterModel(e.target.value)}
        />

        <Button variant="outline" size="sm" onClick={() => void fetchRequests()}>
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Provider</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Model</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tokens</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cost</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Latency</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  No requests yet. Make your first API call through the proxy.
                </td>
              </tr>
            ) : (
              requests.map((req) => (
                <tr key={req.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <Link href={`/requests/${req.id}`} className="hover:text-foreground">
                      {new Date(req.created_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {req.provider}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{req.model}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {req.total_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {req.cost_usd != null ? `$${req.cost_usd.toFixed(6)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{req.latency_ms}ms</td>
                  <td className="px-4 py-3">
                    <Badge variant={req.status_code < 400 ? 'success' : 'destructive'}>
                      {req.status_code}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground">
          Showing {requests.length} of {meta.total}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline" size="sm"
            disabled={requests.length < meta.limit}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
