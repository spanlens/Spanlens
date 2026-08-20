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

async function attemptSend(input: SendEmailInput, apiKey: string): Promise<{ sent: boolean; id?: string; error?: string }> {
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
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { sent: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` }
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string }
  return body.id ? { sent: true, id: body.id } : { sent: true }
}

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

  // One retry on network errors (ECONNRESET, timeout, etc.)
  try {
    return await attemptSend(input, apiKey)
  } catch (err) {
    const isNetworkErr = err instanceof TypeError || (err as NodeJS.ErrnoException).code === 'ECONNRESET'
    if (!isNetworkErr) return { sent: false, error: String(err) }
    // Wait 1s then retry once
    await new Promise((r) => setTimeout(r, 1000))
    return attemptSend(input, apiKey)
  }
}

// ── Email design kit ────────────────────────────────────────────
//
// Ported from the Figma `Emails` page (frames E1 to E4). Every template
// below is assembled from the same chrome: a #F3F3F6 canvas, a 600px white
// card with a 14px radius, a wordmark header, a 16px-gapped content stack,
// and a sunk footer.
//
// Constraints this kit works under, all of them deliberate:
//   • Literal hex only. Email clients do not resolve CSS variables.
//   • Inline styles only, plus table-based layout, because Outlook renders
//     through Word and drops external stylesheets, flexbox, and grid.
//   • System font stacks. Web fonts are unreliable and Outlook ignores them,
//     so Schibsted Grotesk and Geist degrade to the platform sans, and the
//     figures and small labels use the platform mono.
//   • Vertical rhythm comes from cell padding rather than margins, since the
//     Word engine honours padding far more consistently.
//
// Light palette only. These functions return a body fragment with no <head>,
// so there is nowhere to hang a `prefers-color-scheme` block, and the dark
// frames are a recolour of the same layout rather than a different one.
// Clients that force dark mode invert this palette themselves.

/** Figma `Emails` colour tokens, flattened to literal hex for mail clients. */
const C = {
  canvas: '#F3F3F6',
  card: '#FFFFFF',
  hairline: '#E2E2E8',
  sunk: '#FAFAFB',
  sunkLine: '#EDEDF1',
  ink: '#101114',
  inkMono: '#2A2D33',
  inkSoft: '#5A6068',
  faint: '#6B7078',
  accent: '#D0350F',
  onAccent: '#FFFFFF',
  ok: '#1F6E45',
  okTint: '#E7F5EC',
  warn: '#8A5A00',
  warnTint: '#FFF3DB',
  error: '#B32C0A',
  errorTint: '#FDEAE4',
  /** Accent-tinted callout (E2 savings card). */
  noteTint: '#FFF7F4',
  noteLine: '#F3DDD2',
  noteBody: '#8A5A48',
  bullet: '#C2C2BB',
} as const

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

/** Semantic colour pairs for status bars, tiles, and change rows. */
export type EmailTone = 'neutral' | 'ok' | 'warn' | 'error'

function toneInk(tone: EmailTone): string {
  if (tone === 'ok') return C.ok
  if (tone === 'warn') return C.warn
  if (tone === 'error') return C.error
  return C.ink
}

function toneTint(tone: EmailTone): string {
  if (tone === 'ok') return C.okTint
  if (tone === 'warn') return C.warnTint
  if (tone === 'error') return C.errorTint
  return C.canvas
}

/**
 * The 16px-gapped content stack from every frame's `Content` auto-layout.
 * Gaps are cell padding, not margins, so Outlook keeps the rhythm.
 */
function contentStack(blocks: Array<string | null | undefined | false>): string {
  const rows = blocks.filter((b): b is string => Boolean(b))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">${rows
    .map((b, i) => `<tr><td style="padding: 0 0 ${i === rows.length - 1 ? '0' : '16px'};">${b}</td></tr>`)
    .join('')}</table>`
}

/**
 * Outer canvas + 600px body card + wordmark header + footer.
 *
 * `footnotes` are the sunk grey lines at the bottom of each frame; they are
 * HTML because several carry links, so callers escape their own values.
 */
export function emailShell(params: { blocks: Array<string | null | undefined | false>; footnotes: string[] }): string {
  const { blocks, footnotes } = params
  // The Figma header pairs a 24px mark with the wordmark. Remote images are
  // blocked by default in most clients, so the wordmark carries the header
  // alone rather than leaving a broken-image gap.
  const header = `<span style="font-family: ${SANS}; font-size: 15px; font-weight: 800; letter-spacing: -0.3px; line-height: 1.6; color: ${C.ink};">spanlens</span>`

  const footer = footnotes
    .map((line, i) => `<div style="font-family: ${SANS}; font-size: 11.5px; line-height: 1.65; color: ${C.faint};${i > 0 ? ' padding-top: 8px;' : ''}">${line}</div>`)
    .join('')

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="width: 100%; border-collapse: collapse; background: ${C.canvas};">
      <tr>
        <td align="center" style="padding: 32px 20px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width: 600px; max-width: 600px; border-collapse: separate; background: ${C.card}; border: 1px solid ${C.hairline}; border-radius: 14px;">
            <tr>
              <td style="padding: 24px 32px 20px;">${header}</td>
            </tr>
            <tr>
              <td style="padding: 4px 32px 28px;">${contentStack(blocks)}</td>
            </tr>
            <tr>
              <td bgcolor="${C.sunk}" style="padding: 20px 32px 24px; background: ${C.sunk}; border-top: 1px solid ${C.sunkLine}; border-radius: 0 0 14px 14px;">${footer}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `.trim()
}

/** 24px display heading (E1/E2/E4 title). */
function emailHeading(text: string): string {
  return `<div style="font-family: ${SANS}; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.18; color: ${C.ink};">${escapeHtml(text)}</div>`
}

/** Faint one-line subtitle under a heading (org and period, for example). */
function emailSubhead(text: string): string {
  return `<div style="font-family: ${SANS}; font-size: 12.5px; line-height: 1.6; color: ${C.faint};">${escapeHtml(text)}</div>`
}

/**
 * Body copy. Takes HTML rather than plain text because several ledes carry
 * `<strong>` and links, so the caller escapes its own interpolations.
 */
export function emailParagraph(html: string, opts?: { tone?: EmailTone }): string {
  const color = opts?.tone ? toneInk(opts.tone) : C.inkSoft
  return `<div style="font-family: ${SANS}; font-size: 14px; line-height: 1.6; color: ${color};">${html}</div>`
}

/** Tinted state bar with a leading dot (E3 severity, E4 warning). */
export function emailStatusBar(tone: EmailTone, label: string): string {
  const ink = toneInk(tone)
  const tint = toneTint(tone)
  const dot = tone === 'neutral' ? C.faint : ink
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: separate;">
      <tr>
        <td bgcolor="${tint}" style="background: ${tint}; border-radius: 12px; padding: 12px 14px; font-family: ${SANS}; font-size: 12.5px; font-weight: 600; line-height: 1.6; color: ${ink};">
          <span style="display: inline-block; width: 8px; height: 8px; font-size: 0; line-height: 8px; border-radius: 8px; background: ${dot}; vertical-align: middle;"></span><span style="vertical-align: middle;">&nbsp;&nbsp;${escapeHtml(label)}</span>
        </td>
      </tr>
    </table>`
}

/** Label/value rows in a sunk card (E1 details, E3 leak facts). */
export function emailDetailCard(rows: Array<{ label: string; value: string }>): string {
  const body = rows
    .map(
      (r) => `<tr>
          <td style="padding: 4px 0; font-family: ${SANS}; font-size: 12.5px; font-weight: 500; line-height: 1.6; color: ${C.faint};">${escapeHtml(r.label)}</td>
          <td align="right" style="padding: 4px 0; text-align: right; font-family: ${MONO}; font-size: 12.5px; line-height: 1.6; color: ${C.inkMono};">${escapeHtml(r.value)}</td>
        </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.sunk}" style="width: 100%; border-collapse: separate; background: ${C.sunk}; border: 1px solid ${C.sunkLine}; border-radius: 12px;">
      <tr>
        <td style="padding: 14px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">${body}</table>
        </td>
      </tr>
    </table>`
}

/** Row of sunk figure tiles (E2 stats, E3 alert numbers). */
function emailStatTiles(tiles: Array<{ label: string; value: string; tone?: EmailTone }>): string {
  const width = `${Math.floor(100 / tiles.length)}%`
  const cells = tiles
    .map((t, i) => {
      const spacer = i === 0 ? '' : `<td width="10" style="width: 10px; font-size: 0; line-height: 0;">&nbsp;</td>`
      return `${spacer}<td valign="top" width="${width}" style="width: ${width};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.sunk}" style="width: 100%; border-collapse: separate; background: ${C.sunk}; border: 1px solid ${C.sunkLine}; border-radius: 12px;">
            <tr>
              <td style="padding: 14px;">
                <div style="font-family: ${MONO}; font-size: 10px; letter-spacing: 1px; line-height: 1.6; color: ${C.faint}; text-transform: uppercase;">${escapeHtml(t.label)}</div>
                <div style="font-family: ${SANS}; font-size: 19px; font-weight: 800; letter-spacing: -0.4px; line-height: 1.1; color: ${toneInk(t.tone ?? 'neutral')}; padding-top: 5px;">${escapeHtml(t.value)}</div>
              </td>
            </tr>
          </table>
        </td>`
    })
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tr>${cells}</tr></table>`
}

/** Bordered list of "label, then a coloured verdict" rows (E2 changes). */
function emailChangeList(rows: Array<{ label: string; value: string; tone?: EmailTone }>): string {
  const body = rows
    .map((r, i) => {
      const divider = i === rows.length - 1 ? '' : ` border-bottom: 1px solid ${C.sunkLine};`
      return `<tr>
          <td style="padding: 12px 16px;${divider} font-family: ${SANS}; font-size: 13px; font-weight: 500; line-height: 1.6; color: ${C.ink};">${escapeHtml(r.label)}</td>
          <td align="right" style="padding: 12px 16px;${divider} text-align: right; font-family: ${SANS}; font-size: 12.5px; line-height: 1.6; color: ${toneInk(r.tone ?? 'neutral')};">${escapeHtml(r.value)}</td>
        </tr>`
    })
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="width: 100%; border-collapse: separate; background: ${C.card}; border: 1px solid ${C.sunkLine}; border-radius: 12px;">${body}</table>`
}

/** Sunk card with a title and a sentence, for a single aside. */
function emailInfoCard(title: string, bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.sunk}" style="width: 100%; border-collapse: separate; background: ${C.sunk}; border: 1px solid ${C.sunkLine}; border-radius: 12px;">
      <tr>
        <td style="padding: 14px 16px;">
          <div style="font-family: ${SANS}; font-size: 12.5px; font-weight: 600; line-height: 1.6; color: ${C.ink};">${escapeHtml(title)}</div>
          <div style="font-family: ${SANS}; font-size: 12.5px; line-height: 1.6; color: ${C.inkSoft}; padding-top: 8px;">${bodyHtml}</div>
        </td>
      </tr>
    </table>`
}

/** Accent-tinted callout with a title and a sentence (E2 savings). */
function emailNoteCard(title: string, bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.noteTint}" style="width: 100%; border-collapse: separate; background: ${C.noteTint}; border: 1px solid ${C.noteLine}; border-radius: 12px;">
      <tr>
        <td style="padding: 14px 16px;">
          <div style="font-family: ${SANS}; font-size: 13.5px; font-weight: 600; line-height: 1.6; color: ${C.error};">${escapeHtml(title)}</div>
          <div style="font-family: ${SANS}; font-size: 12.5px; line-height: 1.6; color: ${C.noteBody}; padding-top: 8px;">${bodyHtml}</div>
        </td>
      </tr>
    </table>`
}

/**
 * Sunk card holding a heading and either bulleted lines (E4 checklist) or
 * term/description pairs (E3 factors). `term` is rendered in mono.
 */
function emailListCard(
  title: string,
  items: Array<{ term?: string; text: string }>,
): string {
  const lines = items
    .map((it) => {
      const lead = it.term
        ? `<span style="font-family: ${MONO}; font-size: 12px; line-height: 1.6; color: ${C.inkMono};">${escapeHtml(it.term)}</span>&nbsp;&nbsp;`
        : `<span style="display: inline-block; width: 5px; height: 5px; font-size: 0; line-height: 5px; border-radius: 5px; background: ${C.bullet}; vertical-align: middle;"></span>&nbsp;&nbsp;`
      return `<tr><td style="padding-top: 10px; font-family: ${SANS}; font-size: 12.5px; line-height: 1.6; color: ${it.term ? C.faint : C.inkMono};">${lead}<span style="vertical-align: middle;">${escapeHtml(it.text)}</span></td></tr>`
    })
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.sunk}" style="width: 100%; border-collapse: separate; background: ${C.sunk}; border: 1px solid ${C.sunkLine}; border-radius: 12px;">
      <tr>
        <td style="padding: 14px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
            <tr><td style="font-family: ${SANS}; font-size: 12.5px; font-weight: 600; line-height: 1.6; color: ${C.ink};">${escapeHtml(title)}</td></tr>
            ${lines}
          </table>
        </td>
      </tr>
    </table>`
}

interface EmailColumn {
  label: string
  align?: 'left' | 'right'
  /** Render the cell in mono. Used for model names, key names, patterns. */
  mono?: boolean
  /** Dim the cell. Used for secondary columns like provider or sample. */
  dim?: boolean
}

/**
 * Data table in the frame palette: mono uppercase header on the sunk fill,
 * hairline dividers, no divider under the last row so the rounded corner
 * stays clean. `cells` are plain text and escaped here.
 */
function emailDataTable(columns: EmailColumn[], rows: string[][]): string {
  const head = columns
    .map(
      (col) => `<th align="${col.align ?? 'left'}" style="padding: 10px 14px; text-align: ${col.align ?? 'left'}; background: ${C.sunk}; border-bottom: 1px solid ${C.sunkLine}; font-family: ${MONO}; font-size: 10px; font-weight: 400; letter-spacing: 1px; line-height: 1.6; color: ${C.faint}; text-transform: uppercase;">${escapeHtml(col.label)}</th>`,
    )
    .join('')

  const body = rows
    .map((cells, r) => {
      const divider = r === rows.length - 1 ? '' : ` border-bottom: 1px solid ${C.sunkLine};`
      const tds = cells
        .map((cell, i) => {
          const col = columns[i]
          const align = col?.align ?? 'left'
          return `<td align="${align}" style="padding: 10px 14px;${divider} text-align: ${align}; font-family: ${col?.mono ? MONO : SANS}; font-size: 12px; line-height: 1.6; color: ${col?.dim ? C.faint : C.inkMono};">${escapeHtml(cell)}</td>`
        })
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')

  // `separate` rather than `collapse`: collapsing drops the outer radius in
  // every browser and webmail, leaving the table looking unframed.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid ${C.sunkLine}; border-radius: 12px; overflow: hidden;">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`
}

