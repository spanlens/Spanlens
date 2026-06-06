'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, Star, MessageSquare, ToggleRight, Type, Archive, RotateCcw } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  useAllScoreConfigs,
  useCreateScoreConfig,
  useUpdateScoreConfig,
  useArchiveScoreConfig,
  type ScoreConfig,
  type ScoreConfigType,
  type CreateScoreConfigInput,
} from '@/lib/queries/use-score-configs'

/**
 * Score configs management UI.
 *
 * The page is intentionally read-flat: list all configs (active + archived)
 * with type-coloured chips and inline actions. Creating a new config opens
 * a single dialog that morphs based on the selected type — the form fields
 * shown for NUMERIC (min/max) are different from CATEGORICAL (chip
 * editor), and BOOLEAN gets a label pair. We keep the dialog over a
 * separate "edit" page so admins can spin up new configs without leaving
 * the list view.
 *
 * The legacy 0..1 NUMERIC config seeded by the 4B.1 migration is marked
 * `is_default` and can't be archived from the UI — promoting a different
 * config to default unlocks it.
 */

const TYPE_LABELS: Record<ScoreConfigType, string> = {
  NUMERIC: 'Numeric',
  CATEGORICAL: 'Categorical',
  BOOLEAN: 'Boolean',
  TEXT: 'Free text',
}

const TYPE_DESCRIPTIONS: Record<ScoreConfigType, string> = {
  NUMERIC: 'Slider or stars on a fixed range. Aggregates as average.',
  CATEGORICAL: 'Pick one from a fixed list. Aggregates as a distribution.',
  BOOLEAN: 'Pass / fail toggle. Aggregates as pass rate.',
  TEXT: 'Free-form label or note. No aggregation; surfaced as samples.',
}

const TYPE_ICONS: Record<ScoreConfigType, React.ReactElement> = {
  NUMERIC: <Star className="h-3.5 w-3.5" />,
  CATEGORICAL: <MessageSquare className="h-3.5 w-3.5" />,
  BOOLEAN: <ToggleRight className="h-3.5 w-3.5" />,
  TEXT: <Type className="h-3.5 w-3.5" />,
}

// Pretty-print the type-specific bounds for the list row. Keep the text
// short — full details live in the edit dialog.
function summariseConfig(config: ScoreConfig): string {
  switch (config.data_type) {
    case 'NUMERIC':
      return `${config.min_value ?? 0} – ${config.max_value ?? 1}`
    case 'CATEGORICAL':
      return (config.categories ?? []).join(' / ')
    case 'BOOLEAN':
      return `${config.bool_true_label ?? 'Yes'} / ${config.bool_false_label ?? 'No'}`
    case 'TEXT':
      return 'Free text'
  }
}

