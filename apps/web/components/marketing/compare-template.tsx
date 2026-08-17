import Link from 'next/link'
import { Check, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-jsonld'
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
  /** Optional related-reading node rendered under the closing line (e.g. a link to a deeper blog post). */
  relatedNote?: React.ReactNode
  /** Year shown next to the H1 and used in the FAQ canonical URL. Defaults to the current year. */
  year?: number
  /** Content-authored last-updated date (ISO 'YYYY-MM-DD'). Drives the visible "Updated" text and JSON-LD dateModified so they reflect the true content date, not the deploy date. */
  lastUpdated?: string
}

const SITE_URL = 'https://www.spanlens.io'

function verdictLabel(value: Verdict | string): string {
  if (value === 'yes') return 'Yes'
  if (value === 'no') return 'No'
  if (value === 'partial') return 'Partial'
  return value
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

interface FaqEntry {
  question: string
  answer: string
}

function buildFaqEntries(
  competitor: string,
  whySpanlens: ComparePoint[],
  whyCompetitor: ComparePoint[],
): FaqEntry[] {
  const fromSpanlens = whySpanlens.map<FaqEntry>((p) => ({
    question: `Why pick Spanlens over ${competitor} for "${p.title}"?`,
    answer: p.body,
  }))
  const fromCompetitor = whyCompetitor.map<FaqEntry>((p) => ({
    question: `When is ${competitor} a better fit than Spanlens for "${p.title}"?`,
    answer: p.body,
  }))
  return [...fromSpanlens, ...fromCompetitor]
}

function buildFaqJsonLd(competitor: string, faqs: FaqEntry[], slug: string): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/compare/${slug}#faq`,
    name: `Spanlens vs ${competitor} FAQ`,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  }
  return JSON.stringify(payload)
}

function buildSoftwareCompareJsonLd(
  competitor: string,
  slug: string,
  year: number,
  lastUpdated?: string,
): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SITE_URL}/compare/${slug}`,
    url: `${SITE_URL}/compare/${slug}`,
    name: `Spanlens vs ${competitor} · ${year}`,
    inLanguage: 'en',
    ...(lastUpdated ? { dateModified: lastUpdated } : {}),
    isPartOf: {
      '@type': 'WebSite',
      name: 'Spanlens',
      url: SITE_URL,
    },
    // Reference the product entity declared on the homepage rather than
    // re-declaring a partial copy. Two divergent SoftwareApplication nodes for
    // the same product break entity reconciliation, and the partial copy also
    // failed Google's Software App rich-result check on every comparison page
    // (Ahrefs 2026-07-29: "Missing required aggregateRating or review").
    about: { '@id': `${SITE_URL}/#software` },
    mentions: {
      '@type': 'Thing',
      name: competitor,
    },
  }
  return JSON.stringify(payload)
}

