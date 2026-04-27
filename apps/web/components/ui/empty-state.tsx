import Link from 'next/link'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  description?: string | undefined
  action?: React.ReactNode
  className?: string | undefined
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className,
      )}
    >
      <p className="text-[14px] font-medium text-text-muted mb-1">{title}</p>
      {description && (
        <p className="text-[13px] text-text-faint mb-4 max-w-[360px]">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

interface FilterEmptyStateProps {
  onClear: () => void
  className?: string | undefined
}

export function FilterEmptyState({ onClear, className }: FilterEmptyStateProps) {
  return (
    <EmptyState
      title="No results"
      description="No results. Try adjusting your filters."
      action={
        <button
          type="button"
          onClick={onClear}
          className="text-[13px] text-accent hover:opacity-80 transition-opacity"
        >
          Clear filters
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
      title="No data yet"
      description="Connect your first project to start seeing requests, traces, and cost insights."
      action={
        <Link
          href="/projects"
          className="inline-flex items-center px-4 py-[7px] rounded text-[13px] font-medium bg-text text-bg hover:opacity-90 transition-opacity"
        >
          Connect your first project
        </Link>
      }
      className={className}
    />
  )
}
