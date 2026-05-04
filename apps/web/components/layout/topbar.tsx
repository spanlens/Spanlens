'use client'
import Link from 'next/link'
import { Search, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCommandPalette } from '@/components/command-palette'
import { useSidebar } from '@/lib/sidebar-context'

interface Crumb {
  label: string
  href?: string
}

interface TopbarProps {
  crumbs: Crumb[]
  right?: React.ReactNode
  className?: string
}

/**
 * MonoTopbar — "Workspace / Page / Sub-page" breadcrumb with optional right slot.
 * Sits at the top of every dashboard main area, 52px tall, border-bottom.
 */
export function Topbar({ crumbs, right, className }: TopbarProps) {
  const { toggle } = useSidebar()
  return (
    <div
      className={cn(
        'flex items-center gap-2 h-[52px] px-[22px] border-b border-border shrink-0',
        className,
      )}
    >
      {/* Hamburger — mobile only */}
      <button
        type="button"
        onClick={toggle}
        className="md:hidden p-1.5 -ml-1.5 rounded-[5px] text-text-muted hover:text-text hover:bg-bg-muted transition-colors"
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      <nav className="flex items-center gap-1.5 text-[13px] min-w-0 overflow-hidden">
        {crumbs.map((c, i) => (
          <span
            key={i}
            className={cn(
              'flex items-center gap-1.5 shrink-0',
              // On mobile, hide all crumbs except the last two to save space
              i < crumbs.length - 2 && 'hidden sm:flex',
            )}
          >
            {i > 0 && <span className="text-text-faint">/</span>}
            {c.href ? (
              <Link href={c.href} className="text-text-faint hover:text-text-muted transition-colors truncate max-w-[120px] sm:max-w-none">
                {c.label}
              </Link>
            ) : (
              <span className={cn(
                i === crumbs.length - 1 ? 'text-text font-medium' : 'text-text-faint',
                'truncate max-w-[140px] sm:max-w-none',
              )}>
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex-1" />
      {/* Search pill — hidden on mobile to make room for right-slot actions */}
      <CmdKPill className="hidden md:inline-flex" />
      {right}
    </div>
  )
}

function CmdKPill({ className }: { className?: string }) {
  const { toggle } = useCommandPalette()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Open command palette"
      className={cn(
        'inline-flex items-center gap-1.5 h-[30px] px-2.5 text-text-faint border border-border rounded-[6px] hover:text-text-muted hover:border-border-strong transition-colors font-mono text-[12px]',
        className,
      )}
    >
      <Search size={13} />
      Search
    </button>
  )
}

/** Time range segmented control */
export function TimeRangeSelector({
  value,
  onChange,
  options = ['1h', '24h', '7d', '30d'],
}: {
  value: string
  onChange: (v: string) => void
  options?: string[]
}) {
  return (
    <div className="flex border border-border rounded-md overflow-hidden">
      {options.map((opt, i) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            'font-mono text-[11px] px-[10px] py-[5px] transition-colors',
            i < options.length - 1 && 'border-r border-border',
            opt === value
              ? 'bg-bg-elev text-text font-medium'
              : 'bg-transparent text-text-muted hover:text-text',
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

/** Live indicator dot — pulses while data is being refetched. */
export function LiveDot({ refetching = false }: { refetching?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-text-muted">
      <span
        className={cn(
          'inline-block w-[7px] h-[7px] rounded-full bg-good',
          refetching && 'animate-pulse',
        )}
      />
      Live
    </span>
  )
}
