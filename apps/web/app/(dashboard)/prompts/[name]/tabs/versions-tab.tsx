'use client'
import { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { useDeletePromptVersion, useRollbackPromptVersion, type PromptVersion } from '@/lib/queries/use-prompts'
import { PermissionGate } from '@/components/permission-gate'
import { cn, formatDate } from '@/lib/utils'
import { TableCard, TableHead, Th, ROW, Well } from '../../../_board/surfaces'

// D4 puts the live version's marker on the accent tint. That is a routing
// state, not a health status, so it carries its own chip classes.
const ACCENT_CHIP =
  'inline-flex items-center whitespace-nowrap rounded-full bg-accent-bg px-2 py-[3px] text-[11px] font-semibold leading-[15px] text-accent'

interface Props {
  name: string
  versions: PromptVersion[] | undefined
  isLoading: boolean
}

// D4's versions table leads with the version handle, gives the body preview the
// slack, and parks the timestamp on the right. The metric columns in the frame
// (model, requests, avg cost, score) live on the Traffic and Calls tabs, which
// are the queries that carry those numbers.
const VERSION_GRID: React.CSSProperties = {
  gridTemplateColumns: '120px minmax(0,1fr) 110px 16px',
}

export function VersionsTab({ name, versions, isLoading }: Props) {
  const deleteMutation = useDeletePromptVersion()
  const rollbackMutation = useRollbackPromptVersion()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState<string | null>(null)

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleDelete(version: number) {
    if (!confirm(`Delete v${version} of "${name}"? This cannot be undone.`)) return
    setDeleting(String(version))
    try {
      await deleteMutation.mutateAsync({ name, version })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(null)
    }
  }

  async function handleRollback(version: number) {
    const latestVersion = versions?.[0]?.version ?? version
    if (version === latestVersion) return
    if (!confirm(`Roll back to v${version}? A new version will be created with the same content.`)) return
    setRollingBack(String(version))
    try {
      await rollbackMutation.mutateAsync({ name, version })
    } finally {
      setRollingBack(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-card bg-bg-chip" />)}
      </div>
    )
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="card-surface rounded-card flex h-56 flex-col items-center justify-center gap-2 text-text-muted">
        <p className="text-[12.5px]">No versions found for this prompt.</p>
      </div>
    )
  }

  const latestVersion = versions[0]?.version

  return (
    <TableCard>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <TableHead>
            <div className="grid items-center gap-3" style={VERSION_GRID}>
              <Th>Version</Th>
              <Th>Body</Th>
              <Th>Updated</Th>
              {/* The chevron's column needs a real grid cell, so the label
                  hides inside it — `sr-only` on the cell itself is absolutely
                  positioned and would collapse the column. */}
              <Th><span className="sr-only">Expand</span></Th>
            </div>
          </TableHead>

          {versions.map((v) => {
            const isOpen = expanded.has(v.id)
            return (
              <div key={v.id} className="border-b border-border last:border-b-0">
                {/* Row header. The outer element is a div rather than a button
                    because the expanded panel holds its own buttons and HTML
                    forbids nesting them; keyboard activation is preserved. */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggle(v.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggle(v.id)
                    }
                  }}
                  className={cn(
                    ROW,
                    'grid cursor-pointer items-center gap-3 border-b-0 text-left transition-colors hover:bg-bg-muted focus:bg-bg-muted focus:outline-none',
                  )}
                  style={VERSION_GRID}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-text">
                      {name}@v{v.version}
                    </span>
                    {v.version === latestVersion && <span className={ACCENT_CHIP}>live</span>}
                  </span>
                  <span className="truncate font-mono text-[12px] text-text-muted">
                    {v.content.slice(0, 160).replace(/\n/g, ' ')}
                    {v.content.length > 160 ? '…' : ''}
                  </span>
                  <span className="font-mono text-[12px] text-text-muted">
                    {formatDate(v.created_at)}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                  )}
                </div>

                {/* Expanded content — the same shape as D4's prompt-body card:
                    a sunk well for the body, accent chips for the variables. */}
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t border-border bg-bg-muted px-[18px] py-3.5">
                    <Well>
                      <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.65] text-text-muted">
                        {v.content}
                      </pre>
                    </Well>

                    {v.variables && v.variables.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {v.variables.map((vr) => (
                          <span
                            key={vr.name}
                            className="inline-flex items-center gap-1 rounded-full bg-accent-bg px-[9px] py-1 font-mono text-[11px] leading-[1.45] text-accent"
                          >
                            {vr.name}
                            {vr.required && <span className="text-[9px]">*</span>}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-4 font-mono text-[11px] text-text-faint">
                        <span>ID <span className="text-text-muted">{v.id.slice(0, 8)}…</span></span>
                        {v.created_by && (
                          <span>By <span className="text-text-muted">{v.created_by.slice(0, 8)}…</span></span>
                        )}
                      </div>
                      <PermissionGate need="edit">
                        <div className="flex items-center gap-2">
                          {v.version !== latestVersion && (
                            <button
                              type="button"
                              onClick={() => void handleRollback(v.version)}
                              disabled={rollingBack === String(v.version)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:bg-bg-elev hover:text-text disabled:opacity-40"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {rollingBack === String(v.version) ? 'Rolling back…' : 'Roll back'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDelete(v.version)}
                            disabled={deleting === String(v.version)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] font-medium text-bad transition-colors hover:bg-bad-bg disabled:opacity-40"
                          >
                            <Trash2 className="h-3 w-3" />
                            {deleting === String(v.version) ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </PermissionGate>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </TableCard>
  )
}