/** Section label above a table. */
function emailSectionLabel(text: string): string {
  return `<div style="font-family: ${SANS}; font-size: 13px; font-weight: 600; line-height: 1.6; color: ${C.ink};">${escapeHtml(text)}</div>`
}

/** Accent pill CTA. */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;">
      <tr>
        <td bgcolor="${C.accent}" style="background: ${C.accent}; border-radius: 999px;">
          <a href="${escapeHtml(href)}" style="display: inline-block; padding: 13px 22px; font-family: ${SANS}; font-size: 14px; font-weight: 600; line-height: 1.6; color: ${C.onAccent}; text-decoration: none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`
}

/** Small mono line for a pasteable URL (E1). */
function emailMonoNote(prefix: string, value: string): string {
  return `<div style="font-family: ${MONO}; font-size: 11.5px; line-height: 1.6; color: ${C.faint}; word-break: break-all;">${escapeHtml(prefix)} ${escapeHtml(value)}</div>`
}

/** Inline mono run, for model names inside a sentence. */
function mono(text: string): string {
  return `<span style="font-family: ${MONO};">${escapeHtml(text)}</span>`
}

/** Inline link in body copy. */
function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" style="color: ${C.accent}; text-decoration: underline;">${escapeHtml(text)}</a>`
}

// ── Templates ───────────────────────────────────────────────────

