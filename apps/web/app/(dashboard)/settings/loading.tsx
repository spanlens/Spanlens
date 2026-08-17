// Settings has its own skeleton rather than the generic PageSkeleton: the
// page is a nav card + a stack of section cards, not the KPI-tiles-over-table
// shape PageSkeleton draws. Matching the real geometry keeps the swap from
// jumping when the chunk lands.
export default function Loading() {
  return (
    <>
      {/* Topbar — same full-bleed cancel as settings-client */}
      <div className="-mx-4 -mt-4 md:-mx-7 md:-mt-5 h-[61px] border-b border-border px-4 md:px-7 flex items-center gap-2">
        <div className="h-2.5 w-16 bg-bg-muted rounded animate-pulse" />
        <div className="h-2.5 w-1.5 bg-bg-muted rounded opacity-50" />
        <div className="h-2.5 w-24 bg-bg-muted rounded animate-pulse" />
      </div>

      <div className="pt-4 md:pt-5 flex flex-col md:flex-row gap-4 items-start">
        {/* Nav card */}
        <div className="hidden md:block w-[230px] shrink-0 rounded-card border border-border bg-bg-elev shadow-card p-2.5">
          <div className="h-[34px] rounded-md bg-bg-muted animate-pulse mb-3" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[30px] rounded-md bg-bg-muted animate-pulse mb-1.5"
              style={{ opacity: 1 - i * 0.12 }}
            />
          ))}
        </div>

        {/* Section card stack */}
        <div className="flex-1 min-w-0 space-y-4">
          {[0, 1, 2].map((card) => (
            <div key={card} className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <div className="h-3 w-28 bg-bg-muted rounded animate-pulse" />
              </div>
              {[0, 1, 2].map((row) => (
                <div key={row} className="px-6 py-4 border-b border-border last:border-b-0 flex items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="h-2.5 w-40 bg-bg-muted rounded animate-pulse" />
                    <div className="h-2 w-56 bg-bg-muted rounded animate-pulse opacity-60" />
                  </div>
                  <div className="h-[34px] w-24 rounded-md bg-bg-muted animate-pulse shrink-0" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
