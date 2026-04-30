/**
 * Thin Resend wrapper. No SDK — one HTTP POST keeps the dep list small.
 *
 * Dev fallback: if RESEND_API_KEY is missing, we log the email to stdout
 * (including any accept/action URL) so local dev flows still work without
 * an outbound email provider. Production MUST set RESEND_API_KEY.
 */

interface SendEmailInput {
  to: string
  subject: string
  html: string
  /** Optional — surfaces in server logs during dev fallback. */
  devPreviewUrl?: string
}

const FROM = process.env.RESEND_FROM ?? 'Spanlens <notifications@spanlens.io>'

export async function sendEmail(input: SendEmailInput): Promise<{ sent: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Dev fallback: print the essentials. This intentionally does NOT log the
    // full HTML — too noisy. The accept URL is the one thing devs actually need.
    // eslint-disable-next-line no-console
    console.log(`[email-dev] to=${input.to} subject="${input.subject}"` +
      (input.devPreviewUrl ? ` url=${input.devPreviewUrl}` : ''))
    return { sent: false }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { sent: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` }
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string }
  return body.id ? { sent: true, id: body.id } : { sent: true }
}

export function renderInvitationEmail(params: {
  orgName: string
  inviterEmail: string
  role: string
  acceptUrl: string
}): { subject: string; html: string } {
  const { orgName, inviterEmail, role, acceptUrl } = params
  const subject = `You're invited to ${orgName} on Spanlens`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="margin: 0 0 16px; font-size: 20px;">You're invited to <strong>${escapeHtml(orgName)}</strong></h2>
      <p style="margin: 0 0 12px; color: #555;">${escapeHtml(inviterEmail)} invited you to join their Spanlens workspace as <strong>${escapeHtml(role)}</strong>.</p>
      <p style="margin: 24px 0;"><a href="${acceptUrl}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500;">Accept invitation</a></p>
      <p style="margin: 16px 0 0; color: #888; font-size: 13px;">Or copy this link: <br/><span style="word-break: break-all;">${acceptUrl}</span></p>
      <p style="margin: 24px 0 0; color: #aaa; font-size: 12px;">This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.</p>
    </div>
  `.trim()
  return { subject, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function ageString(isoOrNull: string | null, fallbackIso: string): string {
  const ref = isoOrNull ?? fallbackIso
  const days = Math.floor((Date.now() - Date.parse(ref)) / 86_400_000)
  if (isoOrNull == null) return `never used (created ${days}d ago)`
  return `last used ${days}d ago`
}

export function renderStaleKeyDigestEmail(params: {
  orgName: string
  thresholdDays: number
  keys: Array<{ name: string; provider: string; last_used_at: string | null; created_at: string }>
  dashboardUrl: string
}): { subject: string; html: string } {
  const { orgName, thresholdDays, keys, dashboardUrl } = params
  const subject = `[Spanlens] ${keys.length} unused provider key${keys.length === 1 ? '' : 's'} in '${orgName}'`

  const rows = keys
    .map((k) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-family: ui-monospace, monospace; font-size: 13px;">${escapeHtml(k.name)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-family: ui-monospace, monospace; font-size: 12px; color: #666;">${escapeHtml(k.provider)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 12px; color: #666;">${escapeHtml(ageString(k.last_used_at, k.created_at))}</td>
      </tr>`)
    .join('')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="margin: 0 0 8px; font-size: 19px;">Unused provider keys in <strong>${escapeHtml(orgName)}</strong></h2>
      <p style="margin: 0 0 18px; color: #555; font-size: 14px;">
        The following ${keys.length} key${keys.length === 1 ? ' has' : 's have'} not been used in <strong>${thresholdDays}+ days</strong>.
        For security, consider deleting any keys you no longer need.
      </p>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #eee; border-radius: 6px; overflow: hidden;">
        <thead>
          <tr style="background: #fafafa;">
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 1px solid #eee;">Name</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 1px solid #eee;">Provider</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 1px solid #eee;">Last activity</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin: 22px 0;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 13px;">Review keys in dashboard</a>
      </p>
      <p style="margin: 18px 0 0; color: #aaa; font-size: 11.5px;">
        Notification-only — Spanlens never auto-revokes keys.
        To stop these reminders: Settings → Provider keys → Stale key reminders.
      </p>
    </div>
  `.trim()

  return { subject, html }
}

export function renderSecurityAlertEmail(params: {
  orgName: string
  projectName: string
  requestFlags: Array<{ type: string; pattern: string; sample: string }>
  responseFlags: Array<{ type: string; pattern: string; sample: string }>
  dashboardUrl: string
}): { subject: string; html: string } {
  const { orgName, projectName, requestFlags, responseFlags, dashboardUrl } = params

  const allFlags = [
    ...requestFlags.map((f) => ({ ...f, direction: 'Request' as const })),
    ...responseFlags.map((f) => ({ ...f, direction: 'Response' as const })),
  ]

  const hasInjection = allFlags.some((f) => f.type === 'injection')
  const subject = hasInjection
    ? `[Spanlens] ⚠️ Prompt injection detected in '${projectName}'`
    : `[Spanlens] 🔍 PII detected in '${projectName}'`

  const flagRows = allFlags
    .map((f) => `
      <tr>
        <td style="padding: 7px 12px; border-bottom: 1px solid #eee; font-size: 12px; color: #666;">${escapeHtml(f.direction)}</td>
        <td style="padding: 7px 12px; border-bottom: 1px solid #eee; font-family: ui-monospace, monospace; font-size: 11px;">
          <span style="display: inline-block; padding: 2px 6px; border-radius: 3px; border: 1px solid ${f.type === 'injection' ? '#fca5a5' : '#e5e7eb'}; background: ${f.type === 'injection' ? '#fef2f2' : '#f9fafb'}; color: ${f.type === 'injection' ? '#991b1b' : '#6b7280'}; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em;">${escapeHtml(f.type)}</span>
          &nbsp;${escapeHtml(f.pattern)}
        </td>
        <td style="padding: 7px 12px; border-bottom: 1px solid #eee; font-family: ui-monospace, monospace; font-size: 11px; color: #9ca3af;">${escapeHtml(f.sample)}</td>
      </tr>`)
    .join('')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111;">
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-bottom: 18px;">
        <div style="font-weight: 600; font-size: 14px; color: #991b1b; margin-bottom: 4px;">Security event detected</div>
        <div style="font-size: 13px; color: #7f1d1d;">
          ${escapeHtml(String(allFlags.length))} flag${allFlags.length === 1 ? '' : 's'} found in project <strong>${escapeHtml(projectName)}</strong> (${escapeHtml(orgName)}).
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #eee; border-radius: 6px; overflow: hidden; margin-bottom: 18px;">
        <thead>
          <tr style="background: #fafafa;">
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 1px solid #eee;">Direction</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 1px solid #eee;">Type · Pattern</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 1px solid #eee;">Sample (masked)</th>
          </tr>
        </thead>
        <tbody>${flagRows}</tbody>
      </table>
      <p style="margin: 18px 0;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 13px;">View in Security dashboard</a>
      </p>
      <p style="margin: 18px 0 0; color: #aaa; font-size: 11.5px;">
        Spanlens flags only — no requests are blocked unless you enable Block mode.
        To stop these emails: Security → Alert emails → off.
      </p>
    </div>
  `.trim()

  return { subject, html }
}