export function renderInvitationEmail(params: {
  orgName: string
  inviterEmail: string
  role: string
  acceptUrl: string
}): { subject: string; html: string } {
  const { orgName, inviterEmail, role, acceptUrl } = params
  const subject = `You're invited to ${orgName} on Spanlens`
  // PLG Loop ⑤ — quiet brand footer. The invitee often hasn't heard of Spanlens
  // before; one informational line tells them what they've been invited into
  // without acting like an ad. Tone matches the waitlist email's closing.
  // utm tags identify invite-driven traffic in marketing analytics.
  const brandLink =
    'https://www.spanlens.io?utm_source=invite_email&utm_medium=email&utm_campaign=plg'

  const html = emailShell({
    blocks: [
      emailHeading(`You're invited to ${orgName}`),
      emailParagraph(
        `${escapeHtml(inviterEmail)} invited you to join their Spanlens workspace as <strong>${escapeHtml(role)}</strong>.`,
      ),
      emailDetailCard([
        { label: 'Workspace', value: orgName },
        { label: 'Invited by', value: inviterEmail },
        { label: 'Role', value: role },
      ]),
      emailButton(acceptUrl, 'Accept invitation'),
      emailMonoNote('Or copy this link:', acceptUrl),
    ],
    footnotes: [
      'This invitation expires in 7 days. If you weren&#39;t expecting it, you can safely ignore this email.',
      `${link(brandLink, 'Spanlens')} is open-source LLM observability.`,
    ],
  })
  return { subject, html }
}

