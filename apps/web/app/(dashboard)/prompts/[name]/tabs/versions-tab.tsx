'use client'
import { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { useDeletePromptVersion, type PromptVersion } from '@/lib/queries/use-prompts'
import { PermissionGate } from '@/components/permission-gate'

interface Props {
  name: string
  versions: PromptVersion[] | undefined
  isLoading: boolean
}

export function VersionsTab({ name, versions, isLoading }: Props) {
  const deleteMutation = useDeletePromptVersion()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)

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
    } finally {
      setDeleting(null)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
      </div>
    )
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-muted">
        <p className="text-[13px]">No versions found for this prompt.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {versions.map((v) => {
        const isOpen = expanded.has(v.id)
        return (
          <div key={v.id} className="bg-bg hover:bg-bg-elev transition-colors">
            {/* Row header */}
            <button
              type="button"
              onClick={() => toggle(v.id)}
              className="w-full flex items-center gap-3 px-[22px] py-[13px] text-left"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-[6px] py-[2px] rounded-[3px] bg-bg-muted border border-border text-text-muted min-w-[36px] text-center">
                v{v.version}
              </span>
              <span className="flex-1 min-w-0 font-mono text-[12.5px] text-text-muted truncate">
                {v.content.slice(0, 120).replace(/\n/g, ' ')}
                {v.content.length > 120 ? '…' : ''}
              </span>
              <span className="font-mono text-[11px] text-text-faint shrink-0">
                {new Date(v.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {isOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-text-faint shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-text-faint shrink-0" />
              )}
            </button>

            {/* Expanded content */}
            {isOpen && (
              <div className="px-[22px] pb-[16px] space-y-4">
                {/* Content block */}
                <div className="bg-bg-muted rounded-[6px] border border-border p-4">
                  <pre className="font-mono text-[12px] text-text-muted whitespace-pre-wrap leading-relaxed">
                    {v.content}
                  </pre>
                </div>

                {/* Variables */}
                {v.variables && v.variables.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Variables</p>
                    <div className="flex flex-wrap gap-2">
                      {v.variables.map((vr) => (
                        <span
                          key={vr.name}
                          className="inline-flex items-center gap-1 font-mono text-[11px] px-[8px] py-[3px] rounded-[4px] bg-bg border border-border text-text-muted"
                        >
                          <span className="text-accent">{`{{`}</span>
                          {vr.name}
                          <span className="text-accent">{`}}`}</span>
                          {vr.required && <span className="text-bad text-[9px]">*</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Meta row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 font-mono text-[11px] text-text-faint">
                    <span>ID: <span className="text-text-muted">{v.id.slice(0, 8)}…</span></span>
                    {v.created_by && (
                      <span>By: <span className="text-text-muted">{v.created_by.slice(0, 8)}…</span></span>
                    )}
                  </div>
                  <PermissionGate need="edit">
                    <button
                      type="button"
                      onClick={() => void handleDelete(v.version)}
                      disabled={deleting === String(v.version)}
                      className="flex items-center gap-1.5 font-mono text-[11px] px-[8px] py-[4px] rounded-[4px] border border-border text-bad hover:bg-bad/10 transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" />
                      {deleting === String(v.version) ? 'Deleting…' : 'Delete'}
                    </button>
                  </PermissionGate>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