export function renderLeakAlertEmail(params: {
  orgName: string
  keyName: string
  provider: string
  detectedAt: string
  dashboardUrl: string
}): { subject: string; html: string } {
  const { orgName, keyName, provider, detectedAt, dashboardUrl } = params
  const subject = `[Spanlens] 🚨 Provider key '${keyName}' may be leaked`

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; color: #111;">
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-bottom: 18px;">
        <div style="font-weight: 600; font-size: 14px; color: #991b1b; margin-bottom: 4px;">⚠ Possible secret exposure detected</div>
        <div style="font-size: 13px; color: #7f1d1d;">A provider key in <strong>${escapeHtml(orgName)}</strong> matched a known-leaked-secrets database.</div>
      </div>
      <table style="width: 100%; font-size: 13px; margin-bottom: 16px;">
        <tr><td style="padding: 4px 0; color: #888; width: 110px;">Key</td><td style="font-family: ui-monospace, monospace;"><strong>${escapeHtml(keyName)}</strong></td></tr>
        <tr><td style="padding: 4px 0; color: #888;">Provider</td><td style="font-family: ui-monospace, monospace;">${escapeHtml(provider)}</td></tr>
        <tr><td style="padding: 4px 0; color: #888;">Detected at</td><td style="font-family: ui-monospace, monospace;">${escapeHtml(detectedAt)}</td></tr>
        <tr><td style="padding: 4px 0; color: #888;">Source</td><td>GitGuardian (HasMySecretLeaked)</td></tr>
      </table>
      <p style="margin: 0 0 14px; color: #444; font-size: 13.5px;">
        <strong>Recommended action:</strong> rotate or revoke this key in the dashboard immediately.
        Spanlens will not auto-revoke — admins decide.
      </p>
      <p style="margin: 18px 0;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 18px; background: #b91c1c; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 13px;">Review in dashboard</a>
      </p>
      <p style="margin: 18px 0 0; color: #aaa; font-size: 11.5px;">
        False positives are possible — verify before revoking. The k-anonymity check transmits only a 5-char hash prefix to GitGuardian, never the key itself.
      </p>
    </div>
  `.trim()

  return { subject, html }
}
