'use client'

import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
 * Laid out as the D24 board: a narrow list card on the left drives a wide
 * detail card on the right. The list stays read-flat (active first, archived
 * folded underneath) and every mutation still runs through the same dialog it
 * always did — the detail pane reads, the dialog writes. Keeping the write
 * path in one place is what lets the pane stay a pure projection of the row.
 *
 * The dialog morphs based on the selected type: the fields shown for NUMERIC
 * (min/max) differ from CATEGORICAL (chip editor), and BOOLEAN gets a label
 * pair.
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

// Header for the bounds row in the detail pane. Each type constrains scores
// differently, so the label changes with it.
const BOUNDS_LABELS: Record<ScoreConfigType, string> = {
  NUMERIC: 'Range',
  CATEGORICAL: 'Categories',
  BOOLEAN: 'Labels',
  TEXT: 'Input',
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

// The list sub-line reads "<type> <bounds>". TEXT has no bounds worth
// repeating, so it collapses to the type alone.
function listSubline(config: ScoreConfig): string {
  const type = TYPE_LABELS[config.data_type].toLowerCase()
  return config.data_type === 'TEXT' ? type : `${type} ${summariseConfig(config)}`
}

// Values worth showing as chips: only what the config actually pins down.
// NUMERIC gets its two bounds rather than invented intermediate steps, since
// every value inside the range is valid.
function chipValues(config: ScoreConfig): string[] {
  switch (config.data_type) {
    case 'NUMERIC':
      return [String(config.min_value ?? 0), String(config.max_value ?? 1)]
    case 'CATEGORICAL':
      return config.categories ?? []
    case 'BOOLEAN':
      return [config.bool_true_label ?? 'Yes', config.bool_false_label ?? 'No']
    case 'TEXT':
      return []
  }
}

export function ScoreConfigsClient() {
  const query = useAllScoreConfigs()
  const archive = useArchiveScoreConfig()
  const update = useUpdateScoreConfig()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ScoreConfig | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { all, active, archived } = useMemo(() => {
    const rows = query.data ?? []
    return {
      all: rows,
      active: rows.filter((c) => !c.archived_at),
      archived: rows.filter((c) => c.archived_at),
    }
  }, [query.data])

  // The detail pane follows the left-hand selection, falling back to the first
  // active config so the pane is never blank on first paint.
  const selected =
    all.find((c) => c.id === selectedId) ?? active[0] ?? archived[0] ?? null

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Score configs' },
          ]}
          right={
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg hover:bg-accent-strong"
            >
              <Plus className="h-3.5 w-3.5" />
              New config
            </button>
          }
        />
      </div>

      <div className="pt-4 md:pt-5 space-y-4">
        <p className="max-w-[640px] text-[12.5px] leading-[1.55] text-text-muted">
          Define how evaluators and reviewers score responses in this
          workspace. Each config has a type — numeric, categorical, boolean,
          or free text — and the annotation queue picks the right input
          widget automatically.
        </p>

        {query.isLoading ? (
          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <div className="h-[260px] rounded-card bg-bg-chip animate-pulse" />
            <div className="h-[260px] rounded-card bg-bg-chip animate-pulse" />
          </div>
        ) : all.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="grid items-start gap-3 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Score configs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {active.map((config) => (
                  <ConfigListItem
                    key={config.id}
                    config={config}
                    selected={selected?.id === config.id}
                    onSelect={() => setSelectedId(config.id)}
                  />
                ))}

                {archived.length > 0 && (
                  <>
                    <div className="micro-label pt-3 pb-1">
                      Archived ({archived.length})
                    </div>
                    {archived.map((config) => (
                      <ConfigListItem
                        key={config.id}
                        config={config}
                        archived
                        selected={selected?.id === config.id}
                        onSelect={() => setSelectedId(config.id)}
                      />
                    ))}
                  </>
                )}
              </CardContent>
            </Card>

            {selected && (
              <ConfigDetail
                config={selected}
                onEdit={() => setEditing(selected)}
                onArchive={() => {
                  if (selected.is_default) {
                    window.alert(
                      'Cannot archive the default config. Promote another config to default first.',
                    )
                    return
                  }
                  if (window.confirm(`Archive "${selected.name}"? Existing scores using this config stay queryable but the picker will hide it.`)) {
                    archive.mutate(selected.id)
                  }
                }}
                onPromote={() => {
                  update.mutate({ id: selected.id, is_default: true })
                }}
                onRestore={() => update.mutate({ id: selected.id, archived: false })}
              />
            )}
          </div>
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
    <div className="rounded-card border border-border bg-bg-elev p-10 text-center shadow-card">
      <p className="mb-1 text-[13px] text-text">No active configs.</p>
      <p className="mb-4 font-mono text-[11.5px] text-text-faint">
        At minimum your workspace has a default numeric config. If even that is missing the
        backfill migration didn&apos;t run — check the deploy logs.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg hover:bg-accent-strong"
      >
        <Plus className="h-3.5 w-3.5" />
        Create config
      </button>
    </div>
  )
}

