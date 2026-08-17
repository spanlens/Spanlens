/**
 * Dashboard page skeleton — mirrors the greeting / KPI cards / chart / 2-col
 * layout so the transition from loading → real content is seamless. The board
 * puts every row on its own card over the canvas, so the skeleton does too:
 * a full-bleed topbar, then cards at a 16px rhythm inside the shell's gutters.
 */
export default function DashboardLoading() {
  return (
    <div>
      {/* Topbar — the one full-bleed row, so it cancels the shell gutters. */}
      <div className="h-[61px] border-b border-border px-4 md:px-7 flex items-center gap-2 shrink-0 -mx-4 -mt-4 md:-mx-7 md:-mt-5 mb-4 md:mb-5">
        <div className="h-2.5 w-24 bg-bg-chip rounded animate-pulse" />
        <div className="h-2.5 w-1.5 bg-bg-elev rounded opacity-40" />
        <div className="h-2.5 w-20 bg-bg-chip rounded animate-pulse" />
        <div className="ml-auto h-7 w-[120px] bg-bg-chip rounded animate-pulse" />
      </div>

      <div className="flex flex-col gap-4">
        {/* Greeting */}
        <div>
          <div className="h-7 w-32 bg-bg-chip rounded animate-pulse mb-2" />
          <div className="h-3 w-56 bg-bg-chip rounded animate-pulse" />
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card-surface rounded-card px-5 py-[18px]">
              <div className="h-2.5 w-20 bg-bg-chip rounded animate-pulse mb-3" />
              <div className="h-8 w-24 bg-bg-chip rounded animate-pulse mb-3" />
              <div className="h-5 w-full bg-bg-chip rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* Chart card */}
        <div className="card-surface rounded-card px-5 py-[18px]">
          <div className="h-3.5 w-40 bg-bg-chip rounded animate-pulse mb-[14px]" />
          <div className="h-[220px] bg-bg-chip rounded animate-pulse" />
        </div>

        {/* Spend forecast card */}
        <div className="card-surface rounded-card px-5 py-[18px]">
          <div className="h-[160px] bg-bg-chip rounded animate-pulse" />
        </div>

        {/* 2-col: top prompts + models */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1].map((col) => (
            <div key={col} className="card-surface rounded-card px-5 py-[18px]">
              <div className="h-3 w-32 bg-bg-chip rounded animate-pulse mb-[14px]" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                  <div className="h-3 w-4 bg-bg-chip rounded animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 bg-bg-chip rounded animate-pulse" />
                    <div className="h-1.5 w-full bg-bg-chip rounded animate-pulse" />
                  </div>
                  <div className="h-3 w-12 bg-bg-chip rounded animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
