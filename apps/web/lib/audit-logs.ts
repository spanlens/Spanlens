/**
 * Shared helpers for rendering audit_logs.
 *
 * Severity is inferred from the action string because the table stores it
 * as a free-form `<resource>.<verb>` (e.g. `api_key.create`,
 * `billing.plan.change`). High = destructive / billing / auth-critical,
 * medium = create/modify, low = the rest. Categorisation lives here so the
 * Settings tab preview, dashboard "Recent activity" card, and the dedicated
 * viewer all render the same colour for the same row.
 */

export type AuditSeverity = 'high' | 'med' | 'low'

const HIGH_RE = /\.(delete|revoke|rotate)$|^billing\.|^workspace\.|^member\.remove/
const MED_RE = /\.(create|add|update|change|invite)$/

export function inferAuditSeverity(action: string): AuditSeverity {
  if (HIGH_RE.test(action)) return 'high'
  if (MED_RE.test(action)) return 'med'
  return 'low'
}

/**
 * HH:MM:SS for the same-day case the Settings tab cares about. Locale is
 * hard-coded to avoid the SSR/CSR hydration mismatch the project hit on
 * `toLocaleTimeString` without arguments (gotcha #22).
 */
export function formatAuditTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * "May 31, 14:02" form for the dedicated viewer where time can span days.
 */
export function formatAuditTimestamp(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${date}, ${time}`
}
