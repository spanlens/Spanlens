import { Skeleton } from '@/components/ui/skeleton'

/**
 * Billing route skeleton. Mirrors the real page's shape (full-bleed topbar
 * over a two-card row) rather than the generic list skeleton, so the swap to
 * live content doesn't reflow the layout.
 */
export default function Loading() {
  return (
    <>
      <div className="-mx-4 -mt-4 md:-mx-7 md:-mt-5">
        <div className="flex h-[61px] items-center gap-2 border-b border-border px-4 md:px-7">
          <Skeleton className="h-2.5 w-20" />
          <span className="text-text-faint">/</span>
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 pt-4 md:pt-5 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px] shadow-card">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-7 w-36" />
          <Skeleton className="mt-3 h-3 w-52" />
          <Skeleton className="mt-8 h-2.5 w-64" />
        </div>

        <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px] shadow-card">
          <Skeleton className="h-3 w-28" />
          <div className="mt-4 flex flex-col gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border px-4 py-3.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2 h-2.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
