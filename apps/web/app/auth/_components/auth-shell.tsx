import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/*
 * Shared chrome for every authentication screen (login, signup, password
 * reset, email verification, MFA, CLI device grant, account lock, invite
 * accept, onboarding).
 *
 * Ported from the `Share & auth` board in Figma
 * (file XCx3NR1is1GA3H6mVfLz7J, frames A1-A10). All ten frames are the same
 * two-pane composition with the same 400px form column, so the geometry and
 * the control shapes live here once rather than being re-typed per route.
 * Each page supplies only its pitch copy and its form body.
 *
 * Every colour resolves through a design token, which is what makes the dark
 * twin (`Share & auth · dark`) fall out for free.
 */

interface AuthPitch {
  /** Display-type headline in the left panel. One short sentence. */
  title: string
  /** Supporting sentence under the headline. */
  body: string
}

interface AuthLayoutProps {
  pitch: AuthPitch
  children: React.ReactNode
}

/** Trust chips pinned to the bottom of the brand panel across all frames. */
const PROOF_CHIPS = ['MIT licensed', 'self-hostable', '10 providers'] as const

export function AuthLayout({ pitch, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-bg-elev flex flex-col lg:flex-row">
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      <aside className="bg-bg-muted border-b lg:border-b-0 lg:border-r border-border px-8 py-10 sm:px-14 sm:py-12 flex flex-col justify-between gap-12 lg:w-[520px] lg:shrink-0">
        <Link
          href="/"
          className="flex items-center gap-2.5 self-start rounded transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-bg-muted"
        >
          <Image src="/icon.png" alt="" width={26} height={26} className="shrink-0 rounded-sm" priority />
          <span className="font-display track-h3 text-[17px] leading-none text-text">spanlens</span>
        </Link>

        <div className="max-w-[400px]">
          <h2 className="font-display track-kpi text-[28px] leading-[1.15] text-text sm:text-[34px] [text-wrap:balance]">
            {pitch.title}
          </h2>
          <p className="mt-4 text-[15px] leading-[1.65] text-text-muted">{pitch.body}</p>
        </div>

        <ul className="flex flex-wrap gap-2">
          {PROOF_CHIPS.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-border bg-bg-elev px-2.5 py-[5px] font-mono text-[11.5px] leading-[1.48] text-text-muted"
            >
              {chip}
            </li>
          ))}
        </ul>
      </aside>

      {/* ── Form column ─────────────────────────────────────────────── */}
      <main className="flex flex-1 items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  )
}

interface AuthHeadingProps {
  title: string
  /** Optional lead-in under the title. Accepts nodes so pages can inline a value. */
  subtitle?: React.ReactNode
  /** Rendered as <h1> by default; screens that already own an <h1> pass 'h2'. */
  as?: 'h1' | 'h2'
}

export function AuthHeading({ title, subtitle, as: Tag = 'h1' }: AuthHeadingProps) {
  return (
    <div className="mb-[26px]">
      <Tag className="font-display track-h3 text-[26px] leading-[1.2] text-text">{title}</Tag>
      {subtitle && <p className="mt-2 text-[13.5px] leading-[1.6] text-text-faint">{subtitle}</p>}
    </div>
  )
}

/*
 * Control shapes. The board draws every button as a 47px pill and every input
 * as a 44px 10px-radius box, which is taller than the shared dashboard
 * `Button`/`Input` (36px). Auth screens are the one place the design goes
 * large, so the classes are expressed here instead of adding a variant to the
 * shared components that only these routes would use.
 */
const CONTROL_BASE =
  'inline-flex h-[47px] w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev disabled:pointer-events-none disabled:opacity-50'

export const authPrimaryButton = cn(CONTROL_BASE, 'bg-accent text-accent-fg hover:bg-accent-strong')

export const authSecondaryButton = cn(
  CONTROL_BASE,
  'border border-border bg-bg-elev text-text hover:border-border-strong hover:bg-bg-muted',
)

export const authInput =
  'h-11 w-full rounded-md border border-border bg-bg-elev px-3.5 text-[13.5px] text-text transition-colors placeholder:text-text-faint focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 aria-[invalid=true]:border-bad'

interface AuthFieldProps {
  id: string
  label: string
  /** Right-aligned affordance on the label row, e.g. the "Forgot?" link. */
  action?: React.ReactNode
  children: React.ReactNode
}

export function AuthField({ id, label, action, children }: AuthFieldProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-[7px]">
        <label htmlFor={id} className="text-[12.5px] font-medium leading-[1.48] text-text">
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  )
}

type NoteTone = 'neutral' | 'good' | 'warn' | 'bad'

const NOTE_TONES: Record<NoteTone, { box: string; dot: string }> = {
  neutral: { box: 'bg-bg-sunk text-text-muted', dot: 'bg-text-muted' },
  good: { box: 'bg-good-bg text-good', dot: 'bg-good' },
  warn: { box: 'bg-warn-bg text-warn', dot: 'bg-warn' },
  bad: { box: 'bg-bad-bg text-bad', dot: 'bg-bad' },
}

interface AuthNoteProps {
  tone?: NoteTone
  children: React.ReactNode
  /**
   * Set on notes that appear in response to a user action so screen readers
   * announce them. Error notes should use 'assertive'.
   */
  live?: 'polite' | 'assertive'
  className?: string
}

/** Tinted callout used for sent confirmations, expiry warnings and lock notices. */
export function AuthNote({ tone = 'neutral', children, live, className }: AuthNoteProps) {
  const styles = NOTE_TONES[tone]
  return (
    <div
      {...(live ? { role: live === 'assertive' ? 'alert' : 'status', 'aria-live': live } : {})}
      className={cn('flex items-center gap-2.5 rounded-lg px-3.5 py-3', styles.box, className)}
    >
      <span className={cn('size-[7px] shrink-0 rounded-full', styles.dot)} aria-hidden="true" />
      <p className="text-[12px] font-medium leading-[1.48]">{children}</p>
    </div>
  )
}

/** Centred quiet line at the foot of a card, e.g. "New here? Create an account". */
export function AuthFootnote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-center text-[12.5px] leading-[1.48] text-text-faint', className)}>{children}</p>
  )
}

/** Inline link styling shared by the footnotes and the label-row affordances. */
export const authLink =
  'text-accent underline-offset-4 transition-opacity hover:opacity-80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev rounded-sm'