export function renderWaitlistConfirmationEmail(): { subject: string; html: string } {
  const subject = "You're on the Spanlens waitlist"
  const demoUrl = 'https://www.spanlens.io/demo/dashboard'

  const html = emailShell({
    blocks: [
      emailHeading("You're on the list 🎉"),
      emailParagraph(
        'Thanks for signing up. You&#39;re on the Spanlens early access list. ' +
          'We&#39;re launching on <strong>June 3, 2026</strong> and we&#39;ll send your ' +
          'access link the moment we go live.',
      ),
      emailInfoCard(
        'Try the live demo while you wait',
        'The full Spanlens dashboard is available right now in demo mode. You can ' +
          'explore request logs, agent traces, cost tracking, and anomaly ' +
          'detection with sample data. No signup required.',
      ),
      emailButton(demoUrl, 'Explore the live demo →'),
      emailParagraph(
        `Questions? Reply to this email or reach us at ${link('mailto:hi@spanlens.io', 'hi@spanlens.io')}.<br/>Thanks,<br/>The Spanlens team`,
      ),
    ],
    footnotes: [
      'You received this because you joined the Spanlens waitlist. We&#39;ll only email you once more, on launch day.',
    ],
  })

  return { subject, html }
}

export function escapeHtml(s: string): string {
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

  const html = emailShell({
    blocks: [
      emailHeading(`Unused provider keys in ${orgName}`),
      emailParagraph(
        `The following ${keys.length} key${keys.length === 1 ? ' has' : 's have'} not been used in <strong>${thresholdDays}+ days</strong>. ` +
          'For security, consider deleting any keys you no longer need.',
      ),
      emailDataTable(
        [
          { label: 'Name', mono: true },
          { label: 'Provider', mono: true, dim: true },
          { label: 'Last activity', dim: true },
        ],
        keys.map((k) => [k.name, k.provider, ageString(k.last_used_at, k.created_at)]),
      ),
      emailButton(dashboardUrl, 'Review keys in dashboard'),
    ],
    footnotes: [
      'Spanlens never auto-revokes keys. This is a reminder only.',
      'To stop these reminders: Settings → Provider keys → Stale key reminders.',
    ],
  })

  return { subject, html }
}