export function ScoreConfigsClient() {
  const query = useAllScoreConfigs()
  const archive = useArchiveScoreConfig()
  const update = useUpdateScoreConfig()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ScoreConfig | null>(null)

  const { active, archived } = useMemo(() => {
    const all = query.data ?? []
    return {
      active: all.filter((c) => !c.archived_at),
      archived: all.filter((c) => c.archived_at),
    }
  }, [query.data])

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Score configs' },
        ]}
      />
      <div className="px-6 py-8 max-w-[1100px] mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Link
              href="/settings"
              className="font-mono text-[11px] text-text-faint hover:text-text-muted"
            >
              ← Settings
            </Link>
            <h1 className="mt-2 text-2xl font-semibold">Score configs</h1>
            <p className="mt-1 text-[13px] text-text-muted max-w-[600px]">
              Define how evaluators and reviewers score responses in this
              workspace. Each config has a type — numeric, categorical,
              boolean, or free text — and the annotation queue picks the
              right input widget automatically.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-fg hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New config
          </button>
        </div>

        {query.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-[6px] bg-bg-elev animate-pulse" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="space-y-2">
            {active.map((config) => (
              <ConfigRow
                key={config.id}
                config={config}
                onEdit={() => setEditing(config)}
                onArchive={() => {
                  if (config.is_default) {
                    window.alert(
                      'Cannot archive the default config. Promote another config to default first.',
                    )
                    return
                  }
                  if (window.confirm(`Archive "${config.name}"? Existing scores using this config stay queryable but the picker will hide it.`)) {
                    archive.mutate(config.id)
                  }
                }}
                onPromote={() => {
                  update.mutate({ id: config.id, is_default: true })
                }}
              />
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <details className="mt-8">
            <summary className="font-mono text-[11.5px] text-text-faint hover:text-text-muted cursor-pointer">
              Archived ({archived.length})
            </summary>
            <div className="mt-3 space-y-2">
              {archived.map((config) => (
                <ConfigRow
                  key={config.id}
                  config={config}
                  archived
                  onRestore={() => update.mutate({ id: config.id, archived: false })}
                />
              ))}
            </div>
          </details>
        )}
      </div>

      <CreateConfigDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editing && (
        <EditConfigDialog
          config={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[6px] border border-border bg-bg p-10 text-center">
      <p className="text-[13px] text-text mb-1">No active configs.</p>
      <p className="font-mono text-[11.5px] text-text-faint mb-4">
        At minimum your workspace has a default numeric config. If even that is missing the
        backfill migration didn&apos;t run — check the deploy logs.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-fg hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" />
        Create config
      </button>
    </div>
  )
}

interface ConfigRowProps {
  config: ScoreConfig
  archived?: boolean
  onEdit?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onPromote?: () => void
}

function ConfigRow({ config, archived, onEdit, onArchive, onRestore, onPromote }: ConfigRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[6px] border border-border bg-bg p-3 transition-colors',
        archived && 'opacity-60',
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.04em]',
          'border-border bg-bg-elev text-text-muted',
        )}
      >
        {TYPE_ICONS[config.data_type]}
        {TYPE_LABELS[config.data_type]}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text">{config.name}</span>
          {config.is_default && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-accent">
              Default
            </span>
          )}
        </div>
        <div className="font-mono text-[11px] text-text-faint truncate">
          {summariseConfig(config)}
        </div>
        {config.description && (
          <p className="mt-0.5 text-[11.5px] text-text-muted truncate">{config.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {archived ? (
          <button
            type="button"
            onClick={onRestore}
            className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px] text-text-muted hover:bg-bg-elev hover:text-text"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restore
          </button>
        ) : (
          <>
            {!config.is_default && onPromote && (
              <button
                type="button"
                onClick={onPromote}
                className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px] text-text-muted hover:bg-bg-elev hover:text-text"
              >
                Promote
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px] text-text-muted hover:bg-bg-elev hover:text-text"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onArchive}
              className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px] text-text-muted hover:bg-bg-elev hover:text-bad"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Create dialog ────────────────────────────────────────────────────────────

function CreateConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New score config</DialogTitle>
        </DialogHeader>
        <ConfigForm
          mode="create"
          onDone={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditConfigDialog({ config, onClose }: { config: ScoreConfig; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit &ldquo;{config.name}&rdquo;</DialogTitle>
        </DialogHeader>
        <ConfigForm
          mode="edit"
          config={config}
          onDone={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}

interface ConfigFormProps {
  mode: 'create' | 'edit'
  config?: ScoreConfig
  onDone: () => void
}

function ConfigForm({ mode, config, onDone }: ConfigFormProps) {
  const create = useCreateScoreConfig()
  const update = useUpdateScoreConfig()
  const [name, setName] = useState(config?.name ?? '')
  const [description, setDescription] = useState(config?.description ?? '')
  const [dataType, setDataType] = useState<ScoreConfigType>(config?.data_type ?? 'NUMERIC')
  const [minValue, setMinValue] = useState(String(config?.min_value ?? 0))
  const [maxValue, setMaxValue] = useState(String(config?.max_value ?? 1))
  const [categoriesText, setCategoriesText] = useState((config?.categories ?? []).join(', '))
  const [boolTrueLabel, setBoolTrueLabel] = useState(config?.bool_true_label ?? 'Pass')
  const [boolFalseLabel, setBoolFalseLabel] = useState(config?.bool_false_label ?? 'Fail')
  const [isDefault, setIsDefault] = useState(config?.is_default ?? false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      setError('Name is required')
      return
    }

    try {
      if (mode === 'create') {
        const input: CreateScoreConfigInput = {
          name: trimmedName,
          description: description.trim() || null,
          data_type: dataType,
        }
        if (dataType === 'NUMERIC') {
          input.min_value = Number(minValue)
          input.max_value = Number(maxValue)
        }
        if (dataType === 'CATEGORICAL') {
          input.categories = categoriesText
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        }
        if (dataType === 'BOOLEAN') {
          input.bool_true_label = boolTrueLabel.trim() || null
          input.bool_false_label = boolFalseLabel.trim() || null
        }
        if (isDefault) input.is_default = true
        await create.mutateAsync(input)
      } else if (config) {
        const updates: Parameters<typeof update.mutateAsync>[0] = { id: config.id }
        if (trimmedName !== config.name) updates.name = trimmedName
        const trimmedDesc = description.trim() || null
        if (trimmedDesc !== config.description) updates.description = trimmedDesc
        if (dataType === 'NUMERIC') {
          updates.min_value = Number(minValue)
          updates.max_value = Number(maxValue)
        }
        if (dataType === 'CATEGORICAL') {
          updates.categories = categoriesText
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        }
        if (dataType === 'BOOLEAN') {
          updates.bool_true_label = boolTrueLabel.trim() || null
          updates.bool_false_label = boolFalseLabel.trim() || null
        }
        if (isDefault && !config.is_default) updates.is_default = true
        await update.mutateAsync(updates)
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div>
        <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Brand voice"
          maxLength={100}
          className="w-full rounded-[5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
          Description (optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short label shown in the picker"
          className="w-full rounded-[5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
          Type {mode === 'edit' && <span className="normal-case text-text-faint">(immutable)</span>}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(['NUMERIC', 'CATEGORICAL', 'BOOLEAN', 'TEXT'] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={mode === 'edit'}
              onClick={() => setDataType(t)}
              className={cn(
                'text-left rounded-[5px] border p-2.5 transition-colors',
                dataType === t
                  ? 'border-accent bg-accent-bg/40 text-text'
                  : 'border-border bg-bg text-text-muted hover:border-border-strong',
                mode === 'edit' && 'cursor-not-allowed opacity-60',
              )}
            >
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                {TYPE_ICONS[t]}
                {TYPE_LABELS[t]}
              </div>
              <div className="mt-0.5 text-[10.5px] text-text-muted leading-snug">
                {TYPE_DESCRIPTIONS[t]}
              </div>
            </button>
          ))}
        </div>
      </div>

      {dataType === 'NUMERIC' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
              Min value
            </label>
            <input
              type="number"
              step="0.01"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              className="w-full rounded-[5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
              Max value
            </label>
            <input
              type="number"
              step="0.01"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              className="w-full rounded-[5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {dataType === 'CATEGORICAL' && (
        <div>
          <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
            Categories (comma-separated, at least 2)
          </label>
          <input
            type="text"
            value={categoriesText}
            onChange={(e) => setCategoriesText(e.target.value)}
            placeholder="Helpful, Neutral, Unhelpful"
            className="w-full rounded-[5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </div>
      )}

      {dataType === 'BOOLEAN' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
              True label
            </label>
            <input
              type="text"
              value={boolTrueLabel}
              onChange={(e) => setBoolTrueLabel(e.target.value)}
              className="w-full rounded-[5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint mb-1.5">
              False label
            </label>
            <input
              type="text"
              value={boolFalseLabel}
              onChange={(e) => setBoolFalseLabel(e.target.value)}
              className="w-full rounded-[5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {!config?.is_default && (
        <label className="flex items-center gap-2 font-mono text-[11.5px] text-text-muted">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Make this the default for new evaluators
        </label>
      )}

      {error && (
        <div className="rounded-[5px] border border-bad/30 bg-bad/10 px-2.5 py-1.5 text-[11.5px] text-bad">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-[5px] border border-border bg-bg px-3 py-1.5 text-[12.5px] text-text-muted hover:bg-bg-elev"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending || update.isPending}
          className="rounded-[5px] bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  )
}
