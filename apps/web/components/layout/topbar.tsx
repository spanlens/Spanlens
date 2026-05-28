'use client'
import { useEffect, useRef, useState } from 'react'
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
      {/* Hamburger, mobile only */}
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
      {/* Search pill, hidden on mobile to make room for right-slot actions */}
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

export interface CustomRange {
  /** Inclusive start, ISO string (00:00 of the picked date in local TZ). */
  from: string
  /** Exclusive end, ISO string (24:00 of the picked date in local TZ). */
  to: string
}

interface TimeRangeSelectorProps {
  value: string
  onChange: (v: string) => void
  /** Currently-applied custom range, if `value === 'custom'`. */
  customRange?: CustomRange | null
  /** Fired when the user picks a complete custom range. */
  onCustomRange?: (r: CustomRange) => void
  options?: string[]
}

function parseYmd(dateStr: string): [number, number, number] {
  const parts = dateStr.split('-').map((n) => parseInt(n, 10))
  return [parts[0] ?? 1970, parts[1] ?? 1, parts[2] ?? 1]
}
function toLocalIsoStartOfDay(dateStr: string): string {
  // `dateStr` is YYYY-MM-DD from <input type="date">. Anchor to local
  // midnight so the picked day matches what the user clicked.
  const [y, m, d] = parseYmd(dateStr)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}
function toLocalIsoEndOfDay(dateStr: string): string {
  const [y, m, d] = parseYmd(dateStr)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

function formatCustomLabel(r: CustomRange): string {
  const f = new Date(r.from)
  const t = new Date(r.to)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${f.toLocaleDateString('en-US', opts)} – ${t.toLocaleDateString('en-US', opts)}`
}

/** Time range segmented control with optional custom-range picker. */
export function TimeRangeSelector({
  value,
  onChange,
  customRange,
  onCustomRange,
  options = ['1h', '24h', '7d', '30d'],
}: TimeRangeSelectorProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Compute today + 7d-ago inside the useState initializers so React's
  // purity rule doesn't flag the inline `Date.now()` as an impure render.
  // The values are captured at mount; the picker doesn't need them to
  // refresh on re-render since the user is actively typing values.
  const [today] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState<string>(() =>
    customRange ? customRange.from.slice(0, 10) : new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  )
  const [to, setTo] = useState<string>(() =>
    customRange ? customRange.to.slice(0, 10) : new Date().toISOString().slice(0, 10)
  )

  // Close on outside-click or Escape.
  useEffect(() => {
    if (!open) return
    function onPointer(e: PointerEvent) {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function applyCustom() {
    if (!from || !to || !onCustomRange) return
    const fromIso = toLocalIsoStartOfDay(from)
    const toIso = toLocalIsoEndOfDay(to)
    if (new Date(fromIso).getTime() > new Date(toIso).getTime()) return
    onCustomRange({ from: fromIso, to: toIso })
    setOpen(false)
  }

  const customSelected = value === 'custom' && !!customRange
  const customLabel = customSelected && customRange ? formatCustomLabel(customRange) : 'Custom…'

  return (
    <div className="relative" ref={popoverRef}>
      <div className="flex border border-border rounded-md overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'font-mono text-[11px] px-[10px] py-[5px] border-r border-border transition-colors',
              opt === value && !customSelected
                ? 'bg-bg-elev text-text font-medium'
                : 'bg-transparent text-text-muted hover:text-text',
            )}
          >
            {opt}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'font-mono text-[11px] px-[10px] py-[5px] transition-colors',
            customSelected
              ? 'bg-bg-elev text-text font-medium'
              : 'bg-transparent text-text-muted hover:text-text',
          )}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {customLabel}
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-1 z-30 bg-bg-elev border border-border rounded-md shadow-lg p-3 min-w-[280px]"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Custom range
          </div>
          <div className="flex flex-col gap-2 mb-3">
            <label className="text-[12px] text-text-muted flex items-center gap-2">
              <span className="w-10 shrink-0">From</span>
              <input
                type="date"
                lang="en"
                value={from}
                max={today}
                onChange={(e) => setFrom(e.target.value)}
                className="flex-1 font-mono text-[12px] px-2 py-[5px] border border-border rounded bg-bg text-text"
              />
            </label>
            <label className="text-[12px] text-text-muted flex items-center gap-2">
              <span className="w-10 shrink-0">To</span>
              <input
                type="date"
                lang="en"
                value={to}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="flex-1 font-mono text-[12px] px-2 py-[5px] border border-border rounded bg-bg text-text"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[11px] px-2.5 py-1 text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!from || !to}
              className="font-mono text-[11px] px-2.5 py-1 rounded bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      )}
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