/**
 * "Data went silent" retention alert. Sent once per silence episode by
 * lib/data-silence.ts when an org with steady prior traffic stops sending
 * requests entirely. Copy is intentionally diagnostic: the most common
 * cause is a broken integration the customer has not noticed yet.
 */
export function renderDataSilenceEmail(params: {
  orgName: string
  /** ISO-8601 UTC timestamp of the last request we received, or null. */
  lastRequestAt: string | null
  priorWeekRequests: number
  silenceWindowHours: number
  dashboardUrl: string
  quickStartUrl: string
}): { subject: string; html: string } {
  const { orgName, lastRequestAt, priorWeekRequests, silenceWindowHours, dashboardUrl, quickStartUrl } = params
  const subject = `Spanlens has not received data from ${orgName} in ${silenceWindowHours} hours`

  const lastSeenLabel = lastRequestAt
    ? new Date(lastRequestAt).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
      })
    : 'unknown'

  const html = emailShell({
    blocks: [
      emailStatusBar('warn', `No data received in the last ${silenceWindowHours} hours`),
      emailHeading(`Spanlens stopped receiving requests from ${orgName}`),
      emailParagraph(
        `Your workspace logged <strong>${escapeHtml(priorWeekRequests.toLocaleString('en-US'))} requests</strong> over the previous 7 days, ` +
          `but nothing has arrived in the last ${silenceWindowHours} hours. ` +
          `The last request we received was at <strong>${escapeHtml(lastSeenLabel)}</strong>.`,
      ),
      emailListCard('If this drop is unexpected, the usual causes are:', [
        { text: 'Your Spanlens API key was rotated or removed, so requests are being rejected.' },
        { text: 'A recent deploy dropped the baseURL override or the environment variable that points traffic at Spanlens.' },
        { text: 'Your provider key (OpenAI, Anthropic, or Gemini) was revoked, so calls fail before they reach us.' },
      ]),
      emailButton(dashboardUrl, 'Open the requests dashboard'),
      emailParagraph(
        `Need to re-check your setup? The ${link(quickStartUrl, 'quick-start guide')} walks through the baseURL change and key configuration in a couple of minutes.`,
      ),
    ],
    footnotes: [
      'You will not receive another email for this incident. If traffic resumes and stops again later, we will let you know.',
    ],
  })

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

  const html = emailShell({
    blocks: [
      emailStatusBar('error', 'Security event detected'),
      // The heading restates the subject's injection/PII split. The flag table
      // shows the type per row, but the reader needs the worse of the two up
      // front, the way E3 leads with the rule that fired.
      emailHeading(hasInjection ? 'Prompt injection detected' : 'PII detected'),
      emailParagraph(
        `${escapeHtml(String(allFlags.length))} flag${allFlags.length === 1 ? '' : 's'} found in project <strong>${escapeHtml(projectName)}</strong> (${escapeHtml(orgName)}).`,
      ),
      emailDataTable(
        [
          { label: 'Direction', dim: true },
          { label: 'Type · Pattern', mono: true },
          { label: 'Sample (masked)', mono: true, dim: true },
        ],
        allFlags.map((f) => [f.direction, `${f.type.toUpperCase()} ${f.pattern}`, f.sample]),
      ),
      emailButton(dashboardUrl, 'View in Security dashboard'),
    ],
    footnotes: [
      'Spanlens flags events without blocking them, unless you enable Block mode.',
      'To stop these emails: Security → Alert emails → off.',
    ],
  })

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

  const html = emailShell({
    blocks: [
      emailStatusBar('error', 'Possible secret exposure detected'),
      emailParagraph(
        `A provider key in <strong>${escapeHtml(orgName)}</strong> matched a known-leaked-secrets database.`,
      ),
      emailDetailCard([
        { label: 'Key', value: keyName },
        { label: 'Provider', value: provider },
        { label: 'Detected at', value: detectedAt },
        { label: 'Source', value: 'GitGuardian (HasMySecretLeaked)' },
      ]),
      emailParagraph(
        '<strong>Recommended action:</strong> rotate or revoke this key in the dashboard immediately. ' +
          'Spanlens will not auto-revoke, so admins decide.',
      ),
      emailButton(dashboardUrl, 'Review in dashboard'),
    ],
    footnotes: [
      'False positives are possible, so verify before revoking.',
      'The k-anonymity check transmits only a 5-char hash prefix to GitGuardian, never the key itself.',
    ],
  })

  return { subject, html }
}

