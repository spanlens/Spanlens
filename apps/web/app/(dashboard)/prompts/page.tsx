'use client'

import { useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import {
  usePrompts,
  usePromptCompare,
  useCreatePromptVersion,
} from '@/lib/queries/use-prompts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

function formatUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function formatMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

export default function PromptsPage() {
  const { data: prompts, isLoading } = usePrompts()
  const [selected, setSelected] = useState<string | null>(null)
  const compareQuery = usePromptCompare(selected, 24 * 30)
  const createMutation = useCreatePromptVersion()
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    if (!form.name.trim() || !form.content.trim()) {
      setError('Name and content are required.')
      return
    }
    try {
      await createMutation.mutateAsync({ name: form.name.trim(), content: form.content })
      setForm({ name: '', content: '' })
      setFormOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold">Prompts</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Version-controlled prompt templates with A/B performance data.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setFormOpen((v) => !v)}>
          <Plus className="h-4 w-4 mr-1" />
          New prompt / version
        </Button>
      </div>

      {formOpen && (
        <div className="mb-6 rounded-lg border bg-white p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="chatbot-system"
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Content</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="You are a helpful assistant..."
              rows={6}
              className="w-full rounded border px-3 py-2 text-sm font-mono"
            />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Saving…' : 'Save version'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Existing name? → creates a new version. New name? → starts at v1.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: prompt list */}
        <div className="md:col-span-1">
          <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            Prompts
          </h2>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (prompts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prompts yet. Create one to start.
            </p>
          ) : (
            <ul className="space-y-1">
              {(prompts ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelected(p.name)}
                    className={`w-full text-left rounded px-3 py-2 text-sm border transition-colors ${
                      selected === p.name ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Latest: v{p.version}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: A/B comparison */}
        <div className="md:col-span-2">
          <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            {selected ? `A/B comparison — ${selected}` : 'Select a prompt to compare versions'}
          </h2>
          {!selected ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Pick a prompt on the left.
            </div>
          ) : compareQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (compareQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No request data for this prompt in the last 30 days.
            </p>
          ) : (
            <div className="rounded-lg border bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Version</th>
                    <th className="px-4 py-2 text-right">Samples</th>
                    <th className="px-4 py-2 text-right">Avg latency</th>
                    <th className="px-4 py-2 text-right">Error %</th>
                    <th className="px-4 py-2 text-right">Avg cost</th>
                    <th className="px-4 py-2 text-right">Total cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(compareQuery.data ?? []).map((m) => (
                    <tr key={m.promptVersionId} className="border-t">
                      <td className="px-4 py-2">
                        <Badge variant="outline">v{m.version}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">{m.sampleCount}</td>
                      <td className="px-4 py-2 text-right">{formatMs(m.avgLatencyMs)}</td>
                      <td className="px-4 py-2 text-right">
                        {(m.errorRate * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-right">{formatUsd(m.avgCostUsd)}</td>
                      <td className="px-4 py-2 text-right">{formatUsd(m.totalCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
