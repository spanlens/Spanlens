import { cn } from '@/lib/utils'

/**
 * Loading placeholder. Matches shadcn/ui's `Skeleton` API — animated
 * gray block with rounded corners, sized via className.
 *
 *   <Skeleton className="h-8 w-24" />
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200', className)} {...props} />
}
