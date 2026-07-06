/**
 * Notification channel delivery — Resend (email) + Slack/Discord webhooks.
 *
 * Each function returns `{ ok: boolean, error?: string }`. Callers log the
 * result into `alert_deliveries`.
 */

import { escapeHtml } from './resend.js'

interface DeliveryResult {
  ok: boolean
  error?: string
}

export interface NotificationChannelRow {
  kind: 'email' | 'slack' | 'discord'
  target: string
}

export interface AlertNotification {
  alertName: string
  alertType: 'budget' | 'error_rate' | 'latency_p95' | 'eval_score'
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
  // eval_score is a normalized 0..1 quality score; show it as a percentage.
  if (type === 'eval_score') return `${(value * 100).toFixed(1)}%`
  return `${Math.round(value)}ms`
}

function buildSubject(n: AlertNotification): string {
  const verb =
    n.alertType === 'budget'
      ? 'Budget threshold'
      : n.alertType === 'error_rate'
        ? 'Error rate'
        : n.alertType === 'eval_score'
          ? 'Eval score'
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

// ── Email via Resend ───────────────────────────────────

export async function sendEmailAlert(
  toAddress: string,
  notification: AlertNotification,
): Promise<DeliveryResult> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const fromAddress = process.env['RESEND_FROM'] ?? 'alerts@spanlens.io'

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
      signal: AbortSignal.timeout(5000),
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
    n.alertType === 'budget'
      ? '#eab308'
      : n.alertType === 'error_rate'
        ? '#ef4444'
        : n.alertType === 'eval_score'
          ? '#a855f7'
          : '#f97316'
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
      signal: AbortSignal.timeout(5000),
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
      signal: AbortSignal.timeout(5000),
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
  /**
   * Pattern C: at 100%, is overage billing authorized on this org?
   * - true  — requests keep flowing, they'll be billed for overage
   * - false — requests are being rejected with 429 (free or user-disabled)
   */
  overageActive: boolean
  /** Hard cap = limit × overage_cap_multiplier. */
  hardCap: number
}

function buildQuotaSubject(n: QuotaWarningNotification): string {
  if (n.threshold === 100) {
    return n.overageActive
      ? `[Spanlens] Overage billing active for ${n.organizationName}`
      : `[Spanlens] Monthly request quota reached for ${n.organizationName}`
  }
  return `[Spanlens] ${n.organizationName} has used 80% of this month's quota`
}

function buildQuotaBody(n: QuotaWarningNotification): string {
  const pct = Math.floor((n.used / n.limit) * 100)

  if (n.threshold === 100) {
    if (n.overageActive) {
      return [
        `${n.organizationName} has passed its monthly request quota and overage billing is now active.`,
        ``,
        `Usage:     ${n.used.toLocaleString()} / ${n.limit.toLocaleString()} requests (${pct}%)`,
        `Plan:      ${n.plan}`,
        `Hard cap:  ${n.hardCap.toLocaleString()} requests (requests above this return 429)`,
        ``,
        `What happens now: your requests keep flowing. Additional requests beyond your`,
        `included quota will be billed on your next invoice at the overage rate for your`,
        `plan. Once usage reaches the hard cap, further requests are rejected with 429.`,
        ``,
        `Upgrade your plan to raise your included quota, or adjust overage settings:`,
        `${n.billingUrl}`,
      ].join('\n')
    }
    return [
      `${n.organizationName} has reached its monthly request quota.`,
      ``,
      `Usage:  ${n.used.toLocaleString()} / ${n.limit.toLocaleString()} requests (${pct}%)`,
      `Plan:   ${n.plan}`,
      ``,
      `What happens now: new requests through the Spanlens proxy are rejected with 429`,
      `(Too Many Requests) before they reach your provider, and they are not logged.`,
      `This continues until your quota resets next month, or until you upgrade your`,
      `plan or enable overage billing.`,
      ``,
      `Upgrade your plan: ${n.billingUrl}`,
    ].join('\n')
  }

  // 80% — include a note about whether overage will kick in at 100
  const tail = n.overageActive
    ? `Overage billing is enabled, so once you hit 100% extra requests will be billed on\nyour next invoice instead of being rejected. You can adjust this in ${n.billingUrl}.`
    : `Overage billing is disabled, so requests past 100% will be rejected with 429.`

  return [
    `${n.organizationName} has used 80% of this month's request quota.`,
    ``,
    `Usage:  ${n.used.toLocaleString()} / ${n.limit.toLocaleString()} requests (${pct}%)`,
    `Plan:   ${n.plan}`,
    ``,
    tail,
    ``,
    `You can raise your limit anytime: ${n.billingUrl}`,
  ].join('\n')
}

