import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/*
 * Board surfaces — the pieces that repeat across the Build and Review boards
 * (Prompts, Evals, Datasets, Experiments, Alerts, Annotation).
 *
 * Measured off `Dashboard v2` in Figma XCx3NR1is1GA3H6mVfLz7J, frames D4 and
 * D10-D14 plus the D21-D23 detail boards. Every one of those boards lays out
 * the same way: a content column stacked at 16px holding a filter row, a stat
 * strip, and one or more cards. Keeping that geometry in one file is what
 * stops the six routes from drifting a pixel at a time.
 *
 * The card, tab and button primitives already live in `components/ui`; this
 * file only covers shapes those don't have.
 */

/*
 * Content column. `DashboardContent` in the shell already supplies the 20px
 * top / 28px side / 28px bottom inset from the Figma content frame, so a board
 * only owns the 16px rhythm between its rows — adding padding here would
 * double the inset.
 */
export function Board({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-4', className)}>{children}</div>
}

/*
 * Topbar wrapper. The topbar is the one row that runs edge to edge, so it
 * cancels the shell inset on the axes it actually touches and then re-opens
 * the 20px gap above the first content row.
 *
 * The negatives mirror `DashboardContent` exactly: it pads `px-4 py-4` with
 * `md:pt-5 md:pb-7 md:px-7`, so the sides cancel at 4/7 and the top at 4/5.
 * The bottom gutter is deliberately NOT cancelled — `-mb-7` would drag the
 * content column up underneath the topbar. `mb-4 md:mb-5` is a positive gap,
 * not a bleed. This matches the converted `dashboard/dashboard-client.tsx`.
 */
export const TOPBAR_BLEED = 'sticky top-0 z-20 bg-bg -mx-4 -mt-4 md:-mx-7 md:-mt-5 mb-4 md:mb-5'

/** Filter row: 34px tall controls, 8px apart. */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
}

/*
 * Control heights are 34px across the boards, and the trough-backed segmented
 * control sits 1px inside that so its lozenge lines up with its neighbours.
 */
export const CONTROL = 'h-[34px] rounded-md border border-border bg-bg-elev'
export const CONTROL_TEXT = 'text-[12.5px] font-medium leading-[18px] text-text'

/** Trough-backed segmented control. */
export function Segment({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('inline-flex items-center gap-[2px] rounded-full bg-secondary p-[3px]', className)}>
      {children}
    </div>
  )
}

/** One lozenge inside a `Segment`. */
export function SegmentItem({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'rounded-full px-[11px] py-[5px] text-[12px] font-medium leading-[17px] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-bg-elev text-text' : 'text-text-faint hover:text-text',
        className,
      )}
      {...props}
    />
  )
}

/*
 * Pill tab. Mirrors `components/ui/tabs.tsx` for the routes that drive their
 * tab state off the URL with plain buttons instead of Radix.
 */
export function tabClass(active: boolean): string {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] leading-[18px] transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'bg-primary text-primary-foreground font-semibold'
      : 'font-medium text-text-faint hover:text-text',
  )
}

/** Stat tile: mono eyebrow, display figure, optional foot. */
export function StatCard({
  label,
  value,
  foot,
  footClass,
  className,
}: {
  label: string
  value: React.ReactNode
  foot?: React.ReactNode
  footClass?: string
  className?: string
}) {
  return (
    <Card className={cn('flex flex-col gap-[7px] px-5 py-[18px]', className)}>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] leading-[1.45] text-text-faint">
        {label}
      </div>
      {/* `leading` is forced because `.font-display` carries the 112% display
          line height, which is too airy for a single-line figure. */}
      <div className="font-display text-[24px] tracking-[-0.02em] leading-[1.05]! tabular-nums text-text">
        {value}
      </div>
      {foot != null && (
        <div className={cn('text-[11.5px] font-medium leading-[1.45] text-text-muted', footClass)}>
          {foot}
        </div>
      )}
    </Card>
  )
}

/*
 * Summary strip — the detail boards (D21-D23) replace the tile row with a
 * single card whose cells are divided by hairlines instead of gaps.
 */
export function SummaryStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('flex flex-wrap items-stretch px-5 py-4', className)}>{children}</Card>
  )
}

export function SummaryCell({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col justify-center gap-[5px] border-l border-border px-6 first:border-l-0 first:pl-0',
        className,
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] leading-[1.45] text-text-faint">
        {label}
      </span>
      <span className="font-mono text-[15px] leading-[1.45] text-text">{children}</span>
    </div>
  )
}

/*
 * Table card. `Card` already carries the 16px radius, hairline and shadow;
 * this only adds the clip so the header band and the last row meet the
 * rounded corners instead of overhanging them.
 */
export function TableCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Card className={cn('overflow-hidden', className)}>{children}</Card>
}

/** Sunk header band above the rows. */
export function TableHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('border-b border-border bg-bg-muted px-[18px] py-2.5', className)}>
      {children}
    </div>
  )
}

/**
 * Column label inside `TableHead`.
 *
 * `relative` is load-bearing: an icon-only column labels itself with a nested
 * `<span className="sr-only">`, and `sr-only` is `position: absolute`. Without
 * a positioned ancestor that span resolves against the initial containing
 * block, which puts it outside the table's `overflow-x-auto` clip and makes
 * the whole document scroll sideways on narrow viewports.
 */
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'relative font-mono text-[10px] uppercase tracking-[0.1em] leading-[1.45] text-text-faint',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Row padding shared by every board table. */
export const ROW = 'px-[18px] py-3 border-b border-border last:border-b-0'

/* Status chips are `StatusPill` from `components/ui/primitives` — one shape
   for the whole codebase. Nothing to add here. */

/** Sunk well for prompt bodies, inputs and outputs. */
export function Well({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-bg-sunk px-3.5 py-3', className)}>
      {children}
    </div>
  )
}
