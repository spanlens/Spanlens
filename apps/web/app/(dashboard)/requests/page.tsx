'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Star, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  useCreateSavedFilter,
  useDeleteSavedFilter,
  useRequests,
  useSavedFilters,
  type RequestsFilters,
  type SavedFilter,
} from '@/lib/queries/use-requests'
import { DocsLink } from '@/components/layout/docs-link'

interface UiFilters {
  provider: string  // 'all' | 'openai' | ...
  status: string    // 'all' | 'success' | 'error'
  model: string
}

const DEFAULT_FILTERS: UiFilters = { provider: 'all', status: 'all', model: '' }

export default function RequestsPage() {
  const [filters, setFilters] = useState<UiFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)

  // Server-side pushdown filters (status filtered client-side; the API has
  // no status param yet)
  const serverFilters = useMemo(
    () => ({
      page,
      limit: 50,
      ...(filters.provider !== 'all' && { provider: filters.provider }),
      ...(filters.model.trim() && { model: filters.model.trim() }),
    }),
    [page, filters.provider, filters.model],
  )

  const { data, isLoading, isFetching, refetch } = useRequests(serverFilters)
  const savedFiltersQuery = useSavedFilters()
  const createSaved = useCreateSavedFilter()
  const deleteSaved = useDeleteSavedFilter()

  const requests = useMemo(() => {
    const rows = data?.data ?? []
    if (filters.status === 'error') return rows.filter((r) => r.status_code >= 400)
    if (filters.status === 'success') return rows.filter((r) => r.status_code < 400)
    return rows
  }, [data, filters.status])

  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  const isFilterActive =
    filters.provider !== 'all' || filters.status !== 'all' || filters.model.trim().length > 0

  function applySavedFilter(sf: SavedFilter): void {
    const f = sf.filters as Partial<UiFilters & RequestsFilters>
    setFilters({
      provider: typeof f.provider === 'string' ? f.provider : 'all',
      status: typeof f.status === 'string' ? f.status : 'all',
      model: typeof f.model === 'string' ? f.model : '',
    })
    setPage(1)
  }

  function clearFilters(): void {
    setFilters(DEFAULT_FILTERS)
    setPage(1)
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Requests</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {meta.total.toLocaleString()} total requests
          </p>
        </div>
        <DocsLink href="/docs/features/requests" />
      </div>

      {/* Saved filter chips */}
      {(savedFiltersQuery.data ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground mr-1">Saved:</span>
          {(savedFiltersQuery.data ?? []).map((sf) => (
            <span
              key={sf.id}
              className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs hover:border-blue-400"
            >
              <Star className="h-3 w-3 text-amber-500" />
              <button
                type="button"
                onClick={() => applySavedFilter(sf)}
                className="hover:text-blue-600"
              >
                {sf.name}
              </button>
              <button
                type="button"
                onClick={() => void deleteSaved.mutateAsync(sf.id)}
                className="text-gray-400 hover:text-red-500 ml-0.5"
                aria-label={`Delete saved filter ${sf.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select
          value={filters.provider}
          onValueChange={(v) => {
            setFilters((f) => ({ ...f, provider: v }))
            setPage(1)
          }}
        >
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

        <Select
          value={filters.status}
          onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}
        >
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
          value={filters.model}
          onChange={(e) => {
            setFilters((f) => ({ ...f, model: e.target.value }))
            setPage(1)
          }}
        />

        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          Refresh
        </Button>

        {isFilterActive && (
          <>
            <SaveFilterDialog
              filters={filters}
              onSave={(name) => createSaved.mutateAsync({ name, filters })}
            />
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Time</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Provider · Key</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Model</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tokens</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cost</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Latency</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-28" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-10" /></td>
                </tr>
              ))
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
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {req.provider}
                      </Badge>
                      {req.provider_key_name ? (
                        <span className="text-xs text-muted-foreground">
                          · {req.provider_key_name}
                        </span>
                      ) : null}
                    </div>
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
            disabled={page <= 1 || isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline" size="sm"
            disabled={requests.length < meta.limit || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Save filter dialog ─────────────────────────────────────────────────

interface SaveFilterDialogProps {
  filters: UiFilters
  onSave: (name: string) => Promise<unknown>
}

function SaveFilterDialog({ filters, onSave }: SaveFilterDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    if (!name.trim()) {
      setError('Name required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(name.trim())
      setName('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Star className="h-3.5 w-3.5" />
          Save filter
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save current filter</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="filter-name">Name</Label>
            <Input
              id="filter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. prod errors yesterday"
              maxLength={80}
            />
          </div>
          <div className="rounded border bg-gray-50 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground mb-1">Filters being saved:</div>
            <ul className="space-y-0.5">
              {filters.provider !== 'all' && <li>provider = {filters.provider}</li>}
              {filters.status !== 'all' && <li>status = {filters.status}</li>}
              {filters.model.trim() && <li>model contains &quot;{filters.model}&quot;</li>}
            </ul>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={() => void handleSave()} disabled={saving} className="w-full">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