/**
 * HTML version of the quota warning, styled like the other resend.ts emails.
 * The 100% email carries a prominent "Upgrade your plan" button pointing at
 * the billing page; the 80% email uses the same link with softer copy.
 */
function buildQuotaHtml(n: QuotaWarningNotification): string {
  const pct = Math.floor((n.used / n.limit) * 100)
  const orgName = escapeHtml(n.organizationName)
  const usage = `${n.used.toLocaleString()} / ${n.limit.toLocaleString()} requests (${pct}%)`

  let headerBg: string
  let headerBorder: string
  let headerColor: string
  let headerTitle: string
  let body: string
  let ctaLabel: string

  if (n.threshold === 100) {
    headerBg = '#fef2f2'
    headerBorder = '#fecaca'
    headerColor = '#991b1b'
    if (n.overageActive) {
      headerTitle = 'Overage billing is now active'
      body = `
        <strong>${orgName}</strong> has passed its monthly request quota.
        Your requests keep flowing, and usage beyond the included quota will be billed
        on your next invoice at the overage rate for your plan. Once usage reaches the
        hard cap of ${n.hardCap.toLocaleString()} requests, further requests are rejected with 429.
      `
      ctaLabel = 'Upgrade your plan'
    } else {
      headerTitle = 'Monthly request quota reached'
      body = `
        <strong>${orgName}</strong> has reached its monthly request quota.
        New requests through the Spanlens proxy are rejected with 429 before they reach
        your provider, and they are not logged. This continues until your quota resets
        next month, or until you upgrade your plan or enable overage billing.
      `
      ctaLabel = 'Upgrade your plan'
    }
  } else {
    headerBg = '#fff7ed'
    headerBorder = '#fed7aa'
    headerColor = '#9a3412'
    headerTitle = "80% of this month's quota used"
    body = n.overageActive
      ? `
        <strong>${orgName}</strong> has used 80% of this month's request quota.
        Overage billing is enabled, so once you hit 100% extra requests will be billed
        on your next invoice instead of being rejected. You can raise your limit anytime.
      `
      : `
        <strong>${orgName}</strong> has used 80% of this month's request quota.
        Overage billing is disabled, so requests past 100% will be rejected with 429.
        You can raise your limit anytime.
      `
    ctaLabel = 'Review plans and usage'
  }

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; color: #111;">
      <div style="background: ${headerBg}; border: 1px solid ${headerBorder}; border-radius: 8px; padding: 14px 16px; margin-bottom: 18px;">
        <div style="font-weight: 600; font-size: 14px; color: ${headerColor};">${headerTitle}</div>
      </div>
      <p style="margin: 0 0 14px; color: #333; font-size: 13.5px; line-height: 1.55;">${body.trim()}</p>
      <table style="width: 100%; font-size: 13px; margin-bottom: 16px;">
        <tr><td style="padding: 4px 0; color: #888; width: 90px;">Usage</td><td style="font-family: ui-monospace, monospace;">${escapeHtml(usage)}</td></tr>
        <tr><td style="padding: 4px 0; color: #888;">Plan</td><td style="font-family: ui-monospace, monospace;">${escapeHtml(n.plan)}</td></tr>
      </table>
      <p style="margin: 22px 0;">
        <a href="${n.billingUrl}" style="display: inline-block; padding: 11px 20px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 13px;">${ctaLabel}</a>
      </p>
      <p style="margin: 18px 0 0; color: #aaa; font-size: 11.5px;">
        Questions about quotas or billing? Reply to this email and it goes straight to the team.
      </p>
    </div>
  `.trim()
}

export async function sendQuotaWarningEmail(
  toAddress: string,
  notification: QuotaWarningNotification,
): Promise<DeliveryResult> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const fromAddress = process.env['RESEND_FROM'] ?? 'alerts@spanlens.io'

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
        html: buildQuotaHtml(notification),
      }),
      signal: AbortSignal.timeout(5000),
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
export const __testing = { buildQuotaSubject, buildQuotaBody, buildQuotaHtml }

export async function deliverToChannel(
  kind: 'email' | 'slack' | 'discord',
  target: string,
  notification: AlertNotification,
): Promise<DeliveryResult> {
  if (kind === 'email') return sendEmailAlert(target, notification)
  if (kind === 'slack') return sendSlackAlert(target, notification)
  return sendDiscordAlert(target, notification)
}