/**
 * P2.7 — past_due warning + auto-downgrade notification.
 *
 * Three flavours, picked by `params.stage`:
 *   • 'warning-d3' — payment failed 4 days ago, 3 days until auto-downgrade
 *   • 'warning-d1' — 6 days ago, 1 day until auto-downgrade
 *   • 'downgraded' — sent immediately after the cron flips the org to free
 *
 * Tone: calm reminder, not dunning. Most past_due is an expired card.
 */
/** "$12.34" under $100, "$1,234" above — keeps subjects short and scannable. */
function formatUsd(n: number): string {
  if (n >= 100) return `$${Math.round(n).toLocaleString('en-US')}`
  return `$${n.toFixed(2)}`
}

/**
 * Weekly usage digest. Sent Monday 09:00 UTC by lib/weekly-digest.ts to org
 * admins who keep the `weekly_digest_emails` preference on. Copy avoids em
 * dashes entirely (external-text policy).
 */
export function renderWeeklyDigestEmail(params: {
  orgName: string
  /** Human window label, e.g. "Jun 29 to Jul 5". */
  periodLabel: string
  requestCount: number
  totalCostUsd: number
  /** Week-over-week cost change in percent; null = no prior week to compare. */
  costChangePct: number | null
  errorCount: number
  errorRatePct: number
  topModels: Array<{ provider: string; model: string; costUsd: number; requestCount: number }>
  /** Anomalies persisted this week; null = lookup unavailable, omit the line. */
  anomalyCount: number | null
  recommendation: {
    currentModel: string
    suggestedModel: string
    estimatedMonthlySavingsUsd: number
  } | null
  dashboardUrl: string
}): { subject: string; html: string } {
  const {
    orgName, periodLabel, requestCount, totalCostUsd, costChangePct,
    errorCount, errorRatePct, topModels, anomalyCount, recommendation, dashboardUrl,
  } = params

  const subject = `Your Spanlens week: ${requestCount.toLocaleString('en-US')} requests, ${formatUsd(totalCostUsd)}`

  let trendLine: string
  let trendTone: EmailTone = 'neutral'
  if (costChangePct === null) {
    trendLine = 'There is no prior week to compare against yet.'
  } else if (Math.abs(costChangePct) < 5) {
    trendLine = 'Spend is about the same as the week before.'
  } else if (costChangePct > 0) {
    trendLine = `Spend is up ${Math.round(costChangePct)}% from the week before.`
    trendTone = 'warn'
  } else {
    trendLine = `Spend is down ${Math.abs(Math.round(costChangePct))}% from the week before.`
    trendTone = 'ok'
  }

  const errorLine = errorCount === 0
    ? 'No failed requests this week.'
    : `${errorCount.toLocaleString('en-US')} failed request${errorCount === 1 ? '' : 's'} (${errorRatePct.toFixed(1)}% error rate).`

  // The tiles are the snapshot; the change rows carry the narrative. Both come
  // straight from the E2 frame, which pairs figure tiles with a verdict list.
  const changeRows: Array<{ label: string; value: string; tone?: EmailTone }> = [
    { label: 'Spend', value: trendLine, tone: trendTone },
    { label: 'Errors', value: errorLine, tone: errorCount === 0 ? 'ok' : 'neutral' },
  ]
  if (anomalyCount !== null && anomalyCount > 0) {
    changeRows.push({
      label: 'Anomalies',
      value: `${anomalyCount.toLocaleString('en-US')} anomal${anomalyCount === 1 ? 'y was' : 'ies were'} detected this week. Details are on the anomalies page in your dashboard.`,
      tone: 'warn',
    })
  }

  const modelsTable = topModels.length === 0
    ? null
    : contentStack([
        emailSectionLabel('Top models by cost'),
        emailDataTable(
          [
            { label: 'Model', mono: true },
            { label: 'Provider', mono: true, dim: true },
            { label: 'Requests', align: 'right', dim: true },
            { label: 'Cost', align: 'right' },
          ],
          topModels.map((m) => [
            m.model,
            m.provider,
            m.requestCount.toLocaleString('en-US'),
            formatUsd(m.costUsd),
          ]),
        ),
      ])

  const recommendationBlock = recommendation
    ? emailNoteCard(
        'Savings tip',
        `Moving eligible traffic from ${mono(recommendation.currentModel)} to ${mono(recommendation.suggestedModel)} ` +
          `could save about <strong>${escapeHtml(formatUsd(recommendation.estimatedMonthlySavingsUsd))} per month</strong>. ` +
          'See the savings page in your dashboard for details.',
      )
    : null

  const html = emailShell({
    blocks: [
      emailHeading('Your week on Spanlens'),
      emailSubhead(`${orgName} · ${periodLabel}`),
      emailStatTiles([
        { label: 'Requests', value: requestCount.toLocaleString('en-US') },
        { label: 'Spend', value: formatUsd(totalCostUsd) },
        { label: 'Errors', value: errorCount.toLocaleString('en-US'), tone: errorCount === 0 ? 'neutral' : 'error' },
      ]),
      emailChangeList(changeRows),
      modelsTable,
      recommendationBlock,
      emailButton(dashboardUrl, 'Open your dashboard'),
    ],
    footnotes: [
      'You receive this weekly summary because you admin this workspace.',
      'To stop it, turn off Weekly digest under Settings, Notifications.',
    ],
  })

  return { subject, html }
}

