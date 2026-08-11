'use client'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Section, FormRow, PrimaryBtn, GhostBtn } from '@/components/ui/primitives'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useWebhookDeliveries,
} from '@/lib/queries/use-webhooks'
import type { WebhookEvent, WebhookRow } from '@/lib/queries/types'
import { useCurrentMember } from '@/lib/queries/use-members'
import { MonoPill, Hint, Toggle, TabHeader } from '../_shared/ui'

// ─── WEBHOOKS tab ─────────────────────────────────────────────────────────────

const ALL_WEBHOOK_EVENTS: { value: WebhookEvent; label: string; hint: string }[] = [
  { value: 'request.created',  label: 'request.created',  hint: 'fires on every LLM call' },
  { value: 'trace.completed',  label: 'trace.completed',  hint: 'fires when a trace ends' },
  { value: 'alert.triggered',  label: 'alert.triggered',  hint: 'fires when an alert rule trips' },
]

function SecretField({ secret }: { secret: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[11px] text-text-muted bg-bg-muted px-2 py-1 rounded border border-border">
        {revealed ? secret : '•'.repeat(Math.min(secret.length, 32))}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="text-[11px] text-text-faint hover:text-text transition-colors"
      >
        {revealed ? 'Hide' : 'Show'}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        className="text-[11px] text-text-faint hover:text-text transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

function DeliveryHistory({ webhookId }: { webhookId: string }) {
  const { data: deliveries, isLoading } = useWebhookDeliveries(webhookId)

  if (isLoading) {
    return <div className="px-6 py-3 font-mono text-[11.5px] text-text-faint">Loading…</div>
  }
  if (!deliveries || deliveries.length === 0) {
    return <div className="px-6 py-3 font-mono text-[11.5px] text-text-faint">No deliveries yet.</div>
  }

  return (
    <div className="overflow-x-auto">
    <div className="divide-y divide-border min-w-[420px]">
      <div className="grid grid-cols-[140px_80px_80px_1fr] gap-4 px-6 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
        <span>Time</span>
        <span>Status</span>
        <span>HTTP</span>
        <span>Error</span>
      </div>
      {deliveries.map((d) => (
        <div key={d.id} className="grid grid-cols-[140px_80px_80px_1fr] gap-4 px-6 py-2 items-center">
          <span className="font-mono text-[11px] text-text-muted">
            {new Date(d.delivered_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </span>
          <MonoPill variant={d.status === 'success' ? 'good' : 'faint'} dot>
            {d.status}
          </MonoPill>
          <span className="font-mono text-[11px] text-text-muted">{d.http_status ?? '—'}</span>
          <span className="font-mono text-[11px] text-text-faint truncate">{d.error_message ?? '—'}</span>
        </div>
      ))}
    </div>
    </div>
  )
}

export function WebhooksTab() {
  const { data: webhooks, isLoading } = useWebhooks()
  const createWebhook = useCreateWebhook()
  const updateWebhook = useUpdateWebhook()
  const deleteWebhook = useDeleteWebhook()
  const testWebhook = useTestWebhook()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newEvents, setNewEvents] = useState<WebhookEvent[]>(['request.created'])
  const [newActive, setNewActive] = useState(true)
  const [createError, setCreateError] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [toggleError, setToggleError] = useState<string | null>(null)

  const currentMember = useCurrentMember()
  const canEdit = currentMember?.role === 'admin' || currentMember?.role === 'editor'

  async function handleToggleActive(webhook: WebhookRow) {
    setToggleError(null)
    try {
      await updateWebhook.mutateAsync({ id: webhook.id, is_active: !webhook.is_active })
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Failed to update webhook')
    }
  }

  function toggleEvent(ev: WebhookEvent) {
    setNewEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    )
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError('')
    try {
      await createWebhook.mutateAsync({ name: newName, url: newUrl, events: newEvents, is_active: newActive })
      setCreateOpen(false)
      setNewName('')
      setNewUrl('')
      setNewEvents(['request.created'])
      setNewActive(true)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create webhook')
    }
  }

  async function handleTest(webhook: WebhookRow) {
    try {
      const result = await testWebhook.mutateAsync(webhook.id)
      setTestResult((prev) => ({
        ...prev,
        [webhook.id]: result
          ? `${result.status} · HTTP ${result.http_status ?? '—'} · ${result.duration_ms}ms`
          : 'Sent',
      }))
      setSelectedId(webhook.id)
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [webhook.id]: err instanceof Error ? err.message : 'Test failed',
      }))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this webhook?')) return
    await deleteWebhook.mutateAsync(id)
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Webhooks"
        description="Receive real-time HTTP callbacks when events occur in your workspace."
        action={
          canEdit ? (
            <PrimaryBtn onClick={() => { setCreateOpen(true); setCreateError('') }}>
              <Plus className="w-3.5 h-3.5" /> New webhook
            </PrimaryBtn>
          ) : null
        }
      />

      <Section title="Webhook endpoints" className="mb-5">
        {toggleError && (
          <div className="px-6 pt-4 font-mono text-[11.5px] text-status-error">
            {toggleError}
          </div>
        )}
        {isLoading ? (
          <div className="px-6 py-8 text-center font-mono text-[12.5px] text-text-faint">Loading…</div>
        ) : (webhooks ?? []).length === 0 ? (
          <div className="px-6 py-8 text-center font-mono text-[12.5px] text-text-faint">
            No webhooks yet. Add one to start receiving events.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <div className="divide-y divide-border min-w-[620px]">
            <div className="grid grid-cols-[1.8fr_1.2fr_1fr_110px_90px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              {['Name', 'URL', 'Events', 'Status', ''].map((h, i) => <span key={i}>{h}</span>)}
            </div>
            {(webhooks ?? []).map((wh) => (
              <div key={wh.id} className="grid grid-cols-[1.8fr_1.2fr_1fr_110px_90px] gap-4 px-6 py-3 items-center">
                <button
                  type="button"
                  onClick={() => setSelectedId(wh.id === selectedId ? null : wh.id)}
                  className="text-[13px] font-medium text-left hover:text-accent transition-colors truncate"
                >
                  {wh.name}
                </button>
                <span className="font-mono text-[11px] text-text-muted truncate" title={wh.url}>
                  {wh.url}
                </span>
                <div className="flex flex-wrap gap-1">
                  {wh.events.map((ev) => (
                    <MonoPill key={ev} variant="neutral">{ev}</MonoPill>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    on={wh.is_active}
                    disabled={!canEdit || updateWebhook.isPending}
                    onToggle={() => void handleToggleActive(wh)}
                  />
                  <MonoPill variant={wh.is_active ? 'good' : 'faint'} dot>
                    {wh.is_active ? 'active' : 'off'}
                  </MonoPill>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Send test event"
                      disabled={testWebhook.isPending}
                      onClick={() => void handleTest(wh)}
                      className="px-2 py-1 rounded text-[11px] border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors disabled:opacity-40"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      disabled={deleteWebhook.isPending}
                      onClick={() => void handleDelete(wh.id)}
                      className="p-1.5 rounded hover:bg-accent-bg text-text-faint hover:text-accent transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          </div>
        )}
      </Section>

      {selectedId && (
        <Section title="Webhook details" className="mb-5">
          {(() => {
            const wh = (webhooks ?? []).find((w) => w.id === selectedId)
            if (!wh) return null
            return (
              <>
                <FormRow label="Signing secret" hint="Used to verify X-Spanlens-Signature on incoming events.">
                  <SecretField secret={wh.secret} />
                </FormRow>
                {testResult[selectedId] && (
                  <FormRow label="Last test result">
                    <span className="font-mono text-[11.5px] text-text-muted">{testResult[selectedId]}</span>
                  </FormRow>
                )}
              </>
            )
          })()}
        </Section>
      )}

      {selectedId && (
        <Section title="Delivery history" action={<Hint>Last 10</Hint>} className="mb-5">
          <DeliveryHistory webhookId={selectedId} />
        </Section>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New webhook</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreate(e)} className="mt-3 space-y-4">
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">Name</label>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My webhook"
                className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg text-[13px] outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">URL</label>
              <input
                required
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg text-[13px] outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-muted mb-2">Events</label>
              <div className="space-y-2">
                {ALL_WEBHOOK_EVENTS.map(({ value, label, hint }) => (
                  <label key={value} className="flex items-baseline gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEvents.includes(value)}
                      onChange={() => toggleEvent(value)}
                      className="rounded border-border self-center"
                    />
                    <span className="font-mono text-[12px] text-text-muted">{label}</span>
                    <span className="text-[11px] text-text-faint">{hint}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[12px] text-text-muted">Active</label>
              <Toggle on={newActive} onToggle={() => setNewActive((v) => !v)} />
            </div>
            {createError && <div className="text-[12.5px] text-bad">{createError}</div>}
            <div className="flex gap-2 justify-end pt-1">
              <GhostBtn type="button" onClick={() => setCreateOpen(false)}>Cancel</GhostBtn>
              <PrimaryBtn type="submit" disabled={createWebhook.isPending || newEvents.length === 0}>
                {createWebhook.isPending ? 'Creating…' : 'Create webhook'}
              </PrimaryBtn>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
