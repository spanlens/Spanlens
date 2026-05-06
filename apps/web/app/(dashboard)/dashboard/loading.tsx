import { cn } from '@/lib/utils'

/**
 * Dashboard page skeleton — mirrors the greeting / KPI grid / chart / 2-col layout
 * so the transition from loading → real content is seamless.
 */
export default function DashboardLoading() {
  const kpiCell = (i: number) => {
    const base = 'px-[18px] py-[18px]'
    // mirrors kpiCellClasses in dashboard/page.tsx
    const borders = [
      'border-r border-b border-border lg:border-b-0',
      'border-b border-border lg:border-r lg:border-b-0',
      'border-r border-border',
      'border-border',
    ]
    return cn(base, borders[i])
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden -mx-4 -my-4 md:-mx-8 md:-my-7">
      {/* Topbar */}
      <div className="h-[52px] border-b border-border px-[22px] flex items-center gap-2 shrink-0">
        <div className="h-2.5 w-24 bg-bg-elev rounded animate-pulse" />
        <div className="h-2.5 w-1.5 bg-bg-elev rounded opacity-40" />
        <div className="h-2.5 w-20 bg-bg-elev rounded animate-pulse" />
        <div className="ml-auto h-7 w-[120px] bg-bg-elev rounded animate-pulse" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Greeting strip */}
        <div className="px-[22px] py-[22px] border-b border-border">
          <div className="h-7 w-32 bg-bg-elev rounded animate-pulse mb-2" />
          <div className="h-3 w-56 bg-bg-elev rounded animate-pulse" />
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-border mt-[18px]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={kpiCell(i)}>
              <div className="h-2.5 w-20 bg-bg-elev rounded animate-pulse mb-3" />
              <div className="h-8 w-24 bg-bg-elev rounded animate-pulse mb-3" />
              <div className="h-5 w-full bg-bg-elev rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* Chart area */}
        <div className="px-[22px] py-5 border-b border-border">
          <div className="h-3.5 w-40 bg-bg-elev rounded animate-pulse mb-4" />
          <div className="h-[220px] bg-bg-elev rounded animate-pulse" />
        </div>

        {/* Spend forecast */}
        <div className="px-[22px] py-5 border-b border-border">
          <div className="h-[160px] bg-bg-elev rounded animate-pulse" />
        </div>

        {/* 2-col: top prompts + models */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border">
          {[0, 1].map((col) => (
            <div
              key={col}
              className={cn('px-[22px] py-[18px]', col === 0 && 'border-b border-border md:border-b-0 md:border-r')}
            >
              <div className="h-3 w-32 bg-bg-elev rounded animate-pulse mb-4" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                  <div className="h-3 w-4 bg-bg-elev rounded animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 bg-bg-elev rounded animate-pulse" />
                    <div className="h-1.5 w-full bg-bg-elev rounded animate-pulse" />
                  </div>
                  <div className="h-3 w-12 bg-bg-elev rounded animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