export function renderPastDueEmail(params: {
  orgName: string
  stage: 'warning-d3' | 'warning-d1' | 'downgraded'
  pastDueSince: string
  billingUrl: string
}): { subject: string; html: string } {
  const { orgName, stage, pastDueSince, billingUrl } = params
  const sinceLabel = new Date(pastDueSince).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  let subject: string
  let tone: EmailTone
  let headerTitle: string
  let body: string
  let ctaLabel: string

  if (stage === 'warning-d3') {
    subject = `[Spanlens] Payment failed, update your card to keep your plan`
    tone = 'warn'
    headerTitle = 'Payment failed'
    body = `
      Hi ${escapeHtml(orgName)} team,
      <br><br>
      Your most recent Spanlens invoice didn&apos;t go through, which usually means an
      expired or replaced card. We&apos;ll keep your plan active for <strong>3 more days</strong>;
      after that the workspace automatically drops to the Free plan and log
      retention shortens to 14 days.
      <br><br>
      Updating the card on file takes about 30 seconds and avoids any service
      change.
    `
    ctaLabel = 'Update payment method'
  } else if (stage === 'warning-d1') {
    subject = `[Spanlens] Last reminder, auto-downgrade in 24 hours`
    tone = 'error'
    headerTitle = 'Auto-downgrade in 24 hours'
    body = `
      Hi ${escapeHtml(orgName)} team,
      <br><br>
      We still haven&apos;t been able to charge the card on file (first failure on
      ${escapeHtml(sinceLabel)}). If we don&apos;t recover by tomorrow, the workspace
      drops to the Free plan and log retention shortens to 14 days.
      <br><br>
      You can re-upgrade at any time. This is just a heads-up so it isn&apos;t a
      surprise.
    `
    ctaLabel = 'Update payment method'
  } else {
    subject = `[Spanlens] Your workspace has been moved to the Free plan`
    tone = 'neutral'
    headerTitle = 'Plan changed to Free'
    body = `
      Hi ${escapeHtml(orgName)} team,
      <br><br>
      After 7 days without a successful payment (first failure
      ${escapeHtml(sinceLabel)}), we&apos;ve moved this workspace to the Free plan.
      Existing logs older than 14 days are no longer visible in the dashboard,
      but they remain in our database for a 7-day grace window. Re-upgrade in
      that time and they reappear automatically.
      <br><br>
      Nothing has been deleted yet. Your data, projects, API keys, and integrations
      are all intact. Only the plan tier changed.
    `
    ctaLabel = 'Re-upgrade'
  }

  const html = emailShell({
    blocks: [
      emailStatusBar(tone, headerTitle),
      emailParagraph(body.trim()),
      emailButton(billingUrl, ctaLabel),
    ],
    footnotes: ['Questions? Reply to this email and it goes straight to the team.'],
  })

  return { subject, html }
}
