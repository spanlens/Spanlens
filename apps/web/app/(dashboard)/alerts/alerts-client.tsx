'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bell, Mail, MessageSquare, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import {
  useAlerts,
  useCreateAlert,
  useDeleteAlert,
  useUpdateAlert,
  useNotificationChannels,
  useAlertDeliveries,
} from '@/lib/queries/use-alerts'
import type { AlertType, AlertRow } from '@/lib/queries/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { StatusPill } from '@/components/ui/primitives'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  CONTROL,
  Segment,
  SegmentItem,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../_board/surfaces'

function fmtThreshold(type: AlertType, threshold: number): string {
  if (type === 'budget') return `$${threshold}`
  if (type === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
  if (type === 'eval_score') return `${(threshold * 100).toFixed(1)}%`
  return `${threshold}ms`
}

// Short human name for the METRIC column. The expression form ("p95(latency)")
// is precise but too wide for a table cell, so the board shows the plain name
// and lets the THRESHOLD cell carry the comparison.
function metricLabel(type: AlertType): string {
  if (type === 'budget') return 'cost total'
  if (type === 'error_rate') return 'error rate'
  if (type === 'eval_score') return 'eval score'
  return 'p95 latency'
}

// eval_score is a quality floor (fires when score drops BELOW). The others
// are ceilings (fire when the metric rises ABOVE).
function alertComparator(type: AlertType): '<' | '>' {
  return type === 'eval_score' ? '<' : '>'
}

function isRecentlyFired(lastTriggeredAt: string | null): boolean {
  if (!lastTriggeredAt) return false
  return Date.now() - new Date(lastTriggeredAt).getTime() < 60 * 60 * 1000
}

type RuleStatus = 'firing' | 'active' | 'paused'

function ruleStatus(a: AlertRow): RuleStatus {
  if (!a.is_active) return 'paused'
  return isRecentlyFired(a.last_triggered_at) ? 'firing' : 'active'
}

const STATUS_VARIANT: Record<RuleStatus, NonNullable<React.ComponentProps<typeof StatusPill>['variant']>> = {
  firing: 'bad',
  active: 'good',
  paused: 'neutral',
}

// The board draws one flat table instead of the old firing / active / paused
// bands, so the ordering carries what the band headers used to say.
const STATUS_RANK: Record<RuleStatus, number> = { firing: 0, active: 1, paused: 2 }

/*
 * Column tracks for the rules table (D13). Wider than a narrow viewport, so
 * the card scrolls its own grid sideways rather than the page.
 */
const RULE_GRID: CSSProperties = {
  gridTemplateColumns: 'minmax(200px,1.6fr) 148px 118px 92px 104px 150px 84px 168px',
}
const CHANNEL_GRID: CSSProperties = {
  gridTemplateColumns: 'minmax(150px,1fr) minmax(220px,2fr) 130px 92px',
}
const DELIVERY_GRID: CSSProperties = {
  gridTemplateColumns: '200px 92px minmax(200px,1fr)',
}

type StatusFilter = 'all' | 'firing' | 'active' | 'paused'
type AlertsTab = 'alerts' | 'channels'

export function AlertsClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const alertsQuery = useAlerts()
  const channelsQuery = useNotificationChannels()
  const deliveriesQuery = useAlertDeliveries()
  const createAlert = useCreateAlert()
  const deleteAlert = useDeleteAlert()
  const updateAlert = useUpdateAlert()

  // URL-backed tab + search + status filter — shareable, survives reload.
  const search = sp.get('q') ?? ''
  const statusFilter = (sp.get('status') ?? 'all') as StatusFilter
  const tab: AlertsTab = sp.get('tab') === 'channels' ? 'channels' : 'alerts'

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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AlertType>('budget')
  const [newThreshold, setNewThreshold] = useState('')
  const [newWindow, setNewWindow] = useState('60')
  const [newCooldown, setNewCooldown] = useState('60')

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
  // Memoised because the fan-out label below depends on it — a fresh `[]` on
  // every render would defeat that useMemo.
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data])
  const deliveries = deliveriesQuery.data ?? []

  // Apply search + status filter, then order firing → active → paused.
  const filteredAlerts = useMemo(() => {
    const needle = search.toLowerCase()
    return alerts
      .filter((a) => {
        if (needle && !a.name.toLowerCase().includes(needle)) return false
        if (statusFilter === 'all') return true
        return ruleStatus(a) === statusFilter
      })
      .sort((x, y) => STATUS_RANK[ruleStatus(x)] - STATUS_RANK[ruleStatus(y)])
  }, [alerts, search, statusFilter])

  // Unfiltered counts for the stat strip + filter segment.
  const totalFiring = alerts.filter((a) => ruleStatus(a) === 'firing').length
  const totalActive = alerts.filter((a) => a.is_active).length
  const totalPaused = alerts.filter((a) => !a.is_active).length
  // Capture "now" at mount — last-24h bucketing for the stat strip.
  const [mountNow] = useState(() => Date.now())
  const fires24h = deliveries.filter(
    (d) => mountNow - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length
  const isPending = updateAlert.isPending || deleteAlert.isPending

  // Channels are org-level and every active rule fans out to all of them, so
  // the CHANNELS cell reads the same on every row. That is the routing model,
  // not a placeholder — per-rule routing does not exist.
  const channelFanout = useMemo(() => {
    const kinds = [...new Set(channels.filter((c) => c.is_active).map((c) => c.kind))].sort()
    return kinds.length > 0 ? kinds.join(', ') : 'none'
  }, [channels])

  const firstFiring = alerts.find((a) => ruleStatus(a) === 'firing')

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

  const skeleton = (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-card bg-bg-chip animate-pulse" />)}
    </div>
  )

  return (
    <div>
      {/* The topbar is the one full-bleed row; the shell already supplies the
          content inset for everything below it. */}
      <div className={TOPBAR_BLEED}>
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
              <Link
                href="/settings?tab=integrations"
                title="Manage notification channels"
                className={cn(CONTROL, 'flex items-center gap-1.5 px-3 text-[12.5px] font-medium leading-[18px] text-text-muted transition-colors hover:text-text')}
              >
                <Settings2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Channels</span>
              </Link>
              <PermissionGate need="edit">
                <button
                  type="button"
                  onClick={openCreateAlert}
                  title="New alert"
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
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

      <Board>
        {/* `contents` lets the Radix tab root disappear from layout so the tab
            strip and the panel below it are direct children of the board and
            pick up its 16px rhythm. */}
        <Tabs
          value={tab}
          onValueChange={(v) => updateQuery({ tab: v === 'alerts' ? null : v })}
          className="contents"
        >
          <TabsList>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="mt-0 flex flex-col gap-4">
            {/* Filter row — search, status segment, export. Not in the Figma
                frame, but these are shipped controls, so they take the board's
                standard 34px filter chrome. */}
            <FilterBar>
              <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
                <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchInput('')
                      updateQuery({ q: null })
                    }
                  }}
                  placeholder="Search by name"
                  aria-label="Search alert rules by name"
                  className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                    className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
                  >
                    Clear
                  </button>
                )}
              </div>

              <Segment>
                {([
                  { v: 'all', l: 'All', n: alerts.length },
                  { v: 'firing', l: 'Firing', n: totalFiring },
                  { v: 'active', l: 'Active', n: totalActive },
                  { v: 'paused', l: 'Paused', n: totalPaused },
                ] as { v: StatusFilter; l: string; n: number }[]).map(({ v, l, n }) => (
                  <SegmentItem
                    key={v}
                    active={statusFilter === v}
                    onClick={() => updateQuery({ status: v === 'all' ? null : v })}
                  >
                    {l}
                    <span className="ml-1.5 font-mono text-[10.5px] text-text-faint">
                      {mounted ? n : ' '}
                    </span>
                  </SegmentItem>
                ))}
              </Segment>

              <span className="flex-1" />

              <div ref={exportRef} className="relative">
                <button
                  type="button"
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={mounted && alerts.length === 0}
                  aria-expanded={exportOpen}
                  className={cn(CONTROL, 'px-3 text-[12.5px] font-medium leading-[18px] text-text-muted transition-colors hover:text-text disabled:opacity-40')}
                >
                  Export ↓
                </button>
                {exportOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[110px] rounded-md border border-border bg-bg-elev p-1 shadow-card">
                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); exportCsv() }}
                      className="block w-full rounded px-2.5 py-1.5 text-left text-[12.5px] text-text-muted transition-colors hover:bg-bg-sunk hover:text-text"
                    >CSV</button>
                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); exportJson() }}
                      className="block w-full rounded px-2.5 py-1.5 text-left text-[12.5px] text-text-muted transition-colors hover:bg-bg-sunk hover:text-text"
                    >JSON</button>
                  </div>
                )}
              </div>
            </FilterBar>

            {/* Stat strip. Values are gated on `mounted` because the prefetched
                SSR snapshot can diverge from the client cache after a mutation
                (e.g. pausing a rule flips Rules active 1 → 0 instantly on the
                client while SSR still saw 1). */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Rules total"
                value={mounted ? alerts.length : ' '}
                foot="across this workspace"
              />
              <StatCard
                label="Rules active"
                value={mounted ? totalActive : ' '}
                foot={mounted ? `${totalPaused} paused` : ' '}
              />
              <StatCard
                label="Firing now"
                value={mounted ? totalFiring : ' '}
                foot={mounted ? (firstFiring ? firstFiring.name : 'nothing breaching') : ' '}
                {...(mounted && totalFiring > 0 ? { footClass: 'text-accent' } : {})}
              />
              <StatCard
                label="Fires 24h"
                value={mounted ? fires24h : ' '}
                foot={mounted ? `${deliveries.length} deliveries on record` : ' '}
              />
            </div>

            {/* Explainer with docs link */}
            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <Bell className="h-3.5 w-3.5 shrink-0" />
              <span>
                Threshold rules on cost, error rate, and p95 latency. Evaluated every ~5 minutes.
              </span>
              <Link
                href="/docs/features/alerts"
                className="ml-auto text-text transition-opacity hover:opacity-80"
              >
                How alerts work →
              </Link>
            </div>

            {!mounted || alertsQuery.data === undefined ? (
              skeleton
            ) : alerts.length === 0 ? (
              <div className="card-surface rounded-card flex flex-col items-center justify-center gap-3 px-5 py-12 text-text-muted">
                <Bell className="h-9 w-9 text-text-faint" />
                <p className="text-[13.5px] font-semibold leading-[1.45] text-text">No alert rules yet.</p>
                <p className="max-w-[440px] text-center text-[12.5px] leading-[1.6]">
                  Create a rule to get notified about budget, error rate, or latency issues.
                </p>
                <PermissionGate need="edit">
                  <button
                    type="button"
                    onClick={openCreateAlert}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New alert
                  </button>
                </PermissionGate>
                <Link
                  href="/docs/features/alerts"
                  className="font-mono text-[11px] text-text-muted underline underline-offset-2 transition-colors hover:text-text"
                >
                  How alerts work →
                </Link>
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="card-surface rounded-card flex h-40 flex-col items-center justify-center gap-3 text-text-muted">
                <p className="text-[12.5px]">No alerts match the current filters.</p>
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); updateQuery({ q: null, status: null }) }}
                  className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <TableCard>
                <div className="overflow-x-auto">
                  <div className="min-w-[1080px]">
                    <TableHead>
                      <div className="grid items-center gap-3" style={RULE_GRID}>
                        <Th>Rule</Th>
                        <Th>Metric</Th>
                        <Th>Threshold</Th>
                        <Th>Window</Th>
                        <Th>Cooldown</Th>
                        <Th>Channels</Th>
                        <Th>Status</Th>
                        <Th><span className="sr-only">Actions</span></Th>
                      </div>
                    </TableHead>
                    {filteredAlerts.map((a) => {
                      const status = ruleStatus(a)
                      return (
                        <div key={a.id} className={cn(ROW, 'grid items-center gap-3')} style={RULE_GRID}>
                          <Link
                            href={`/alerts/${a.id}`}
                            className="truncate text-[12px] leading-[1.45] text-text transition-colors hover:text-accent"
                          >
                            {a.name}
                          </Link>
                          <span className="truncate font-mono text-[12px] leading-[1.45] text-text-muted">
                            {metricLabel(a.type)}
                          </span>
                          <span className="font-mono text-[12px] leading-[1.45] text-text-muted tabular-nums">
                            {alertComparator(a.type)} {fmtThreshold(a.type, a.threshold)}
                          </span>
                          <span className="font-mono text-[12px] leading-[1.45] text-text-muted tabular-nums">
                            {a.window_minutes} min
                          </span>
                          <span className="font-mono text-[12px] leading-[1.45] text-text-muted tabular-nums">
                            {a.cooldown_minutes} min
                          </span>
                          <span className="truncate font-mono text-[12px] leading-[1.45] text-text-muted">
                            {channelFanout}
                          </span>
                          <span>
                            <StatusPill variant={STATUS_VARIANT[status]}>{status}</StatusPill>
                          </span>

                          <PermissionGate need="edit">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditAlert(a)}
                                disabled={isPending}
                                title="Edit"
                                aria-label={`Edit ${a.name}`}
                                className="rounded-full border border-border px-2.5 py-1 font-mono text-[10.5px] text-text-muted transition-colors hover:text-text disabled:opacity-40"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                                disabled={isPending}
                                title={a.is_active ? 'Pause' : 'Resume'}
                                aria-label={a.is_active ? `Pause ${a.name}` : `Resume ${a.name}`}
                                className="rounded-full border border-border px-2.5 py-1 font-mono text-[10.5px] text-text-muted transition-colors hover:text-text disabled:opacity-40"
                              >
                                {a.is_active ? 'Pause' : 'Resume'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteAlert.mutateAsync(a.id)}
                                disabled={isPending}
                                title="Delete"
                                aria-label={`Delete ${a.name}`}
                                className="p-1.5 text-text-faint transition-colors hover:text-bad disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </PermissionGate>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </TableCard>
            )}
          </TabsContent>

          <TabsContent value="channels" className="mt-0 flex flex-col gap-4">
            {/* Read-only here: every active rule fans out to these channels.
                Add / remove lives in Settings → Integrations (org-level). */}
            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span>
                Every active rule fans out to all connected channels. Add or remove them in Settings.
              </span>
              <Link
                href="/settings?tab=integrations"
                className="ml-auto text-text transition-opacity hover:opacity-80"
              >
                Manage channels →
              </Link>
            </div>

            {!mounted || channelsQuery.data === undefined ? (
              skeleton
            ) : channels.length === 0 ? (
              <div className="card-surface rounded-card flex flex-col items-center justify-center gap-3 px-5 py-12 text-text-muted">
                <Mail className="h-9 w-9 text-text-faint" />
                <p className="text-[13.5px] font-semibold leading-[1.45] text-text">No channels yet.</p>
                <p className="max-w-[440px] text-center text-[12.5px] leading-[1.6]">
                  Connect Slack, Discord, or email so a firing rule can reach someone.
                </p>
                <Link
                  href="/settings?tab=integrations"
                  className="mt-1 rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12.5px] font-medium text-text transition-colors hover:border-border-strong"
                >
                  Connect a channel
                </Link>
              </div>
            ) : (
              <TableCard>
                <div className="overflow-x-auto">
                  <div className="min-w-[720px]">
                    <TableHead>
                      <div className="grid items-center gap-3" style={CHANNEL_GRID}>
                        <Th>Channel</Th>
                        <Th>Target</Th>
                        <Th>Added</Th>
                        <Th>Status</Th>
                      </div>
                    </TableHead>
                    {channels.map((ch) => (
                      <div key={ch.id} className={cn(ROW, 'grid items-center gap-3')} style={CHANNEL_GRID}>
                        <span className="flex min-w-0 items-center gap-2 text-[12px] leading-[1.45] text-text">
                          <span className="shrink-0 text-text-faint">
                            {ch.kind === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                          </span>
                          <span className="truncate">{ch.label ?? ch.kind}</span>
                        </span>
                        <span className="truncate font-mono text-[12px] leading-[1.45] text-text-muted">
                          {ch.target}
                        </span>
                        <span className="font-mono text-[12px] leading-[1.45] text-text-muted">
                          {formatDate(ch.created_at)}
                        </span>
                        <span>
                          <StatusPill variant={ch.is_active ? 'good' : 'neutral'}>
                            {ch.is_active ? 'active' : 'off'}
                          </StatusPill>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </TableCard>
            )}

            {mounted && deliveries.length > 0 && (
              <TableCard>
                <TableHead>
                  <div className="grid items-center gap-3" style={DELIVERY_GRID}>
                    <Th>Delivered</Th>
                    <Th>Status</Th>
                    <Th>Detail</Th>
                  </div>
                </TableHead>
                {deliveries.slice(0, 10).map((d) => (
                  <div key={d.id} className={cn(ROW, 'grid items-center gap-3')} style={DELIVERY_GRID}>
                    <span className="font-mono text-[12px] leading-[1.45] text-text-muted">
                      {formatDateTime(d.created_at)}
                    </span>
                    <span>
                      <StatusPill variant={d.status === 'sent' ? 'good' : 'bad'}>{d.status}</StatusPill>
                    </span>
                    <span className="truncate font-mono text-[11px] leading-[1.45] text-text-faint">
                      {d.error_message ?? 'no errors reported'}
                    </span>
                  </div>
                ))}
              </TableCard>
            )}
          </TabsContent>
        </Tabs>
      </Board>

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
          <div className="mt-2 space-y-4">
            <div className="space-y-2">
              <label htmlFor="alert-name" className="eyebrow block">Name</label>
              <input
                id="alert-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="High daily spend"
                className={cn(CONTROL, 'w-full px-3 text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
              />
            </div>
            <div className="space-y-2">
              <span className="eyebrow block">
                Type {editingId && <span className="normal-case tracking-normal">· locked, threshold semantics depend on type</span>}
              </span>
              <Select
                value={newType}
                onValueChange={(v) => setNewType(v as AlertType)}
                disabled={Boolean(editingId)}
              >
                <SelectTrigger aria-label="Alert type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="budget">Budget (USD)</SelectItem>
                  <SelectItem value="error_rate">Error rate (0–1)</SelectItem>
                  <SelectItem value="latency_p95">p95 latency (ms)</SelectItem>
                  <SelectItem value="eval_score">Eval score (0–1, fires below)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'alert-threshold', label: 'Threshold', value: newThreshold, onChange: setNewThreshold, placeholder: newType === 'budget' ? '10' : newType === 'error_rate' ? '0.05' : newType === 'eval_score' ? '0.8' : '2000' },
                { id: 'alert-window', label: 'Window (min)', value: newWindow, onChange: setNewWindow, placeholder: '60' },
                { id: 'alert-cooldown', label: 'Cooldown (min)', value: newCooldown, onChange: setNewCooldown, placeholder: '60' },
              ].map((f) => (
                <div key={f.label} className="space-y-2">
                  <label htmlFor={f.id} className="eyebrow block">{f.label}</label>
                  <input
                    id={f.id}
                    type="number"
                    step="any"
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    placeholder={f.placeholder}
                    className={cn(CONTROL, 'w-full px-3 text-[12.5px] leading-[18px] tabular-nums text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
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
              className="w-full rounded-full bg-primary py-2 text-[12.5px] font-semibold leading-[18px] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {editingId
                ? (updateAlert.isPending ? 'Saving…' : 'Save changes')
                : (createAlert.isPending ? 'Creating…' : 'Create alert')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
