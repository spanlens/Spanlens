import { Skeleton } from '@/components/ui/skeleton'

/**
 * Feedback admin route skeleton. Mirrors the real page's shape (full-bleed
 * topbar, stat row, then the inbox / detail split) rather than the generic
 * list skeleton, so the swap to live content doesn't reflow the layout.
 */
export default function Loading() {
  return (
    <>
      <div className="-mx-4 -mt-4 md:-mx-7 md:-mt-5">
        <div className="flex h-[61px] items-center gap-2 border-b border-border px-4 md:px-7">
          <Skeleton className="h-2.5 w-16" />
          <span className="text-text-faint">/</span>
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>

      <div className="flex flex-col gap-4 pt-4 md:pt-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-card border border-border bg-bg-elev px-5 py-[18px] shadow-card"
            >
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-[7px] h-6 w-12" />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[56, 48, 68, 82, 62, 68].map((w, i) => (
            <Skeleton key={i} className="h-[34px] rounded-full" style={{ width: w }} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="self-start rounded-card border border-border bg-bg-elev px-5 py-[18px] shadow-card">
            <Skeleton className="h-3 w-16" />
            <div className="mt-4 flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="px-3">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="mt-2 h-2.5 w-24" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px] shadow-card">
            <Skeleton className="h-4 w-56" />
            <div className="mt-5 flex gap-8">
              {[0, 1, 2, 3].map((i) => (
                <div key={i}>
                  <Skeleton className="h-2 w-14" />
                  <Skeleton className="mt-1.5 h-3 w-20" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-5 h-20 w-full rounded-lg" />
            <Skeleton className="mt-4 h-[34px] w-20 rounded-full" />
          </div>
        </div>
      </div>
    </>
  )
}
