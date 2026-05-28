'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bell, Mail, MessageSquare, Plus, Search, Trash2 } from 'lucide-react'
import {
  useAlerts,
  useCreateAlert,
  useDeleteAlert,
  useUpdateAlert,
  useNotificationChannels,
  useCreateChannel,
  useDeleteChannel,
  useAlertDeliveries,
} from '@/lib/queries/use-alerts'
import type { AlertType, ChannelKind, AlertRow } from '@/lib/queries/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { cn, formatDateTime } from '@/lib/utils'

function fmtThreshold(type: AlertType, threshold: number): string {
  if (type === 'budget') return `$${threshold}`
  if (type === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
  return `${threshold}ms`
}

function kindLabel(type: AlertType): string {
  if (type === 'budget') return 'BUDGET'
  if (type === 'error_rate') return 'ERROR RATE'
  return 'P95 LATENCY'
}

function isRecentlyFired(lastTriggeredAt: string | null): boolean {
  if (!lastTriggeredAt) return false
  return Date.now() - new Date(lastTriggeredAt).getTime() < 60 * 60 * 1000
}

function sevColor(a: AlertRow): 'accent' | 'good' | 'faint' {
  if (a.is_active && isRecentlyFired(a.last_triggered_at)) return 'accent'
  if (a.is_active) return 'good'
  return 'faint'
}

function AlertRuleRow({
  a,
  fires,
  onToggle,
  onEdit,
  onDelete,
  isPending,
  last,
}: {
  a: AlertRow
  fires: number
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  isPending: boolean
  last: boolean
}) {
  const color = sevColor(a)
  const isFiring = color === 'accent'
  return (
    <div
      className={cn(
        'grid items-center px-[16px] sm:px-[22px] py-[12px] gap-3',
        'grid-cols-[20px_minmax(0,1fr)_56px_72px] sm:grid-cols-[28px_minmax(0,1fr)_160px_60px_200px] sm:gap-[14px]',
        !last && 'border-b border-border',
        isFiring && 'bg-accent-bg',
      )}
    >
      <div className="flex items-center justify-center">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            color === 'accent' ? 'bg-accent animate-pulse' : color === 'good' ? 'bg-good' : 'bg-text-faint',
          )}
        />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Link
            href={`/alerts/${a.id}`}
            className="text-[13.5px] text-text font-medium truncate hover:text-accent transition-colors"
          >
            {a.name}
          </Link>
          <span
            className={cn(
              'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em] shrink-0',
              isFiring ? 'text-accent border-accent-border bg-accent-bg' : 'text-text-muted border-border',
            )}
          >
            {kindLabel(a.type)}
          </span>
        </div>
        <div className="font-mono text-[11px] text-text-muted">
          <span className="text-text-faint">trigger </span>
          {a.type === 'budget' ? 'sum(cost)' : a.type === 'error_rate' ? 'error_rate' : 'p95(latency)'}{' '}
          &gt; {fmtThreshold(a.type, a.threshold)}
          <span className="text-text-faint"> for </span>{a.window_minutes}m
          {a.last_triggered_at && (
            <span className="text-text-faint ml-2">· last fired {formatDateTime(a.last_triggered_at)}</span>
          )}
        </div>
      </div>

      {/* WINDOW · COOLDOWN — hidden on mobile, the row body already mentions window. */}
      <div className="hidden sm:block">
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">WINDOW · COOLDOWN</div>
        <div className="font-mono text-[12px] text-text-muted">
          {a.window_minutes}m · {a.cooldown_minutes}m
        </div>
      </div>

      <div className="text-right">
        <div className="font-mono text-[13px] text-text tabular-nums">{fires}</div>
        <div className="font-mono text-[10px] text-text-faint">fires</div>
      </div>

      <PermissionGate need="edit">
        <div className="flex items-center justify-end gap-1.5">
          {/* Action buttons: full label on sm+, icon-only on mobile. */}
          <button
            type="button"
            onClick={onEdit}
            disabled={isPending}
            title="Edit"
            aria-label="Edit"
            className="font-mono text-[10.5px] text-text-muted px-1.5 sm:px-2 py-[3px] border border-border rounded-[4px] hover:text-text transition-colors disabled:opacity-40"
          >
            <span className="sm:hidden">✎</span>
            <span className="hidden sm:inline">Edit</span>
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={isPending}
            title={a.is_active ? 'Pause' : 'Resume'}
            aria-label={a.is_active ? 'Pause' : 'Resume'}
            className="font-mono text-[10.5px] text-text-muted px-1.5 sm:px-2 py-[3px] border border-border rounded-[4px] hover:text-text transition-colors disabled:opacity-40"
          >
            <span className="sm:hidden">{a.is_active ? '⏸' : '▶'}</span>
            <span className="hidden sm:inline">{a.is_active ? 'Pause' : 'Resume'}</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending}
            title="Delete"
            aria-label="Delete"
            className="p-1.5 text-text-faint hover:text-bad transition-colors disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </PermissionGate>
    </div>
  )
}

