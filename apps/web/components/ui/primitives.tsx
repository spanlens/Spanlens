import { cn } from '@/lib/utils'

/**
 * MicroLabel — ALL CAPS Geist Mono label used for column headers and card titles.
 * e.g. "DATE", "COST", "STATUS"
 */
export function MicroLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint',
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Section — Card-like container with a header and body.
 * Use `danger` variant for destructive settings sections.
 */
export function Section({
  title,
  description,
  children,
  danger = false,
  className,
  action,
}: {
  title?: string
  description?: string
  children: React.ReactNode
  danger?: boolean
  className?: string
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-card border bg-bg-elev overflow-hidden shadow-card',
        danger ? 'border-accent-border' : 'border-border',
        className,
      )}
    >
      {(title || description) && (
        <div
          className={cn(
            'flex items-start justify-between px-6 py-4 border-b',
            danger ? 'border-accent-border bg-accent-bg/40' : 'border-border',
          )}
        >
          <div>
            {title && (
              <div className={cn('text-[13px] font-medium', danger ? 'text-accent' : 'text-text')}>
                {title}
              </div>
            )}
            {description && (
              <div className="text-[12px] text-text-muted mt-0.5">{description}</div>
            )}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {/* Transparent, not `bg-bg`: the card and the page were the same white in
          light mode so the difference never showed, but in dark it painted a
          `#0c0d10` body under a `#141619` header. The settings cards in the
          Figma boards are a single fill. */}
      <div>{children}</div>
    </div>
  )
}

/**
 * FormRow — 2-column settings row. Label (260px) + control.
 * Separated by a bottom border.
 */
export function FormRow({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-2 sm:gap-7 px-4 sm:px-6 py-4 border-b border-border last:border-b-0',
        className,
      )}
    >
      <div>
        <div className="text-[13px] font-medium text-text">{label}</div>
        {hint && <div className="text-[12px] text-text-muted mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center">{children}</div>
    </div>
  )
}

/**
 * StatusPill — inline pill for request/span status.
 *
 * `accent` is the odd one out: the boards use the same pill for a few things
 * that are emphasis rather than state (a live traffic share, a `{{variable}}`
 * chip, a source badge). They share this geometry exactly, so they share the
 * component instead of growing a second one, but they are not a status and
 * must not be given `good`/`warn`, which would assert a health they don't have.
 */
export function StatusPill({
  children,
  variant = 'neutral',
  className,
}: {
  children: React.ReactNode
  variant?: 'good' | 'bad' | 'warn' | 'neutral' | 'accent'
  className?: string
}) {
  return (
    <span
      className={cn(
        // Every dashboard board draws these the same way: a borderless pill,
        // 3/8 padding, 11px Geist SemiBold, tinted fill with status ink. The
        // fill carries the state, so there is no outline to compete with it.
        'inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[11px] font-semibold leading-[15px] whitespace-nowrap',
        variant === 'good' && 'bg-good-bg text-good',
        variant === 'bad' && 'bg-bad-bg text-bad',
        variant === 'warn' && 'bg-warn-bg text-warn',
        variant === 'accent' && 'bg-accent-bg text-accent',
        variant === 'neutral' && 'bg-bg-chip text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * PrimaryBtn — black button (bg-text, text-bg).
 */
export function PrimaryBtn({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center px-4 py-[7px] rounded text-[13px] font-medium',
        'bg-text text-bg hover:opacity-90 transition-opacity',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * GhostBtn — outlined button.
 */
export function GhostBtn({
  children,
  danger = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center px-4 py-[7px] rounded text-[13px] font-medium border transition-colors',
        danger
          ? 'border-accent-border bg-accent-bg text-accent hover:bg-accent-bg/80'
          : 'border-border-strong bg-transparent text-text hover:bg-bg-muted',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
