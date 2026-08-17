import Link from 'next/link'
import { Reveal } from '@/components/landing/reveal'

/**
 * Agent tracing, shown as one run on an ink slab.
 *
 * The slab is two elements on purpose. The outer one paints the ground and
 * must stay outside the dark scope, because `bg-text` there has to resolve
 * against the *page* theme (ink in light mode) and because Tailwind's `dark:`
 * variant is an ancestor selector that an element cannot trigger on itself.
 * The inner one carries `dark`, which re-resolves every token beneath it to
 * its dark value so the contents can use plain token classes and stay correct
 * in both themes.
 */

interface Span {
  name: string
  /** Nesting depth, indented 16px per level as in the comp. */
  depth: number
  /** Bar offset and width as percentages of the track. */
  start: number
  width: number
  tone: 'root' | 'model' | 'tool' | 'pass'
}

const SPANS: Span[] = [
  { name: 'agent.run', depth: 0, start: 0, width: 86.5, tone: 'root' },
  { name: 'plan · gpt-4o', depth: 1, start: 1.7, width: 22.6, tone: 'model' },
  { name: 'lookup_order · tool', depth: 2, start: 23.3, width: 10.3, tone: 'tool' },
  { name: 'retrieve · pgvector', depth: 2, start: 32.9, width: 7.7, tone: 'tool' },
  { name: 'policy_check · tool', depth: 2, start: 39.9, width: 6.0, tone: 'tool' },
  { name: 'answer · claude-sonnet', depth: 1, start: 46.6, width: 32.9, tone: 'model' },
  { name: 'guardrail · eval', depth: 1, start: 79.6, width: 5.3, tone: 'pass' },
]

const BAR_TONE: Record<Span['tone'], string> = {
  root: 'bg-text',
  model: 'bg-accent',
  tool: 'bg-text-faint',
  pass: 'bg-good',
}

export function TraceSlab() {
  return (
    <section className="px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-[1360px] rounded-slab bg-text dark:bg-bg-sunk">
        <div className="dark flex flex-col gap-10 p-8 lg:flex-row lg:items-center lg:gap-[60px] lg:p-[72px]">
          <div className="lg:w-[460px] lg:shrink-0">
            <p className="eyebrow text-accent">Agent traces</p>
            <h2 className="mt-5 font-display track-h2 text-[30px] leading-[1.06] text-text lg:text-[50px]">
              Open one trace,
              <br />
              see the whole run
            </h2>
            <p className="mt-5 text-[14.5px] leading-[1.62] text-text-faint lg:text-[16px]">
              Nested spans across tools, retrievals and model calls, with parallel branches kept
              intact. The slow one is obvious at a glance.
            </p>
            <Link
              href="/demo/traces"
              className="mt-6 inline-flex items-center gap-2.5 text-[15px] font-semibold text-text transition-opacity hover:opacity-80"
            >
              Open a sample trace
              <span aria-hidden="true" className="text-accent">
                &rarr;
              </span>
            </Link>
          </div>

          {/* Waterfall */}
          <div className="min-w-0 flex-1 overflow-hidden rounded-panel border border-border bg-bg-elev">
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent"
                />
                <span className="truncate font-mono text-[13px] text-text-muted">
                  trace_9f21c4 · refund-agent
                </span>
              </div>
              <span className="shrink-0 font-mono text-[13px] text-text-faint">4.18 s</span>
            </div>
            <div className="overflow-x-auto px-5 py-5">
              {/* Rows arrive top to bottom and each bar wipes along its track,
                  so the waterfall reads as the run replaying rather than as a
                  static chart that faded in. */}
              <Reveal
                className="flex min-w-[440px] flex-col gap-3.5"
                kind="waterfall"
                stagger={70}
              >
                {SPANS.map((s) => (
                  <div key={s.name} className="flex items-center gap-4">
                    <span
                      className="w-[150px] shrink-0 truncate font-mono text-[12.5px] text-text-muted lg:w-[220px]"
                      style={{ paddingLeft: s.depth * 16 }}
                    >
                      {s.name}
                    </span>
                    <span className="relative h-2.5 flex-1 rounded-full bg-track">
                      <span
                        data-sl-bar
                        className={`absolute inset-y-0 rounded-full ${BAR_TONE[s.tone]}`}
                        style={{ left: `${s.start}%`, width: `${s.width}%` }}
                      />
                    </span>
                  </div>
                ))}
              </Reveal>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
