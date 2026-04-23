'use client'

import { useState } from 'react'
import { Plus, Search, Info, X } from 'lucide-react'
import {
  usePrompts,
  usePromptCompare,
  useCreatePromptVersion,
} from '@/lib/queries/use-prompts'
import { Topbar } from '@/components/layout/topbar'
import { MicroLabel, PrimaryBtn, GhostBtn } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 px-6 py-4 border-r border-border last:border-r-0">
      <MicroLabel>{label}</MicroLabel>
      <span className="text-[22px] font-semibold text-text leading-none">{value}</span>
      {sub && <span className="text-[11px] text-text-muted font-mono">{sub}</span>}
    </div>
  )
}

type FilterType = 'all' | 'ab'

export default function PromptsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const { data: prompts, isLoading } = usePrompts()
  const compareQuery = usePromptCompare(selected, 24 * 30)
  const createMutation = useCreatePromptVersion()

  const all = prompts ?? []
  const totalVersions = all.reduce((s, p) => s + p.version, 0)

  const filtered = all.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
  )

  async function handleCreate() {
    setFormError(null)
    if (!form.name.trim() || !form.content.trim()) {
      setFormError('Name and content are required.')
      return
    }
    try {
      await createMutation.mutateAsync({ name: form.name.trim(), content: form.content })
      setForm({ name: '', content: '' })
      setFormOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      {/* Topbar */}
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Prompts' }]}
        right={
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prompts…"
                className="h-[30px] pl-8 pr-3 rounded border border-border bg-bg-elev text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong w-[180px]"
              />
            </div>
            <PrimaryBtn
              onClick={() => setFormOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px]"
            >
              <Plus className="h-3.5 w-3.5" />
              Register prompt
            </PrimaryBtn>
          </div>
        }
      />

      {/* Info banner */}
      <div className="flex items-center gap-2 px-6 py-2 bg-accent-bg border-b border-accent-border text-[12px] text-accent shrink-0">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>
          Prompts are sourced from code — use{' '}
          <code className="font-mono bg-accent/10 px-1 rounded text-[11px]">
            X-Spanlens-Prompt-Version: name@version
          </code>{' '}
          header or{' '}
          <code className="font-mono bg-accent/10 px-1 rounded text-[11px]">withPromptVersion()</code>{' '}
          SDK helper to link requests.
        </span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        <KpiTile label="Prompts" value={String(all.length)} />
        <KpiTile label="Total versions" value={String(totalVersions)} />
        <KpiTile label="A/B running" value="—" sub="needs ≥2 active versions" />
        <KpiTile label="Avg cost" value="—" sub="no traffic data yet" />
        <KpiTile label="Spend 24h" value="—" sub="no traffic data yet" />
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0">
        {(['all', 'ab'] as FilterType[]).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1 rounded text-[12.5px] transition-colors',
              filter === f
                ? 'bg-bg-elev text-text font-medium border border-border-strong'
                : 'text-text-muted hover:text-text',
            )}
          >
            {f === 'all' ? 'All' : 'A/B Running'}
          </button>
        ))}
      </div>

      {/* Create form panel */}
      {formOpen && (
        <div className="px-6 py-4 bg-bg-elev border-b border-border-strong shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-text">Register prompt / version</span>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="text-text-faint hover:text-text transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] text-text-muted font-medium">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="chatbot-system"
              className="w-full h-8 px-3 rounded border border-border bg-bg text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong max-w-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] text-text-muted font-medium">Content</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="You are a helpful assistant…"
              rows={4}
              className="w-full px-3 py-2 rounded border border-border bg-bg text-[12.5px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-none"
            />
          </div>
          {formError && <p className="text-[12px] text-bad">{formError}</p>}
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] text-text-faint">
              Existing name → new version. New name → starts at v1.
            </p>
            <div className="flex items-center gap-2">
              <GhostBtn
                onClick={() => setFormOpen(false)}
                className="text-[12.5px] px-3 py-[5px]"
              >
                Cancel
              </GhostBtn>
              <PrimaryBtn
                onClick={() => void handleCreate()}
                disabled={createMutation.isPending}
                className="text-[12.5px] px-3 py-[5px]"
              >
                {createMutation.isPending ? 'Saving…' : 'Save version'}
              </PrimaryBtn>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <p className="text-[13px]">
              {search ? 'No prompts match your search.' : 'No prompts registered yet.'}
            </p>
            {!search && (
              <PrimaryBtn
                onClick={() => setFormOpen(true)}
                className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px]"
              >
                <Plus className="h-3.5 w-3.5" />
                Register first prompt
              </PrimaryBtn>
            )}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-bg-elev sticky top-0 z-10">
                <th className="px-6 py-2.5 text-left w-[300px]">
                  <MicroLabel>Name</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Active ver</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Versions</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Calls 24h</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Avg cost</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Avg lat</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Updated</MicroLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelected(selected === p.name ? null : p.name)}
                  className={cn(
                    'border-b border-border cursor-pointer hover:bg-bg-elev transition-colors',
                    selected === p.name && 'bg-bg-elev',
                  )}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-good shrink-0" />
                      <span className="font-medium text-text">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-muted">v{p.version}</td>
                  <td className="px-4 py-3 text-right text-text-muted">{p.version}</td>
                  <td className="px-4 py-3 text-right font-mono text-text-faint">—</td>
                  <td className="px-4 py-3 text-right font-mono text-text-faint">—</td>
                  <td className="px-4 py-3 text-right font-mono text-text-faint">—</td>
                  <td className="px-4 py-3 text-right font-mono text-text-faint text-[11px]">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* A/B compare drawer */}
      {selected !== null && (
        <div className="border-t border-border-strong bg-bg-elev shrink-0 max-h-[280px] overflow-auto">
          <div className="flex items-center justify-between px-6 py-3 border-b border-border sticky top-0 bg-bg-elev z-10">
            <span className="text-[13px] font-medium text-text">
              Version comparison —{' '}
              <span className="font-mono text-text-muted">{selected}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-text-faint hover:text-text transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {compareQuery.isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-8 bg-bg rounded animate-pulse" />
              ))}
            </div>
          ) : (compareQuery.data ?? []).length === 0 ? (
            <div className="px-6 py-8 text-center text-[12.5px] text-text-muted">
              No request data for this prompt in the last 30 days.{' '}
              Tag calls with{' '}
              <code className="font-mono bg-bg px-1 rounded text-[11px]">
                withPromptVersion(&apos;{selected}@latest&apos;)
              </code>
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-bg">
                  <th className="px-6 py-2 text-left">
                    <MicroLabel>Version</MicroLabel>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <MicroLabel>Samples</MicroLabel>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <MicroLabel>Avg lat</MicroLabel>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <MicroLabel>Error %</MicroLabel>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <MicroLabel>Avg cost</MicroLabel>
                  </th>
                  <th className="px-4 py-2 text-right">
                    <MicroLabel>Total cost</MicroLabel>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(compareQuery.data ?? []).map((m) => (
                  <tr key={m.promptVersionId} className="border-b border-border last:border-0">
                    <td className="px-6 py-2 font-mono text-text-muted">v{m.version}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{m.sampleCount}</td>
                    <td className="px-4 py-2 text-right font-mono text-text-muted">
                      {fmtMs(m.avgLatencyMs)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text-muted">
                      {(m.errorRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text-muted">
                      {fmtUsd(m.avgCostUsd)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text-muted">
                      {fmtUsd(m.totalCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
