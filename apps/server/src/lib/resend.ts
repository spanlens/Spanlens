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
