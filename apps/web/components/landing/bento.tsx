import { Reveal } from '@/components/landing/reveal'

/**
 * Five capabilities, each shown through the artefact it produces rather than
 * described: a cost plot, a live alert, a version list, a cache header, and a
 * CI transcript.
 */

/** Relative bar heights for the cost plot, with the accented ones called out. */
const PLOT = [
  { h: 28, hot: false },
  { h: 44, hot: false },
  { h: 36, hot: false },
  { h: 59, hot: true },
  { h: 40, hot: false },
  { h: 73, hot: true },
  { h: 51, hot: false },
  { h: 86, hot: true },
  { h: 57, hot: false },
  { h: 65, hot: false },
]

const VERSIONS: { name: string; note: string; live?: boolean }[] = [
  { name: 'support@v4', note: 'live', live: true },
  { name: 'support@v3', note: '38%' },
  { name: 'support@v2', note: 'retired' },
]

export function Bento() {
  return (
    <section
      id="product"
      className="bg-bg-muted px-4 py-16 sm:px-6 lg:px-10 lg:pb-10 lg:pt-[120px]"
    >
      <div className="mx-auto max-w-[1200px]">
        <header>
          <p className="eyebrow">What lands in the dashboard</p>
          <h2 className="mt-4 max-w-[520px] font-display track-h2 text-[30px] leading-[1.06] text-text lg:text-[56px]">
            Five things you stop building yourself
          </h2>
        </header>

        <Reveal className="mt-10 grid gap-5 lg:mt-10 lg:grid-cols-3" stagger={80}>
          {/* Cost — spans two columns on the wide grid. */}
          <article className="card-surface flex flex-col rounded-panel p-6 lg:col-span-2 lg:p-[30px]">
            <h3 className="font-display track-h3 text-[19px] text-text lg:text-[24px]">
              Cost per model, live
            </h3>
            <p className="mt-3 max-w-[480px] text-[13.5px] leading-[1.58] text-text-muted lg:text-[14.5px]">
              Spend, tokens and cache savings resolved per model and project, with prices refreshed
              for you.
            </p>
            <Reveal
              className="mt-6 flex h-[120px] items-end gap-2.5 lg:h-[140px]"
              kind="bars"
              stagger={45}
            >
              {PLOT.map((bar, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-md ${bar.hot ? 'bg-accent-bright' : 'bg-track'}`}
                  style={{ height: `${bar.h}%` }}
                />
              ))}
            </Reveal>
          </article>

          {/* Anomalies — the one tinted cell in the grid. */}
          <article className="flex flex-col rounded-panel bg-accent-bg p-6 lg:p-[30px]">
            <h3 className="font-display track-h3 text-[19px] text-text lg:text-[24px]">
              It pages you first
            </h3>
            <p className="mt-3 text-[13.5px] leading-[1.58] text-text-muted lg:text-[14.5px]">
              Spikes, error bursts and latency drift come with the model and project that caused
              them.
            </p>
            <div className="mt-6 rounded-lg bg-bg-elev px-4 py-3.5">
              <div className="text-[13.5px] font-semibold leading-[1.4] text-bad">
                Cost spike · gpt-4o
              </div>
              <div className="mt-1 font-mono text-[12px] leading-[1.4] text-text-muted">
                3.1x above the 7-day median
              </div>
            </div>
          </article>

          {/* Prompts */}
          <article className="card-surface flex flex-col rounded-panel p-6 lg:p-[26px]">
            <h3 className="font-display track-h3 text-[19px] text-text lg:text-[22px]">
              Pinned prompt versions
            </h3>
            <p className="mt-3 text-[13.5px] leading-[1.56] text-text-muted lg:text-[14px]">
              Pin a version per request, then compare cost and score on real traffic.
            </p>
            <ul className="mt-5 flex flex-col gap-2">
              {VERSIONS.map((v) => (
                <li
                  key={v.name}
                  className="flex items-center justify-between rounded-lg bg-bg-sunk px-3 py-2.5"
                >
                  <span className="font-mono text-[12.5px] leading-[1.4] text-text">{v.name}</span>
                  <span
                    className={`text-[12px] font-medium leading-[1.4] ${v.live ? 'text-accent' : 'text-text-faint'}`}
                  >
                    {v.note}
                  </span>
                </li>
              ))}
            </ul>
          </article>

          {/* Cache */}
          <article className="flex flex-col rounded-panel border border-accent-border bg-accent-bg p-6 lg:p-[26px]">
            <h3 className="font-display track-h3 text-[19px] text-text lg:text-[22px]">
              Repeat calls cost zero
            </h3>
            <p className="mt-3 text-[13.5px] leading-[1.56] text-text-muted lg:text-[14px]">
              One header turns on exact-match caching. Hits skip the provider and bill zero.
            </p>
            <div className="mt-5 self-start rounded-lg border border-accent-border bg-bg-elev px-3.5 py-2.5">
              <code className="font-mono text-[12.5px] leading-[1.4] text-text">
                x-spanlens-cache: 3600
              </code>
            </div>
            <div className="mt-5">
              <div className="font-display track-h3 text-[26px] leading-[1.1] text-accent">
                412 hits today
              </div>
              <div className="mt-1 text-[12.5px] leading-[1.4] text-text-muted">billed at zero</div>
            </div>
          </article>

          {/*
           * Evals sits on an ink ground. The ground is painted on the outer
           * element, which must stay outside the dark scope so `bg-text`
           * resolves against the page theme; the inner element carries `dark`
           * so every token beneath it flips to its dark value and the contents
           * can keep using plain token classes. Same split as the trace slab.
           */}
          <article className="rounded-panel bg-text dark:bg-bg-sunk">
            <div className="dark flex h-full flex-col p-6 lg:p-[26px]">
              <h3 className="font-display track-h3 text-[19px] text-text lg:text-[22px]">
                Evals run inside CI
              </h3>
              <p className="mt-3 text-[13.5px] leading-[1.56] text-text-faint lg:text-[14px]">
                Grade with an API key, gate the merge, queue the unsure cases for a human.
              </p>
              <pre className="mt-5 overflow-x-auto rounded-lg bg-bg-sunk px-4 py-3.5 font-mono text-[12px] leading-[2] text-text-muted">
                <code>
                  {'$ spanlens eval run tone\n'}
                  {'  38 cases · 2 flagged\n'}
                  <span className="text-accent">{'  score 0.91 · gate passed'}</span>
                </code>
              </pre>
            </div>
          </article>
        </Reveal>
      </div>
    </section>
  )
}
