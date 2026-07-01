'use client'

import { useState } from 'react'
import { Bookmark, Plus, X, Check } from 'lucide-react'
import {
  useSavedFilters,
  useCreateSavedFilter,
  useDeleteSavedFilter,
  type SavedFilterParams,
} from '@/lib/queries/use-requests'
import { cn } from '@/lib/utils'

/**
 * Saved views bar for the requests page. Surfaces the pre-existing
 * `/api/v1/saved-filters` API (list / create / delete) that previously had
 * no UI: users can name the current filter combination and one-click back
 * into it later.
 *
 * `current` is the set of requests-page URL params that make up the view to
 * save (provider, status, model, timeRange, sortBy, …). `onApply` receives a
 * saved param map and is expected to replace the URL with exactly those.
 */
interface SavedViewsBarProps {
  current: SavedFilterParams
  onApply: (params: SavedFilterParams) => void
  /** Whether the current filter set has anything worth saving. */
  canSave: boolean
}

/** Stable equality on a param map, order-independent. */
function sameParams(a: SavedFilterParams, b: SavedFilterParams): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => a[k] === b[k])
}

export function SavedViewsBar({ current, onApply, canSave }: SavedViewsBarProps) {
  const { data: views } = useSavedFilters()
  const createView = useCreateSavedFilter()
  const deleteView = useDeleteSavedFilter()

  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const hasViews = (views?.length ?? 0) > 0
  // Nothing to show: no saved views and nothing to save from. Keep the row
  // out of the layout entirely so a fresh account isn't cluttered.
  if (!hasViews && !canSave) return null

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name')
      return
    }
    try {
      await createView.mutateAsync({ name: trimmed, filters: current })
      setName('')
      setNaming(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <div className="flex items-center gap-1.5 px-[22px] py-[7px] border-b border-border shrink-0 flex-wrap">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint inline-flex items-center gap-1 shrink-0">
        <Bookmark className="w-3 h-3" /> Views
      </span>

      {views?.map((v) => {
        const active = sameParams(v.filters, current)
        return (
          <span
            key={v.id}
            className={cn(
              'group inline-flex items-center gap-1 rounded-[5px] border font-mono text-[10.5px] transition-colors',
              active
                ? 'border-accent-border bg-accent-bg text-accent'
                : 'border-border bg-bg-elev text-text-muted hover:border-border-strong',
            )}
          >
            <button
              type="button"
              onClick={() => onApply(v.filters)}
              className="pl-[9px] py-[5px] pr-1"
              title={`Apply "${v.name}"`}
            >
              {v.name}
            </button>
            <button
              type="button"
              onClick={() => deleteView.mutate(v.id)}
              aria-label={`Delete view ${v.name}`}
              className="pr-[7px] py-[5px] text-text-faint hover:text-bad transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        )
      })}

      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={name}
            maxLength={80}
            placeholder="View name…"
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') {
                setNaming(false)
                setName('')
                setError(null)
              }
            }}
            className="font-mono text-[11px] border border-border-strong rounded-[5px] px-2 py-[5px] bg-bg text-text w-40 outline-none placeholder:text-text-faint"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={createView.isPending}
            aria-label="Save view"
            className="font-mono text-[10.5px] px-[8px] py-[5px] border border-border rounded-[5px] text-accent hover:border-border-strong disabled:opacity-40 transition-colors inline-flex items-center gap-1"
          >
            <Check className="w-3 h-3" /> Save
          </button>
          {error && <span className="font-mono text-[10.5px] text-bad">{error}</span>}
        </span>
      ) : (
        canSave && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="font-mono text-[10.5px] px-[9px] py-[5px] border border-dashed border-border rounded-[5px] text-text-faint hover:text-text hover:border-border-strong transition-colors inline-flex items-center gap-1 shrink-0"
          >
            <Plus className="w-3 h-3" /> Save view
          </button>
        )
      )}
    </div>
  )
}
