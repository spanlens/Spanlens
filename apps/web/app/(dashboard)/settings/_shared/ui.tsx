import { cn } from '@/lib/utils'

// Presentational helpers shared by every /settings section. No hooks, no
// data fetching — they are pure render functions, so they stay out of the
// per-section chunks and are safe to import from anywhere.

/**
 * Pill ramps from the D17 board. The settings page's prominent actions are
 * `rounded-full` there, but the shared `PrimaryBtn` / `GhostBtn` primitives
 * are square-cornered and used dashboard-wide. Passing these as `className`
 * re-shapes them locally instead of forking the button primitives.
 */
export const PILL_PRIMARY = 'rounded-full px-3.5 py-2 text-[12px]'
export const PILL_SECONDARY = 'rounded-full px-3.5 py-2 text-[12px] border-border bg-bg-elev hover:bg-bg-muted'

export function NativeInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return (
    <input
      {...rest}
      className={cn(
        'rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors',
        className,
      )}
    />
  )
}

export function Toggle({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        // D17 fills the ON state with the signal accent; OFF sits on the
        // neutral meter track so it reads as "empty" rather than "disabled".
        on ? 'bg-accent' : 'bg-track',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-bg-elev transition-transform',
          on ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

export function MonoPill({
  children,
  dot,
  variant = 'neutral',
}: {
  children: React.ReactNode
  dot?: boolean
  variant?: 'neutral' | 'accent' | 'good' | 'faint'
}) {
  return (
    <span
      className={cn(
        // Role / status pill: filled tint, no outline. The border the older
        // version carried made stacked pills in a table row look noisy at
        // 10.5px.
        'inline-flex items-center gap-1 rounded-full px-2 py-[3px] font-mono text-[10.5px] whitespace-nowrap',
        variant === 'neutral' && 'bg-bg-chip text-text-muted',
        variant === 'accent'  && 'bg-accent-bg text-accent',
        variant === 'good'    && 'bg-good-bg text-good',
        variant === 'faint'   && 'bg-bg-chip text-text-faint',
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', variant === 'accent' ? 'bg-accent' : variant === 'good' ? 'bg-good' : 'bg-text-faint')} />}
      {children}
    </span>
  )
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-text-faint tracking-[0.03em]">{children}</span>
}

/**
 * TabHeader — the section's name and one-line description, plus an optional
 * action.
 *
 * In v2 the breadcrumb names the page and the section cards carry their own
 * titles. The title therefore sits on the section-eyebrow ramp rather than the
 * card-title ramp: at 13.5px SemiBold it read as a second, duplicated card
 * title on every tab whose first card shares its name (Members, Webhooks).
 */
export function TabHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        <h1 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">{title}</h1>
        <p className="text-[12.5px] text-text-muted mt-1">{description}</p>
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  )
}
