import Link from 'next/link'
import { Check, Minus, X } from 'lucide-react'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { cn } from '@/lib/utils'

export type Verdict = 'yes' | 'no' | 'partial'

export interface CompareRow {
  feature: string
  spanlens: Verdict | string
  competitor: Verdict | string
  /** Optional note rendered under the row */
  note?: string
}

export interface CompareGroup {
  title: string
  rows: CompareRow[]
}

export interface ComparePoint {
  title: string
  body: string
}

export interface CompareTemplateProps {
  competitor: string
  /** Short headline shown under the title, e.g. "Drop-in proxy with eval built in" */
  tagline: string
  /** One-paragraph honest TL;DR */
  tldr: string
  /** Spanlens strengths against this specific competitor */
  whySpanlens: ComparePoint[]
  /** Cases where the competitor is the better fit — honesty earns trust */
  whyCompetitor: ComparePoint[]
  /** Detailed feature-by-feature comparison */
  groups: CompareGroup[]
  /** Short closing line above the CTA */
  closing?: string
}

function VerdictCell({ value }: { value: Verdict | string }) {
  if (value === 'yes') {
    return <Check className="h-4 w-4 text-good" aria-label="Yes" />
  }
  if (value === 'no') {
    return <X className="h-4 w-4 text-text-faint" aria-label="No" />
  }
  if (value === 'partial') {
    return <Minus className="h-4 w-4 text-text-muted" aria-label="Partial" />
  }
  return <span className="font-mono text-[12px] text-text-muted">{value}</span>
}

export function CompareTemplate({
  competitor,
  tagline,
  tldr,
  whySpanlens,
  whyCompetitor,
  groups,
  closing,
}: CompareTemplateProps) {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav />

      {/* Hero */}
      <section className="max-w-[1000px] mx-auto px-6 pt-20 pb-12">
        <Link
          href="/compare"
          className="font-mono text-[12px] text-text-faint hover:text-text-muted transition-colors"
        >
          ← All comparisons
        </Link>
        <h1 className="mt-4 text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text leading-[1.05]">
          Spanlens <span className="text-text-faint">vs</span> {competitor}
        </h1>
        <p className="mt-4 text-[18px] text-text-muted leading-relaxed">{tagline}</p>

        <div className="mt-8 rounded-xl border border-border bg-bg-elev p-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-2">Summary</div>
          <p className="text-[14px] text-text-muted leading-relaxed">{tldr}</p>
        </div>
      </section>

      {/* Why Spanlens */}
      <section className="max-w-[1000px] mx-auto px-6 py-12">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
          Why teams pick Spanlens over {competitor}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {whySpanlens.map((p) => (
            <div key={p.title} className="rounded-xl border border-border bg-bg-elev p-5">
              <h3 className="text-[15px] font-semibold text-text mb-2">{p.title}</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="max-w-[1000px] mx-auto px-6 py-12">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
          Feature-by-feature
        </h2>
        <div className="rounded-xl border border-border overflow-hidden">
          {groups.map((group, gi) => (
            <div key={group.title} className={cn(gi > 0 && 'border-t border-border')}>
              <div className="bg-bg-elev px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                {group.title}
              </div>
              <div className="grid grid-cols-[1fr_120px_120px] text-[13px]">
                <div className="px-5 py-2.5 border-b border-border bg-bg font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                  Feature
                </div>
                <div className="px-3 py-2.5 border-b border-border bg-bg font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint text-center">
                  Spanlens
                </div>
                <div className="px-3 py-2.5 border-b border-border bg-bg font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint text-center">
                  {competitor}
                </div>
                {group.rows.map((row, ri) => (
                  <div key={row.feature} className="contents">
                    <div
                      className={cn(
                        'px-5 py-3 text-text',
                        ri < group.rows.length - 1 && 'border-b border-border',
                      )}
                    >
                      {row.feature}
                      {row.note && (
                        <div className="mt-1 text-[11px] text-text-faint leading-relaxed">{row.note}</div>
                      )}
                    </div>
                    <div
                      className={cn(
                        'px-3 py-3 flex items-center justify-center',
                        ri < group.rows.length - 1 && 'border-b border-border',
                      )}
                    >
                      <VerdictCell value={row.spanlens} />
                    </div>
                    <div
                      className={cn(
                        'px-3 py-3 flex items-center justify-center',
                        ri < group.rows.length - 1 && 'border-b border-border',
                      )}
                    >
                      <VerdictCell value={row.competitor} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[11px] text-text-faint">
          Last updated {new Date().toISOString().slice(0, 10)} · Spot something inaccurate?{' '}
          <a href="mailto:support@spanlens.io" className="underline hover:text-text-muted">
            Let us know
          </a>
          .
        </p>
      </section>

      {/* When competitor is better */}
      <section className="max-w-[1000px] mx-auto px-6 py-12">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-2">
          When {competitor} might be the better fit
        </h2>
        <p className="text-[13px] text-text-muted mb-6">
          We don&apos;t think every team should pick us. Here&apos;s where {competitor} legitimately wins.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {whyCompetitor.map((p) => (
            <div key={p.title} className="rounded-xl border border-border bg-bg p-5">
              <h3 className="text-[15px] font-semibold text-text mb-2">{p.title}</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-[1000px] mx-auto px-6 py-16">
        <div className="rounded-xl border border-border bg-bg-elev p-8 text-center">
          {closing && (
            <p className="text-[15px] text-text-muted mb-5 max-w-[640px] mx-auto leading-relaxed">{closing}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link
              href="/signup"
              className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity"
            >
              Start free →
            </Link>
            <Link
              href="/docs/quick-start"
              className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors"
            >
              Read the docs
            </Link>
          </div>
          <p className="mt-4 font-mono text-[11px] text-text-faint">
            Free tier · No credit card · Self-host with Docker
          </p>
        </div>
      </section>

      <Footer />
    </div>
  )
}
