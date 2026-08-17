/**
 * First-paint skeleton for /projects. Mirrors the real page shape — full-bleed
 * topbar, four stat cards, then the projects / Spanlens keys / provider keys
 * table cards — so the swap to real content doesn't shift the layout.
 */
export default function Loading() {
  return (
    <>
      <div className="-mx-4 -mt-4 md:-mx-7 md:-mt-5 h-[61px] border-b border-border px-4 md:px-7 flex items-center gap-2">
        <div className="h-2.5 w-28 rounded bg-bg-muted animate-pulse" />
      </div>

      <div className="pt-4 md:pt-5 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]"
            >
              <div className="h-2.5 w-20 rounded bg-bg-muted animate-pulse" />
              <div className="h-6 w-16 rounded bg-bg-muted animate-pulse mt-[7px]" />
              <div className="h-2.5 w-24 rounded bg-bg-muted animate-pulse mt-[7px]" />
            </div>
          ))}
        </div>

        <div className="h-[38px] rounded-md border border-border bg-bg-elev animate-pulse" />

        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden"
          >
            <div className="bg-bg-muted border-b border-border px-[18px] py-2.5">
              <div className="h-2.5 w-32 rounded bg-bg-elev animate-pulse" />
            </div>
            <div className="p-[18px] space-y-3">
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-8 rounded-md bg-bg-muted animate-pulse"
                  style={{ opacity: 1 - row * 0.15 }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