interface ConfigListItemProps {
  config: ScoreConfig
  selected: boolean
  archived?: boolean
  onSelect: () => void
}

function ConfigListItem({ config, selected, archived, onSelect }: ConfigListItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'block w-full rounded-md px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-bg-muted' : 'hover:bg-bg-muted',
        archived && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[12.5px] font-medium text-text">{config.name}</span>
        {config.is_default && (
          <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.06em] text-accent">
            Default
          </span>
        )}
      </div>
      <div className="truncate font-mono text-[11.5px] text-text-faint">
        {listSubline(config)}
      </div>
    </button>
  )
}

interface ConfigDetailProps {
  config: ScoreConfig
  onEdit: () => void
  onArchive: () => void
  onPromote: () => void
  onRestore: () => void
}

function ConfigDetail({ config, onEdit, onArchive, onPromote, onRestore }: ConfigDetailProps) {
  const isArchived = Boolean(config.archived_at)
  const chips = chipValues(config)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">{config.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          <DetailRow label="Type" value={TYPE_LABELS[config.data_type].toLowerCase()} />
          <DetailRow
            label={BOUNDS_LABELS[config.data_type]}
            value={summariseConfig(config)}
          />
          {config.description && (
            <DetailRow label="Description" value={config.description} />
          )}
          <DetailRow label="Default" value={config.is_default ? 'yes' : 'no'} />
          <DetailRow label="Status" value={isArchived ? 'archived' : 'active'} />
        </div>

        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {chips.map((value) => (
              <span
                key={value}
                className="inline-flex items-center rounded-full border border-border bg-bg-elev px-3 py-1.5 font-mono text-[11.5px] text-text-muted"
              >
                {value}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isArchived ? (
            <button
              type="button"
              onClick={onRestore}
              className="rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg hover:opacity-90"
            >
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg hover:opacity-90"
              >
                Edit
              </button>
              {!config.is_default && (
                <button
                  type="button"
                  onClick={onPromote}
                  className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
                >
                  Promote
                </button>
              )}
              <button
                type="button"
                onClick={onArchive}
                className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
              >
                Archive
              </button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border py-2.5 first:pt-0 last:border-b-0">
      <span className="shrink-0 text-[12.5px] font-medium text-text">{label}</span>
      <span className="truncate text-right font-mono text-[12px] text-text-muted">{value}</span>
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
        <label className="micro-label mb-1.5 block">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Brand voice"
          maxLength={100}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="micro-label mb-1.5 block">
          Description (optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short label shown in the picker"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="micro-label mb-1.5 block">
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
                'rounded-md border p-2.5 text-left transition-colors',
                dataType === t
                  ? 'border-accent-border bg-accent-bg text-text'
                  : 'border-border bg-bg text-text-muted hover:border-border-strong',
                mode === 'edit' && 'cursor-not-allowed opacity-60',
              )}
            >
              <div className="text-[12.5px] font-medium">
                {TYPE_LABELS[t]}
              </div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-text-muted">
                {TYPE_DESCRIPTIONS[t]}
              </div>
            </button>
          ))}
        </div>
      </div>

      {dataType === 'NUMERIC' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="micro-label mb-1.5 block">
              Min value
            </label>
            <input
              type="number"
              step="0.01"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="micro-label mb-1.5 block">
              Max value
            </label>
            <input
              type="number"
              step="0.01"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {dataType === 'CATEGORICAL' && (
        <div>
          <label className="micro-label mb-1.5 block">
            Categories (comma-separated, at least 2)
          </label>
          <input
            type="text"
            value={categoriesText}
            onChange={(e) => setCategoriesText(e.target.value)}
            placeholder="Helpful, Neutral, Unhelpful"
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
          />
        </div>
      )}

      {dataType === 'BOOLEAN' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="micro-label mb-1.5 block">
              True label
            </label>
            <input
              type="text"
              value={boolTrueLabel}
              onChange={(e) => setBoolTrueLabel(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="micro-label mb-1.5 block">
              False label
            </label>
            <input
              type="text"
              value={boolFalseLabel}
              onChange={(e) => setBoolFalseLabel(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {!config?.is_default && (
        <label className="flex items-center gap-2 text-[11.5px] text-text-muted">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Make this the default for new evaluators
        </label>
      )}

      {error && (
        <div className="rounded-md border border-accent-border bg-bad-bg px-3 py-2 text-[11.5px] text-bad">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending || update.isPending}
          className="rounded-full bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg hover:bg-accent-strong disabled:opacity-50"
        >
          {mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  )
}
