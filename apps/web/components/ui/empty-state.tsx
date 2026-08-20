import Link from 'next/link'
import { cn } from '@/lib/utils'

/*
 * Zero/error states, ported from the `States` board in Figma
 * (file XCx3NR1is1GA3H6mVfLz7J, frames 147:11 onward).
 *
 * Every board shares one body: a 44px tinted glyph, a display-type headline,
 * one sentence of explanation, optional evidence (a snippet, a chip row, a
 * meter) and a row of pill actions. The tone only changes the glyph tint, so
 * an empty table and a failed query read as the same family.
 *
 * The wrapper stays borderless because these render inside a card that
 * already has the hairline. Standalone pages (404, 500) draw their own card
 * around `stateCard`.
 */

type StateTone = 'neutral' | 'bad' | 'warn'

const GLYPH_TONES: Record<StateTone, string> = {
  neutral: 'bg-bg-sunk text-text-faint',
  bad: 'bg-bad-bg text-bad',
  warn: 'bg-warn-bg text-warn',
}

/** Hairline + radius + shadow for state cards that stand on their own page. */
export const stateCard = 'rounded-card border border-border bg-bg-elev shadow-card'

/*
 * State actions are the 39px pill from the boards, one step down from the
 * 47px auth pill and one step up from the 36px dashboard control.
 */
const ACTION_BASE =
  'inline-flex h-[39px] items-center justify-center rounded-full px-[18px] text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev disabled:pointer-events-none disabled:opacity-50'

export const stateActionPrimary = cn(ACTION_BASE, 'bg-accent text-accent-fg hover:bg-accent-strong')

export const stateActionSecondary = cn(
  ACTION_BASE,
  'border border-border bg-bg-elev text-text hover:border-border-strong hover:bg-bg-muted',
)

/** The board's glyph: a tinted rounded tile holding a hairline ring. */
export function StateGlyph({ tone = 'neutral' }: { tone?: StateTone }) {
  return (
    <span
      className={cn('flex size-11 items-center justify-center rounded-[14px]', GLYPH_TONES[tone])}
      aria-hidden="true"
    >
      <span className="size-4 rounded-full border-[2.4px] border-current" />
    </span>
  )
}

interface EmptyStateProps {
  title: string
  description?: string | undefined
  action?: React.ReactNode
  className?: string | undefined
  /** Tints the glyph. Use 'bad' for failures and 'warn' for quota notices. */
  tone?: StateTone | undefined
  /** Evidence between the copy and the actions: a snippet, chips, a meter. */
  children?: React.ReactNode
}

export function EmptyState({ title, description, action, className, tone, children }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 px-10 pb-8 pt-11 text-center', className)}
    >
      <StateGlyph tone={tone ?? 'neutral'} />
      <p className="font-display track-quote text-[17px] leading-[1.5] text-text">{title}</p>
      {description && (
        <p className="max-w-[380px] text-[12.5px] leading-[1.6] text-text-faint">{description}</p>
      )}
      {children}
      {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Monospace evidence line, e.g. a baseURL snippet or an error id. */
export function StateSnippet({ children }: { children: React.ReactNode }) {
  return (
    <code className="max-w-full overflow-x-auto rounded-md border border-track bg-bg-sunk px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.5] text-text">
      {children}
    </code>
  )
}

interface FilterEmptyStateProps {
  onClear: () => void
  className?: string | undefined
}

export function FilterEmptyState({ onClear, className }: FilterEmptyStateProps) {
  return (
    <EmptyState
      title="Nothing matches these filters"
      description="The current filter set returns zero rows. Widen the window or drop a filter."
      action={
        <button type="button" onClick={onClear} className={stateActionPrimary}>
          Clear all filters
        </button>
      }
      className={className}
    />
  )
}

interface FirstInstallEmptyStateProps {
  className?: string | undefined
}

export function FirstInstallEmptyState({ className }: FirstInstallEmptyStateProps) {
  return (
    <EmptyState
      title="No requests yet"
      description="Point one client at the proxy and this table fills itself. Nothing to configure first."
      action={
        <Link href="/projects" className={stateActionPrimary}>
          Connect your first project
        </Link>
      }
      className={className}
    >
      <StateSnippet>baseURL: &quot;https://api.spanlens.io/proxy/openai/v1&quot;</StateSnippet>
    </EmptyState>
  )
}
