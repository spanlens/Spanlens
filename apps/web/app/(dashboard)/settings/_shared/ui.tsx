import { cn } from '@/lib/utils'

// Presentational helpers shared by every /settings section. No hooks, no
// data fetching — they are pure render functions, so they stay out of the
// per-section chunks and are safe to import from anywhere.

export function NativeInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return (
    <input
      {...rest}
      className={cn(
        'h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors',
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
        on ? 'bg-text' : 'bg-border-strong',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-bg transition-transform',
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
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-mono text-[10px] uppercase tracking-[0.04em]',
        variant === 'neutral' && 'border-border bg-bg-elev text-text-muted',
        variant === 'accent'  && 'border-accent-border bg-accent-bg text-accent',
        variant === 'good'    && 'border-good/20 bg-good-bg text-good',
        variant === 'faint'   && 'border-border bg-transparent text-text-faint',
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', variant === 'accent' ? 'bg-accent' : variant === 'good' ? 'bg-good' : 'bg-text-faint')} />}
      {children}
    </span>
  )
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">{children}</span>
}

export function TabHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h1 className="text-[26px] font-medium tracking-[-0.6px] mb-1">{title}</h1>
        <p className="text-[13px] text-text-muted">{description}</p>
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}
