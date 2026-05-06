import { cn } from '@/lib/utils'

// ── Generic list/table page skeleton ──────────────────────────────────────────

/**
 * PageSkeleton — generic dashboard page skeleton.
 * Matches the visual rhythm of most dashboard list/table pages:
 * Topbar → 3–4 stat tiles → table rows.
 *
 * Shown instantly via Next.js loading.tsx convention while the actual page
 * chunk + data are being fetched. Transitions seamlessly because the topbar
 * and tile heights match the real layout.
 */
export function PageSkeleton() {
  return (
    <div className="flex flex-col h-full -mx-4 -my-4 md:-mx-8 md:-my-7 overflow-hidden">
      {/* Topbar */}
      <div className="h-[52px] border-b border-border px-[22px] flex items-center gap-2 shrink-0">
        <div className="h-2.5 w-20 bg-bg-elev rounded animate-pulse" />
        <div className="h-2.5 w-1.5 bg-bg-elev rounded opacity-50" />
        <div className="h-2.5 w-28 bg-bg-elev rounded animate-pulse" />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-border shrink-0">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'px-[18px] py-[18px]',
              i < 3 ? 'border-r border-border' : '',
            )}
          >
            <div className="h-2.5 w-16 bg-bg-elev rounded animate-pulse mb-3" />
            <div className="h-7 w-24 bg-bg-elev rounded animate-pulse mb-2" />
            <div className="h-2 w-20 bg-bg-elev rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Table rows */}
      <div className="flex-1 px-[22px] py-5 space-y-2">
        <div className="h-8 bg-bg-elev rounded animate-pulse opacity-60 mb-4" />
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            className="h-[52px] bg-bg-elev rounded animate-pulse"
            style={{ opacity: 1 - i * 0.09 }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Detail page skeleton ([id] / [name] routes) ───────────────────────────────

/**
 * PageDetailSkeleton — for single-item detail pages such as
 * /requests/[id], /traces/[id], /alerts/[id], /prompts/[name].
 *
 * Structure: Topbar → header card → body content sections.
 */
export function PageDetailSkeleton() {
  return (
    <div className="flex flex-col h-full -mx-4 -my-4 md:-mx-8 md:-my-7 overflow-hidden">
      {/* Topbar */}
      <div className="h-[52px] border-b border-border px-[22px] flex items-center gap-2 shrink-0">
        <div className="h-2.5 w-20 bg-bg-elev rounded animate-pulse" />
        <div className="h-2.5 w-1.5 bg-bg-elev rounded opacity-50" />
        <div className="h-2.5 w-36 bg-bg-elev rounded animate-pulse" />
      </div>

      <div className="flex-1 overflow-y-auto px-[22px] py-5 space-y-4">
        {/* Header card */}
        <div className="border border-border rounded-md p-5 space-y-3">
          <div className="h-3 w-20 bg-bg-elev rounded animate-pulse" />
          <div className="h-5 w-48 bg-bg-elev rounded animate-pulse" />
          <div className="flex gap-6 pt-1">
            {[72, 56, 80, 48].map((w, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2 bg-bg-elev rounded animate-pulse" style={{ width: w }} />
                <div className="h-3 bg-bg-elev rounded animate-pulse" style={{ width: w * 0.7 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Body sections */}
        {[1, 2].map((section) => (
          <div key={section} className="border border-border rounded-md p-5 space-y-3">
            <div className="h-2.5 w-24 bg-bg-elev rounded animate-pulse" />
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-4 bg-bg-elev rounded animate-pulse" style={{ opacity: 1 - row * 0.2 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tab-based page skeleton (prompts/[name]) ──────────────────────────────────

/**
 * PageTabSkeleton — for pages with a prominent tab UI (e.g. /prompts/[name]).
 */
export function PageTabSkeleton() {
  return (
    <div className="flex flex-col h-full -mx-4 -my-4 md:-mx-8 md:-my-7 overflow-hidden">
      {/* Topbar */}
      <div className="h-[52px] border-b border-border px-[22px] flex items-center gap-2 shrink-0">
        <div className="h-2.5 w-20 bg-bg-elev rounded animate-pulse" />
        <div className="h-2.5 w-1.5 bg-bg-elev rounded opacity-50" />
        <div className="h-2.5 w-32 bg-bg-elev rounded animate-pulse" />
      </div>

      <div className="flex-1 overflow-y-auto px-[22px] py-5">
        {/* Title */}
        <div className="h-5 w-40 bg-bg-elev rounded animate-pulse mb-4" />

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-5 pb-0">
          {[48, 56, 44].map((w, i) => (
            <div
              key={i}
              className={cn(
                'h-[34px] rounded-t px-3 flex items-center',
                i === 0 ? 'border-b-2 border-text' : '',
              )}
            >
              <div className="h-2.5 bg-bg-elev rounded animate-pulse" style={{ width: w }} />
            </div>
          ))}
        </div>

        {/* Tab content */}
        <div className="space-y-3">
          <div className="h-8 bg-bg-elev rounded animate-pulse opacity-60" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[52px] bg-bg-elev rounded animate-pulse"
              style={{ opacity: 1 - i * 0.12 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
