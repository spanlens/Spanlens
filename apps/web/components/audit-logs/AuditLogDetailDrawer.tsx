'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatAuditTimestamp, inferAuditSeverity } from '@/lib/audit-logs'
import type { AuditLogRow } from '@/lib/queries/use-audit-logs'

interface Props {
  row: AuditLogRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Detail panel for a single audit row. Opens on row click, surfaces the
 * metadata JSON tree, IP address, and actor UUID. Rendered as a centered
 * dialog (we don't have a Sheet/Drawer primitive in the shared UI lib —
 * Dialog with a tall max-height is the established pattern in this repo).
 */
export function AuditLogDetailDrawer({ row, open, onOpenChange }: Props) {
  if (!row) return null

  const sev = inferAuditSeverity(row.action)
  const sevColor =
    sev === 'high'
      ? 'text-accent'
      : sev === 'med'
        ? 'text-text'
        : 'text-text-faint'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm tracking-tight">
            <span className={cn('font-medium', sevColor)}>{row.action}</span>
          </DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 font-mono text-[11.5px] mt-4">
          <Field label="Time" value={formatAuditTimestamp(row.created_at)} />
          <Field label="Severity" value={sev.toUpperCase()} valueClass={sevColor} />
          <Field label="Resource type" value={row.resource_type} />
          <Field label="Resource id" value={row.resource_id ?? '—'} mono />
          <Field label="Actor" value={row.user_id ?? 'system'} mono />
          <Field label="IP address" value={row.ip_address ?? '—'} mono />
          <Field label="Event id" value={row.id} mono />
        </dl>

        <section className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Metadata
          </div>
          {row.metadata && Object.keys(row.metadata).length > 0 ? (
            <pre className="font-mono text-[11px] leading-relaxed bg-bg-muted/40 border border-border rounded-md p-3 overflow-x-auto">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          ) : (
            <div className="font-mono text-[11.5px] text-text-faint">No metadata.</div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}

interface FieldProps {
  label: string
  value: string
  valueClass?: string
  mono?: boolean
}

function Field({ label, value, valueClass, mono }: FieldProps) {
  return (
    <>
      <dt className="text-text-faint uppercase tracking-[0.04em] text-[10px]">
        {label}
      </dt>
      <dd className={cn(mono && 'truncate', valueClass ?? 'text-text')}>{value}</dd>
    </>
  )
}