type StatusFilter = 'all' | 'firing' | 'active' | 'paused'

export function AlertsClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const alertsQuery = useAlerts()
  const channelsQuery = useNotificationChannels()
  const deliveriesQuery = useAlertDeliveries()
  const createAlert = useCreateAlert()
  const deleteAlert = useDeleteAlert()
  const updateAlert = useUpdateAlert()
  const createChannel = useCreateChannel()
  const deleteChannel = useDeleteChannel()

  // URL-backed search + status filter — shareable, survives reload.
  const search = sp.get('q') ?? ''
  const statusFilter = (sp.get('status') ?? 'all') as StatusFilter

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/alerts?${next.toString()}`)
  }

  // Debounced search → URL.
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  // `mounted` ensures SSR and client initial hydration render identically.
  // Skeleton checks use this flag so they only activate after client mount —
  // before mount, both SSR and client hydration render the data-based state
  // (empty or list), preventing the skeleton vs empty-state mismatch.
  // useSyncExternalStore returns false on the server and true on the client
  // without needing useEffect + setState (which the react-hooks/set-state-in-effect
  // rule flags as a cascading-render anti-pattern).
  const mounted = useSyncExternalStore(
    (_cb) => () => {},
    () => true,
    () => false,
  )

  const [alertDialogOpen, setAlertDialogOpen] = useState(false)
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AlertType>('budget')
  const [newThreshold, setNewThreshold] = useState('')
  const [newWindow, setNewWindow] = useState('60')
  const [newCooldown, setNewCooldown] = useState('60')
  const [newChannelKind, setNewChannelKind] = useState<ChannelKind>('email')
  const [newChannelTarget, setNewChannelTarget] = useState('')

  function openCreateAlert() {
    setEditingId(null)
    setNewName('')
    setNewType('budget')
    setNewThreshold('')
    setNewWindow('60')
    setNewCooldown('60')
    setAlertDialogOpen(true)
  }

  function openEditAlert(a: AlertRow) {
    setEditingId(a.id)
    setNewName(a.name)
    setNewType(a.type)
    setNewThreshold(String(a.threshold))
    setNewWindow(String(a.window_minutes))
    setNewCooldown(String(a.cooldown_minutes))
    setAlertDialogOpen(true)
  }

  const alerts = useMemo(() => alertsQuery.data ?? [], [alertsQuery.data])
  const channels = channelsQuery.data ?? []
  const deliveries = deliveriesQuery.data ?? []

  // Apply search + status filter before bucketing.
  const filteredAlerts = useMemo(() => {
    const needle = search.toLowerCase()
    return alerts.filter((a) => {
      if (needle && !a.name.toLowerCase().includes(needle)) return false
      if (statusFilter === 'firing')  return a.is_active && isRecentlyFired(a.last_triggered_at)
      if (statusFilter === 'active')  return a.is_active && !isRecentlyFired(a.last_triggered_at)
      if (statusFilter === 'paused')  return !a.is_active
      return true
    })
  }, [alerts, search, statusFilter])

  const firing = filteredAlerts.filter((a) => a.is_active && isRecentlyFired(a.last_triggered_at))
  const active = filteredAlerts.filter((a) => a.is_active && !isRecentlyFired(a.last_triggered_at))
  const paused = filteredAlerts.filter((a) => !a.is_active)

  // Unfiltered counts for the stat strip + filter chips.
  const totalFiring = alerts.filter((a) => a.is_active && isRecentlyFired(a.last_triggered_at)).length
  const totalActive = alerts.filter((a) => a.is_active && !isRecentlyFired(a.last_triggered_at)).length
  const totalPaused = alerts.filter((a) => !a.is_active).length
  // Capture "now" at mount — last-24h bucketing for header counter.
  const [mountNow] = useState(() => Date.now())
  const fires24h = deliveries.filter(
    (d) => mountNow - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length
  const isPending = updateAlert.isPending || deleteAlert.isPending

  function alertFires(id: string): number {
    return deliveries.filter((d) => d.alert_id === id).length
  }

  async function handleSubmitAlert() {
    const threshold = Number(newThreshold)
    if (!newName.trim() || !Number.isFinite(threshold) || threshold <= 0) return
    const window_minutes = Math.max(1, Number(newWindow) || 60)
    const cooldown_minutes = Math.max(0, Number(newCooldown) || 60)

    if (editingId) {
      await updateAlert.mutateAsync({
        id: editingId,
        name: newName.trim(),
        threshold,
        window_minutes,
        cooldown_minutes,
      })
    } else {
      await createAlert.mutateAsync({
        name: newName.trim(),
        type: newType,
        threshold,
        window_minutes,
        cooldown_minutes,
      })
    }
    setAlertDialogOpen(false)
    setEditingId(null)
  }

  async function handleCreateChannel() {
    if (!newChannelTarget.trim()) return
    await createChannel.mutateAsync({ kind: newChannelKind, target: newChannelTarget.trim() })
    setNewChannelTarget('')
    setChannelDialogOpen(false)
  }

  // CSV / JSON export — client-side, RFC 4180 escaping.
  function csvField(v: string | number): string {
    const s = String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  function csvRow(cells: (string | number)[]): string {
    return cells.map(csvField).join(',')
  }
  function downloadFile(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spanlens-alerts-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    const lines: string[] = []
    lines.push(csvRow(['Alerts']))
    lines.push(csvRow(['ID', 'Name', 'Type', 'Threshold', 'Window (min)', 'Cooldown (min)', 'Active', 'Last Triggered', 'Fires Total']))
    for (const a of filteredAlerts) {
      lines.push(csvRow([
        a.id, a.name, a.type, a.threshold, a.window_minutes, a.cooldown_minutes,
        a.is_active ? 'yes' : 'no',
        a.last_triggered_at ?? '',
        alertFires(a.id),
      ]))
    }
    lines.push('')
    lines.push(csvRow(['Recent deliveries']))
    lines.push(csvRow(['When', 'Alert ID', 'Status', 'Error']))
    for (const d of deliveries.slice(0, 100)) {
      lines.push(csvRow([d.created_at, d.alert_id, d.status, d.error_message ?? '']))
    }
    downloadFile(lines.join('\n'), 'text/csv', 'csv')
  }
  function exportJson() {
    downloadFile(JSON.stringify({ alerts: filteredAlerts, channels, deliveries }, null, 2), 'application/json', 'json')
  }
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportOpen) return
    function onDown(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

  function refreshAll() {
    void alertsQuery.refetch()
    void channelsQuery.refetch()
    void deliveriesQuery.refetch()
  }
  const isFetching = alertsQuery.isFetching || channelsQuery.isFetching || deliveriesQuery.isFetching

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Alerts' }]}
          right={
            <div className="flex items-center gap-3">
              {/* Live + refresh visuals depend on isFetching, which differs
                  between SSR (no queries running) and the first client paint
                  (cache may be refetching after a mutation). Gate on `mounted`
                  to keep the SSR snapshot deterministic. */}
              <LiveDot refetching={mounted && isFetching} />
              <button
                type="button"
                onClick={refreshAll}
                disabled={mounted && isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', mounted && isFetching && 'animate-spin')}>↻</span>
              </button>
              <PermissionGate need="edit">
                <button
                  type="button"
                  onClick={() => setChannelDialogOpen(true)}
                  title="Add channel"
                  aria-label="Add channel"
                  className="font-mono text-[11px] text-text-muted px-2 sm:px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev hover:text-text transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <Bell className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">Add channel</span>
                </button>
                <button
                  type="button"
                  onClick={openCreateAlert}
                  title="New alert"
                  aria-label="New alert"
                  className="font-mono text-[11px] text-bg px-2 sm:px-[10px] py-[5px] rounded-[5px] bg-text font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">New alert</span>
                </button>
              </PermissionGate>
            </div>
          }
        />
        <h1 className="sr-only">Alerts</h1>
      </div>

      {/* Stat strip — 2 cols on mobile, 3 on sm, 5 on md+. Values are gated
          on `mounted` because the prefetched SSR snapshot can diverge from
          the client cache after a mutation (e.g. paused alert flips
          Rules active 1 → 0 instantly client-side; SSR still saw 1). */}
      <div className="shrink-0 border-b border-border">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
          {[
            { label: 'Firing now',    value: String(totalFiring),  warn: mounted && totalFiring > 0 },
            { label: 'Rules active',  value: String(totalActive),  warn: false },
            { label: 'Fires 24h',     value: String(fires24h),     warn: mounted && fires24h > 0 },
            { label: 'Rules total',   value: String(alerts.length), warn: false },
            { label: 'Channels',      value: String(channels.length), warn: false },
          ].map((s, i) => (
            <div
              key={s.label}
              className={cn(
                'px-[18px] py-[14px] border-border',
                i % 2 === 0 && 'border-r sm:border-r-0',
                'sm:[&:not(:nth-child(3n))]:border-r',
                i < 4 && 'md:border-r',
                i < 4 && 'border-b sm:border-b md:!border-b-0',
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className={cn('text-[22px] sm:text-[24px] font-medium leading-none tracking-[-0.6px] tabular-nums', s.warn ? 'text-accent' : 'text-text')}>
                {mounted ? s.value : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Info banner with docs link */}
      <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted flex-wrap">
        <Bell className="h-3.5 w-3.5 shrink-0" />
        <span>
          Threshold-based rules on cost, error rate, and p95 latency. Evaluated every ~5 minutes.
        </span>
        <Link
          href="/docs/features/alerts"
          className="text-text hover:opacity-80 transition-opacity ml-auto"
        >
          How alerts work →
        </Link>
      </div>

      {/* Search + status filter + export */}
      <div className="px-[22px] py-[10px] border-b border-border flex items-center gap-2 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchInput('')
                updateQuery({ q: null })
              }
            }}
            placeholder="Search by name…"
            className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {([
            { v: 'all',     l: mounted ? `All ${alerts.length}`      : 'All' },
            { v: 'firing',  l: mounted ? `firing ${totalFiring}`     : 'firing' },
            { v: 'active',  l: mounted ? `active ${totalActive}`     : 'active' },
            { v: 'paused',  l: mounted ? `paused ${totalPaused}`     : 'paused' },
          ] as { v: StatusFilter; l: string }[]).map(({ v, l }) => (
            <button
              key={v}
              type="button"
              onClick={() => updateQuery({ status: v === 'all' ? null : v })}
              className={cn(
                'font-mono text-[11px] px-[9px] py-[3px] rounded-[4px] border transition-colors',
                statusFilter === v
                  ? 'border-border-strong bg-bg-elev text-text'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <div ref={exportRef} className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={mounted && alerts.length === 0}
            className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2.5 py-1 transition-colors disabled:opacity-40"
          >
            Export ▾
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded-md shadow-lg py-1 min-w-[110px]">
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportCsv() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >CSV</button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportJson() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >JSON</button>
            </div>
          )}
        </div>
      </div>

      <div>
        {!mounted ? (
          // Hold an SSR-stable placeholder until client mount. After mount the
          // real conditional below picks the matching branch. This avoids the
          // empty-state ↔ populated branch swap that fires when SSR sees the
          // prefetch snapshot but the client cache already has fresh data.
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : alertsQuery.data === undefined ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : alerts.length === 0 && channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
            <Bell className="h-10 w-10 text-text-faint" />
            <p className="text-[13px]">No alert rules yet.</p>
            <p className="font-mono text-[12px] text-center max-w-md">Create an alert to get notified about budget, error rate, or latency issues.</p>
            <PermissionGate need="edit">
              <button
                type="button"
                onClick={openCreateAlert}
                className="font-mono text-[11.5px] px-3 py-[5px] mt-1 rounded-[4px] bg-text text-bg font-medium hover:opacity-90 transition-opacity"
              >
                + New alert
              </button>
            </PermissionGate>
            <Link
              href="/docs/features/alerts"
              className="font-mono text-[11.5px] mt-1 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
            >
              How alerts work →
            </Link>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-text-muted">
            <p className="font-mono text-[12.5px]">No alerts match the current filters.</p>
            <button
              type="button"
              onClick={() => { setSearchInput(''); updateQuery({ q: null, status: null }) }}
              className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {firing.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-accent-bg border-b border-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                    Firing · {firing.length}
                  </span>
                </div>
                {firing.map((a, i) => (
                  <AlertRuleRow key={a.id} a={a} fires={alertFires(a.id)} last={i === firing.length - 1}
                    onToggle={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                    onEdit={() => openEditAlert(a)}
                    onDelete={() => void deleteAlert.mutateAsync(a.id)}
                    isPending={isPending}
                  />
                ))}
              </div>
            )}

            {active.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
                    Active · {active.length}
                  </span>
                </div>
                {active.map((a, i) => (
                  <AlertRuleRow key={a.id} a={a} fires={alertFires(a.id)} last={i === active.length - 1}
                    onToggle={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                    onEdit={() => openEditAlert(a)}
                    onDelete={() => void deleteAlert.mutateAsync(a.id)}
                    isPending={isPending}
                  />
                ))}
              </div>
            )}

            {paused.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint opacity-75">
                    Paused · {paused.length}
                  </span>
                </div>
                <div className="opacity-70">
                  {paused.map((a, i) => (
                    <AlertRuleRow key={a.id} a={a} fires={alertFires(a.id)} last={i === paused.length - 1}
                      onToggle={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                      onEdit={() => openEditAlert(a)}
                      onDelete={() => void deleteAlert.mutateAsync(a.id)}
                      isPending={isPending}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="px-[22px] py-[18px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
                Notification channels
              </div>
              {mounted && channelsQuery.data === undefined ? (
                <div className="h-12 bg-bg-elev rounded animate-pulse" />
              ) : channels.length === 0 ? (
                <div className="rounded-[5px] border border-dashed border-border py-5 text-center font-mono text-[12px] text-text-muted">
                  No channels yet, add an email or webhook to receive alerts.
                </div>
              ) : (
                <div className="rounded-[6px] border border-border overflow-hidden">
                  {channels.map((ch) => (
                    <div
                      key={ch.id}
                      className="flex items-center justify-between px-[14px] py-3 border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-text-muted">
                          {ch.kind === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                        </span>
                        <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted">{ch.kind}</span>
                        <span className="font-mono text-[12px] text-text-faint truncate max-w-xs">{ch.target}</span>
                      </div>
                      <PermissionGate need="edit">
                        <button
                          type="button"
                          onClick={() => void deleteChannel.mutateAsync(ch.id)}
                          disabled={deleteChannel.isPending}
                          className="text-text-faint hover:text-bad transition-colors p-1 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </PermissionGate>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {deliveries.length > 0 && (
              <div className="px-[22px] pb-[18px]">
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
                  Recent deliveries
                </div>
                <div className="rounded-[6px] border border-border overflow-hidden">
                  {deliveries.slice(0, 10).map((d) => (
                    <div key={d.id} className="flex items-center gap-4 px-[14px] py-2 border-b border-border last:border-0 text-[11.5px]">
                      <span className="font-mono text-text-faint">{formatDateTime(d.created_at)}</span>
                      <span className={cn('font-mono px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.04em]',
                        d.status === 'sent' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad')}>
                        {d.status}
                      </span>
                      {d.error_message && <span className="text-bad truncate max-w-md">{d.error_message}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={alertDialogOpen}
        onOpenChange={(open) => {
          setAlertDialogOpen(open)
          if (!open) setEditingId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit alert rule' : 'Create alert rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="High daily spend"
                className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
              />
            </div>
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
                Type {editingId && <span className="text-text-faint normal-case tracking-normal">· locked (threshold semantics depend on type)</span>}
              </label>
              <Select
                value={newType}
                onValueChange={(v) => setNewType(v as AlertType)}
                disabled={Boolean(editingId)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="budget">Budget (USD)</SelectItem>
                  <SelectItem value="error_rate">Error rate (0–1)</SelectItem>
                  <SelectItem value="latency_p95">p95 latency (ms)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Threshold', value: newThreshold, onChange: setNewThreshold, placeholder: newType === 'budget' ? '10' : newType === 'error_rate' ? '0.05' : '2000' },
                { label: 'Window (min)', value: newWindow, onChange: setNewWindow, placeholder: '60' },
                { label: 'Cooldown (min)', value: newCooldown, onChange: setNewCooldown, placeholder: '60' },
              ].map((f) => (
                <div key={f.label} className="space-y-2">
                  <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">{f.label}</label>
                  <input
                    type="number"
                    step="any"
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSubmitAlert()}
              disabled={
                !newName.trim() ||
                !newThreshold ||
                createAlert.isPending ||
                updateAlert.isPending
              }
              className="w-full py-2 rounded bg-text text-bg font-mono text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {editingId
                ? (updateAlert.isPending ? 'Saving…' : 'Save changes')
                : (createAlert.isPending ? 'Creating…' : 'Create alert')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add notification channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Kind</label>
              <Select value={newChannelKind} onValueChange={(v) => setNewChannelKind(v as ChannelKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (Resend)</SelectItem>
                  <SelectItem value="slack">Slack webhook</SelectItem>
                  <SelectItem value="discord">Discord webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
                {newChannelKind === 'email' ? 'Email address' : 'Webhook URL'}
              </label>
              <input
                value={newChannelTarget}
                onChange={(e) => setNewChannelTarget(e.target.value)}
                placeholder={newChannelKind === 'email' ? 'alerts@yourco.com' : 'https://hooks.slack.com/…'}
                className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleCreateChannel()}
              disabled={!newChannelTarget.trim() || createChannel.isPending}
              className="w-full py-2 rounded bg-text text-bg font-mono text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {createChannel.isPending ? 'Adding…' : 'Add channel'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
