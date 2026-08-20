import { Reveal } from '@/components/landing/reveal'

/**
 * Four load-bearing facts, ruled off like a ledger.
 *
 * Every figure here is checkable in the repo: one baseURL swap, the ten
 * providers under `apps/server/src/proxy/`, the 290s stream deadline from
 * `proxy/stream-deadline.ts`, and the MIT licence.
 */

const STATS: { figure: string; body: string }[] = [
  { figure: '1 line', body: 'of config to change. The SDK call stays exactly as it is.' },
  { figure: '10', body: 'providers routed through the same endpoint today.' },
  { figure: '290s', body: 'streaming deadline, then the partial trace is still written.' },
  { figure: 'MIT', body: 'licensed. Run the Docker image yourself whenever you want.' },
]

export function LedgerBand() {
  return (
    <section className="px-4 sm:px-6 lg:px-10">
      {/*
       * The rules between stats are drawn as cell borders rather than
       * dividers: a stacked column wants horizontal rules and a four-up row
       * wants vertical ones, so each cell owns the edge that faces the
       * previous cell at that breakpoint and drops it when it starts a row.
       */}
      <Reveal
        className="mx-auto grid max-w-[1200px] grid-cols-1 border-t border-border sm:grid-cols-2 lg:grid-cols-4"
        stagger={90}
      >
        {STATS.map((s) => (
          <div
            key={s.figure}
            className="
              border-b border-border py-8 pr-8 last:border-b-0
              sm:border-b-0 sm:border-l sm:pl-8
              sm:[&:nth-child(odd)]:border-l-0 sm:[&:nth-child(odd)]:pl-0
              lg:[&:nth-child(3)]:border-l lg:[&:nth-child(3)]:pl-8
              lg:py-10
            "
          >
            <div className="font-display track-h2 text-[30px] leading-none text-text lg:text-[46px]">
              {s.figure}
            </div>
            <p className="mt-2.5 max-w-[232px] text-[13px] leading-[1.58] text-text-muted lg:text-[13.5px]">
              {s.body}
            </p>
          </div>
        ))}
      </Reveal>
    </section>
  )
}