function slugFromCompetitor(competitor: string): string {
  return competitor
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function CompareTemplate({
  competitor,
  tagline,
  tldr,
  whySpanlens,
  whyCompetitor,
  groups,
  closing,
  relatedNote,
  year,
  lastUpdated,
}: CompareTemplateProps) {
  const resolvedYear = year ?? new Date().getUTCFullYear()
  const slug = slugFromCompetitor(competitor)
  const faqs = buildFaqEntries(competitor, whySpanlens, whyCompetitor)
  const faqJsonLd = buildFaqJsonLd(competitor, faqs, slug)
  const pageJsonLd = buildSoftwareCompareJsonLd(competitor, slug, resolvedYear, lastUpdated)
  const allRows = groups.flatMap((g) =>
    g.rows.map((r) => ({ ...r, groupTitle: g.title })),
  )

  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav />
      <BreadcrumbJsonLd
        trail={[
          { name: 'Compare', path: '/compare' },
          { name: `Spanlens vs ${competitor}`, path: `/compare/${slug}` },
        ]}
      />

      {/* Structured data for SEO/AEO. Inline <script> ships JSON-LD in the SSR HTML so
          search and LLM crawlers (many of which don't execute JS) can read it. The React
          19 dev warning about <script> in the tree is harmless noise here. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLd }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: pageJsonLd }}
      />

      {/* Hero. Centred per M6: the comparison pages are entry points from
          search, so the title carries the page rather than a left-aligned
          article opener. */}
      <section className="mx-auto max-w-[1000px] px-6 pb-12 pt-20 text-center">
        <Link
          href="/compare"
          className="eyebrow inline-block transition-colors hover:text-text-muted"
        >
          ← All comparisons
        </Link>
        <h1 className="font-display track-h2 mt-4 text-[40px] leading-[1.12] text-text sm:text-[46px]">
          Spanlens <span className="text-text-faint">vs</span> {competitor}{' '}
          <span className="text-text-faint">· {resolvedYear}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-[640px] text-[16.5px] leading-[1.6] text-text-muted">
          {tagline}
        </p>

        <div className="mt-10 rounded-card border border-border bg-bg-elev p-6 text-left">
          <div className="eyebrow mb-2">Summary</div>
          <p className="text-[14px] leading-relaxed text-text-muted">{tldr}</p>
        </div>
      </section>

      {/* Machine-readable at-a-glance table. Semantic <table> so search engines and LLMs can parse it. */}
      <section className="max-w-[1000px] mx-auto px-6 pb-4">
        <h2 className="font-display track-h3 mb-4 text-[24px] text-text">
          At a glance: Spanlens vs {competitor} ({resolvedYear})
        </h2>
        {/* The competitor column is deliberately one step quieter than ours.
            This is our page; the honest data stays, the emphasis does not. */}
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-[13.5px]">
            <caption className="sr-only">
              Side-by-side feature comparison of Spanlens and {competitor} in {resolvedYear}.
            </caption>
            <thead>
              <tr className="bg-bg-sunk">
                <th scope="col" className="eyebrow border-b border-border px-5 py-3 text-left">
                  Feature
                </th>
                <th scope="col" className="eyebrow border-b border-border px-5 py-3 text-left">
                  Spanlens
                </th>
                <th scope="col" className="eyebrow border-b border-border px-5 py-3 text-left">
                  {competitor}
                </th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((row, i) => (
                <tr key={`${row.groupTitle}-${row.feature}`}>
                  <th
                    scope="row"
                    className={cn(
                      'px-5 py-3 text-left align-top font-medium text-text',
                      i < allRows.length - 1 && 'border-b border-border',
                    )}
                  >
                    {row.feature}
                  </th>
                  <td
                    className={cn(
                      'px-5 py-3 align-top text-text',
                      i < allRows.length - 1 && 'border-b border-border',
                    )}
                  >
                    {verdictLabel(row.spanlens)}
                  </td>
                  <td
                    className={cn(
                      'px-5 py-3 align-top text-text-faint',
                      i < allRows.length - 1 && 'border-b border-border',
                    )}
                  >
                    {verdictLabel(row.competitor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[11px] text-text-faint">
          Updated {lastUpdated ?? new Date().toISOString().slice(0, 10)}. Scroll for the grouped view with notes below.
        </p>
      </section>

      {/* Why Spanlens */}
      <section className="max-w-[1000px] mx-auto px-6 py-12">
        <h2 className="font-display track-h3 mb-6 text-[24px] text-text">
          Why teams pick Spanlens over {competitor}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {whySpanlens.map((p) => (
            <div key={p.title} className="rounded-card border border-border bg-bg-elev p-5">
              <h3 className="mb-2 text-[15px] font-semibold text-text">{p.title}</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature comparison table (visual, grouped) */}
      <section className="max-w-[1000px] mx-auto px-6 py-12">
        <h2 className="font-display track-h3 mb-6 text-[24px] text-text">
          Feature-by-feature
        </h2>
        <div className="overflow-hidden rounded-card border border-border">
          {groups.map((group, gi) => (
            <div key={group.title} className={cn(gi > 0 && 'border-t border-border')}>
              <div className="eyebrow bg-bg-sunk px-5 py-3">
                {group.title}
              </div>
              <div className="grid grid-cols-[1fr_120px_120px] text-[13px]">
                <div className="eyebrow border-b border-border bg-bg px-5 py-3">
                  Feature
                </div>
                <div className="eyebrow border-b border-border bg-bg px-3 py-3 text-center">
                  Spanlens
                </div>
                <div className="eyebrow border-b border-border bg-bg px-3 py-3 text-center">
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
          Last updated {lastUpdated ?? new Date().toISOString().slice(0, 10)} · Spot something inaccurate?{' '}
          <a href="mailto:support@spanlens.io" className="underline hover:text-text-muted">
            Let us know
          </a>
          .
        </p>
      </section>

      {/* When competitor is better */}
      <section className="max-w-[1000px] mx-auto px-6 py-12">
        <h2 className="font-display track-h3 mb-2 text-[24px] text-text">
          When {competitor} might be the better fit
        </h2>
        <p className="text-[13px] text-text-muted mb-6">
          We don&apos;t think every team should pick us. Here&apos;s where {competitor} legitimately wins.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {whyCompetitor.map((p) => (
            <div key={p.title} className="rounded-card border border-border bg-bg p-5">
              <h3 className="mb-2 text-[15px] font-semibold text-text">{p.title}</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ rendered for users; FAQ JSON-LD above mirrors this content for search engines. */}
      <section className="max-w-[1000px] mx-auto px-6 py-12">
        <h2 className="font-display track-h3 mb-6 text-[24px] text-text">
          Frequently asked questions
        </h2>
        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-bg-elev">
          {faqs.map((f) => (
            <details key={f.question} className="group px-6 py-5">
              <summary className="cursor-pointer list-none text-[14.5px] font-semibold text-text">
                {f.question}
              </summary>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-text-muted">{f.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA. M6 puts this on the accent tint with the copy and the actions on
          one line, so the page ends on the single warm surface it has. */}
      <section className="mx-auto max-w-[1000px] px-6 py-16">
        <div className="rounded-card border border-accent-border bg-accent-bg p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-[520px]">
              <h2 className="font-display track-quote text-[20px] text-text">
                Already on {competitor}?
              </h2>
              {closing && (
                <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">{closing}</p>
              )}
              {relatedNote && (
                <p className="mt-2 text-[13px] leading-relaxed text-text-faint">{relatedNote}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/docs/quick-start">Read the docs</Link>
              </Button>
              <Button asChild variant="signal" className="rounded-full">
                <Link href="/signup">Start free</Link>
              </Button>
            </div>
          </div>
          <p className="mt-6 font-mono text-[11px] text-text-faint">
            Free tier · No credit card · Self-host with Docker
          </p>
        </div>
      </section>

      <Footer />
    </div>
  )
}
