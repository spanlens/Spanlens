/**
 * Notification channel delivery — Resend (email) + Slack/Discord webhooks.
 *
 * Each function returns `{ ok: boolean, error?: string }`. Callers log the
 * result into `alert_deliveries`.
 */

interface DeliveryResult {
  ok: boolean
  error?: string
}

export interface AlertNotification {
  alertName: string
  alertType: 'budget' | 'error_rate' | 'latency_p95'
  threshold: number
  currentValue: number
  windowMinutes: number
  organizationName: string
  dashboardUrl?: string
}

function formatAlertValue(
  type: AlertNotification['alertType'],
  value: number,
): string {
  if (type === 'budget') return `$${value.toFixed(4)}`
  if (type === 'error_rate') return `${(value * 100).toFixed(1)}%`
  return `${Math.round(value)}ms`
}

function buildSubject(n: AlertNotification): string {
  const verb =
    n.alertType === 'budget'
      ? 'Budget threshold'
      : n.alertType === 'error_rate'
        ? 'Error rate'
        : 'p95 latency'
  return `[Spanlens] ${verb} alert: ${n.alertName}`
}

function buildPlainBody(n: AlertNotification): string {
  return [
    `Alert "${n.alertName}" triggered for ${n.organizationName}.`,
    ``,
    `Metric:    ${n.alertType}`,
    `Threshold: ${formatAlertValue(n.alertType, n.threshold)}`,
    `Current:   ${formatAlertValue(n.alertType, n.currentValue)} (last ${n.windowMinutes} minutes)`,
    ``,
    n.dashboardUrl ? `Dashboard: ${n.dashboardUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// ── Email via Resend ───────────────────────────────────────────

export async function sendEmailAlert(
  toAddress: string,
  notification: AlertNotification,
): Promise<DeliveryResult> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const fromAddress = process.env['RESEND_FROM_EMAIL'] ?? 'alerts@spanlens.io'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        subject: buildSubject(notification),
        text: buildPlainBody(notification),
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// ── Slack webhook ───────────────────────────────────────────────

export async function sendSlackAlert(
  webhookUrl: string,
  n: AlertNotification,
): Promise<DeliveryResult> {
  const color =
    n.alertType === 'budget' ? '#eab308' : n.alertType === 'error_rate' ? '#ef4444' : '#f97316'
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: buildSubject(n),
        attachments: [
          {
            color,
            fields: [
              { title: 'Organization', value: n.organizationName, short: true },
              { title: 'Metric', value: n.alertType, short: true },
              {
                title: 'Threshold',
                value: formatAlertValue(n.alertType, n.threshold),
                short: true,
              },
              {
                title: `Current (${n.windowMinutes}m)`,
                value: formatAlertValue(n.alertType, n.currentValue),
                short: true,
              },
            ],
            ...(n.dashboardUrl ? { actions: [{ type: 'button', text: 'Open dashboard', url: n.dashboardUrl }] } : {}),
          },
        ],
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Slack ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// ── Discord webhook ─────────────────────────────────────────────

export async function sendDiscordAlert(
  webhookUrl: string,
  n: AlertNotification,
): Promise<DeliveryResult> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Spanlens',
        embeds: [
          {
            title: buildSubject(n),
            description: buildPlainBody(n),
            color: 16744192, // orange
            ...(n.dashboardUrl ? { url: n.dashboardUrl } : {}),
          },
        ],
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Discord ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// ── Quota warning emails (80% / 100%) ──────────────────────────

export interface QuotaWarningNotification {
  organizationName: string
  /** Which bucket we crossed — 80 or 100. */
  threshold: 80 | 100
  used: number
  limit: number
  plan: string
  /** Absolute URL to /billing for the upgrade CTA. */
  billingUrl: string
}

function buildQuotaSubject(n: QuotaWarningNotification): string {
  if (n.threshold === 100) {
    return `[Spanlens] Monthly request quota reached for ${n.organizationName}`
  }
  return `[Spanlens] ${n.organizationName} has used 80% of this month's quota`
}

function buildQuotaBody(n: QuotaWarningNotification): string {
  const pct = Math.floor((n.used / n.limit) * 100)
  if (n.threshold === 100) {
    return [
      `Heads up — ${n.organizationName} has hit its monthly request quota.`,
      ``,
      `Usage:  ${n.used.toLocaleString()} / ${n.limit.toLocaleString()} requests (${pct}%)`,
      `Plan:   ${n.plan}`,
      ``,
      `Additional requests through the Spanlens proxy will receive 429 (Too Many Requests)`,
      `until your billing period renews, or until you upgrade.`,
      ``,
      `Upgrade: ${n.billingUrl}`,
    ].join('\n')
  }
  return [
    `${n.organizationName} has used 80% of this month's request quota.`,
    ``,
    `Usage:  ${n.used.toLocaleString()} / ${n.limit.toLocaleString()} requests (${pct}%)`,
    `Plan:   ${n.plan}`,
    ``,
    `Upgrade anytime to avoid 429s when you hit the cap:`,
    `${n.billingUrl}`,
  ].join('\n')
}

export async function sendQuotaWarningEmail(
  toAddress: string,
  notification: QuotaWarningNotification,
): Promise<DeliveryResult> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const fromAddress = process.env['RESEND_FROM_EMAIL'] ?? 'alerts@spanlens.io'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        subject: buildQuotaSubject(notification),
        text: buildQuotaBody(notification),
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// Exported for testing (no network side effects)
export const __testing = { buildQuotaSubject, buildQuotaBody }

export async function deliverToChannel(
  kind: 'email' | 'slack' | 'discord',
  target: string,
  notification: AlertNotification,
): Promise<DeliveryResult> {
  if (kind === 'email') return sendEmailAlert(target, notification)
  if (kind === 'slack') return sendSlackAlert(target, notification)
  return sendDiscordAlert(target, notification)
}
