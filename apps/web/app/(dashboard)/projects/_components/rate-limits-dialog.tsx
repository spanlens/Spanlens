'use client'

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GhostBtn, PrimaryBtn } from '@/components/ui/primitives'
import { PermissionGate } from '@/components/permission-gate'
import {
  useRateLimits,
  useCreateRateLimit,
  useUpdateRateLimit,
  useDeleteRateLimit,
} from '@/lib/queries/use-rate-limits'
import type { CustomerRateLimit } from '@/lib/queries/types'

const WINDOWS = [
  { value: 60, label: 'per minute' },
  { value: 3600, label: 'per hour' },
  { value: 86400, label: 'per day' },
] as const

function windowLabel(seconds: number): string {
  return WINDOWS.find((w) => w.value === seconds)?.label ?? `per ${seconds}s`
}

const inputCls =
  'w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors'

interface Props {
  apiKeyId: string | null
  apiKeyName: string
  open: boolean
  onClose: () => void
}

/**
 * Per-Spanlens-key rate-limit manager (Phase 2). Lets an admin/editor set a
 * key-level cap and per-end-user caps (keyed on the x-spanlens-user header).
 * All reads/writes go through /api/v1/rate-limits — no direct Supabase access.
 */
export function RateLimitsDialog({ apiKeyId, apiKeyName, open, onClose }: Props) {
  const { data: limits, isLoading } = useRateLimits(open ? apiKeyId : null)
  const createMut = useCreateRateLimit()
  const updateMut = useUpdateRateLimit()
  const deleteMut = useDeleteRateLimit()

  const keyLimit = useMemo(
    () => limits?.find((l) => l.target_type === 'api_key') ?? null,
    [limits],
  )
  const endUserLimits = useMemo(
    () => (limits ?? []).filter((l) => l.target_type === 'end_user'),
    [limits],
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rate limits</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-[12.5px] text-text-muted mt-1">
          Throttle traffic through <span className="font-mono">{apiKeyName}</span>. A request over
          a configured limit gets a 429. Per-end-user limits bucket on the{' '}
          <code>x-spanlens-user</code> header.
        </DialogDescription>

        {isLoading ? (
          <p className="text-[12.5px] text-text-faint mt-4">Loading…</p>
        ) : (
          <div className="mt-3 space-y-6">
            {/* ── Key-level limit ───────────────────────────────────────── */}
            <section className="space-y-2">
              <h3 className="text-[12.5px] font-medium text-text">Key limit</h3>
              {keyLimit ? (
                <LimitRow
                  limit={keyLimit}
                  label={`${keyLimit.max_requests} requests ${windowLabel(keyLimit.window_seconds)}`}
                  onToggle={(active) => updateMut.mutate({ id: keyLimit.id, is_active: active })}
                  onDelete={() => deleteMut.mutate(keyLimit.id)}
                  busy={updateMut.isPending || deleteMut.isPending}
                />
              ) : (
                <PermissionGate need="edit">
                  <AddLimitForm
                    busy={createMut.isPending}
                    onSubmit={(max, win) =>
                      createMut.mutate({
                        target_type: 'api_key',
                        api_key_id: apiKeyId as string,
                        max_requests: max,
                        window_seconds: win,
                      })
                    }
                  />
                </PermissionGate>
              )}
            </section>

            {/* ── Per-end-user limits ───────────────────────────────────── */}
            <section className="space-y-2">
              <h3 className="text-[12.5px] font-medium text-text">Per end-user limits</h3>
              {endUserLimits.length === 0 && (
                <p className="text-[11.5px] text-text-faint">
                  None yet. Add a cap for a specific end-user identifier.
                </p>
              )}
              {endUserLimits.map((l) => (
                <LimitRow
                  key={l.id}
                  limit={l}
                  label={`${l.end_user_id}: ${l.max_requests} ${windowLabel(l.window_seconds)}`}
                  onToggle={(active) => updateMut.mutate({ id: l.id, is_active: active })}
                  onDelete={() => deleteMut.mutate(l.id)}
                  busy={updateMut.isPending || deleteMut.isPending}
                />
              ))}
              <PermissionGate need="edit">
                <AddEndUserForm
                  busy={createMut.isPending}
                  onSubmit={(endUser, max, win) =>
                    createMut.mutate({
                      target_type: 'end_user',
                      api_key_id: apiKeyId as string,
                      end_user_id: endUser,
                      max_requests: max,
                      window_seconds: win,
                    })
                  }
                />
              </PermissionGate>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LimitRow({
  limit,
  label,
  onToggle,
  onDelete,
  busy,
}: {
  limit: CustomerRateLimit
  label: string
  onToggle: (active: boolean) => void
  onDelete: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[6px] border border-border bg-bg-elev px-3 py-2">
      <span className={`text-[12.5px] ${limit.is_active ? 'text-text' : 'text-text-faint line-through'}`}>
        {label}
      </span>
      <PermissionGate need="edit">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggle(!limit.is_active)}
            className="font-mono text-[11px] text-text-faint hover:text-text transition-colors disabled:opacity-50"
          >
            {limit.is_active ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="font-mono text-[11px] text-bad/70 hover:text-bad transition-colors disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </PermissionGate>
    </div>
  )
}

function WindowSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-[130px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WINDOWS.map((w) => (
          <SelectItem key={w.value} value={String(w.value)}>{w.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AddLimitForm({ busy, onSubmit }: { busy: boolean; onSubmit: (max: number, win: number) => void }) {
  const [max, setMax] = useState('')
  const [win, setWin] = useState(60)
  const valid = Number.isInteger(Number(max)) && Number(max) > 0
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(Number(max), win) }}
    >
      <input
        value={max}
        onChange={(e) => setMax(e.target.value)}
        inputMode="numeric"
        placeholder="max requests"
        className={inputCls}
      />
      <WindowSelect value={win} onChange={setWin} />
      <PrimaryBtn type="submit" disabled={!valid || busy}>{busy ? '…' : 'Add'}</PrimaryBtn>
    </form>
  )
}

function AddEndUserForm({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (endUser: string, max: number, win: number) => void
}) {
  const [endUser, setEndUser] = useState('')
  const [max, setMax] = useState('')
  const [win, setWin] = useState(60)
  const valid = endUser.trim().length > 0 && Number.isInteger(Number(max)) && Number(max) > 0
  return (
    <form
      className="flex items-center gap-2 flex-wrap"
      onSubmit={(e) => { e.preventDefault(); if (valid) { onSubmit(endUser.trim(), Number(max), win); setEndUser(''); setMax('') } }}
    >
      <input
        value={endUser}
        onChange={(e) => setEndUser(e.target.value)}
        placeholder="end-user id"
        className={`${inputCls} flex-1 min-w-[120px] font-mono`}
      />
      <input
        value={max}
        onChange={(e) => setMax(e.target.value)}
        inputMode="numeric"
        placeholder="max"
        className={`${inputCls} w-[90px]`}
      />
      <WindowSelect value={win} onChange={setWin} />
      <PrimaryBtn type="submit" disabled={!valid || busy}>{busy ? '…' : 'Add'}</PrimaryBtn>
    </form>
  )
}
