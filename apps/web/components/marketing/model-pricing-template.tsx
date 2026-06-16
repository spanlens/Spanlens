import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

const SITE_URL = 'https://www.spanlens.io'

export interface UsageScenario {
  label: string
  inputTokens: number
  outputTokens: number
  requestsPerMonth: number
}

export interface ModelPricingTemplateProps {
  /** Human-readable model name shown in copy. */
  model: string
  /** URL slug, e.g. 'gpt-4o'. */
  slug: string
  /** Provider name shown in copy. */
  provider: string
  /** Provider's official pricing/docs URL. */
  providerUrl: string
  /** Short value prop. */
  tagline: string
  /** Input price per 1M tokens (USD). */
  inputPricePer1M: number
  /** Output price per 1M tokens (USD). */
  outputPricePer1M: number
  /** Optional cache-read price per 1M tokens. */
  cachedInputPricePer1M?: number
  /** Optional cache-write price per 1M tokens. */
  cachedWritePricePer1M?: number
  /** Token context window. */
  contextWindow: string
  /** Max output tokens. */
  maxOutput: string
  /** Release date string. */
  released: string
  /** What the model is best at. */
  bestFor: string[]
  /** Usage scenarios used to build the monthly cost table. */
  scenarios: UsageScenario[]
  /** Comparable models for the alternatives section. */
  alternatives: { name: string; href?: string; note: string }[]
  /** FAQ items specific to this model. */
  faqs: { q: string; a: string }[]
}

function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function calcMonthly(s: UsageScenario, inputPer1M: number, outputPer1M: number): number {
  const inputCost = (s.inputTokens * s.requestsPerMonth * inputPer1M) / 1_000_000
  const outputCost = (s.outputTokens * s.requestsPerMonth * outputPer1M) / 1_000_000
  return inputCost + outputCost
}

export function ModelPricingTemplate({
  model,
  slug,
  provider,
  providerUrl,
  tagline,
  inputPricePer1M,
  outputPricePer1M,
  cachedInputPricePer1M,
  cachedWritePricePer1M,
  contextWindow,
  maxOutput,
  released,
  bestFor,
  scenarios,
  alternatives,
  faqs,
}: ModelPricingTemplateProps) {
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${SITE_URL}/pricing/${slug}`,
    url: `${SITE_URL}/pricing/${slug}`,
    headline: `${model} pricing: cost per token and monthly estimates`,
    description: `${model} costs ${formatUsd(inputPricePer1M)} per 1M input tokens and ${formatUsd(outputPricePer1M)} per 1M output tokens. Real-world monthly cost scenarios and alternatives.`,
    datePublished: '2026-06-16',
    dateModified: '2026-06-16',
    author: { '@type': 'Organization', name: 'Spanlens', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'Spanlens',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.png` },
    },
    about: { '@type': 'Thing', name: model },
    mentions: { '@type': 'Organization', name: provider },
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/pricing/${slug}#faq`,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MarketingNav />

      <article className="max-w-3xl mx-auto px-6 py-20">
        <Link
          href="/llm-cost-tracking"
          className="font-mono text-[12px] text-text-faint hover:text-text-muted transition-colors"
        >
          ← LLM cost tracking
        </Link>
        <h1 className="mt-4 text-[36px] sm:text-[44px] font-semibold tracking-[-0.6px] text-text leading-[1.05]">
          {model} pricing
        </h1>
        <p className="mt-3 text-[17px] text-text-muted leading-relaxed">{tagline}</p>

        <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-bg-elev p-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Input
            </div>
            <div className="font-mono text-[28px] font-medium text-text">
              {formatUsd(inputPricePer1M)}
            </div>
            <div className="font-mono text-[11px] text-text-muted">per 1M tokens</div>
            {cachedInputPricePer1M !== undefined && (
              <div className="mt-2 font-mono text-[11px] text-text-faint">
                Cached input: {formatUsd(cachedInputPricePer1M)} per 1M
              </div>
            )}
            {cachedWritePricePer1M !== undefined && (
              <div className="font-mono text-[11px] text-text-faint">
                Cache write: {formatUsd(cachedWritePricePer1M)} per 1M
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border bg-bg-elev p-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
              Output
            </div>
            <div className="font-mono text-[28px] font-medium text-text">
              {formatUsd(outputPricePer1M)}
            </div>
            <div className="font-mono text-[11px] text-text-muted">per 1M tokens</div>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-border bg-bg-elev p-5">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[13px]">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Provider
              </dt>
              <dd className="text-text">{provider}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Context window
              </dt>
              <dd className="text-text font-mono">{contextWindow}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Max output
              </dt>
              <dd className="text-text font-mono">{maxOutput}</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Released
              </dt>
              <dd className="text-text">{released}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-3">
            What {model} is best for
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[14px] text-text-muted">
            {bestFor.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <span className="text-good mt-0.5">✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-3">
            Monthly cost scenarios
          </h2>
          <p className="text-[14px] text-text-muted leading-relaxed mb-4">
            Real-world estimates at common usage levels. Numbers assume no caching, no
            batching, and the standard tier price.
          </p>
          <div className="rounded-xl border border-border bg-bg-elev overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Use case
                  </th>
                  <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    In / req
                  </th>
                  <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Out / req
                  </th>
                  <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Reqs / mo
                  </th>
                  <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Monthly
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s, i, arr) => {
                  const monthly = calcMonthly(s, inputPricePer1M, outputPricePer1M)
                  return (
                    <tr key={s.label} className={i < arr.length - 1 ? 'border-b border-border' : ''}>
                      <td className="px-4 py-2.5 font-semibold text-text">{s.label}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-text-muted">
                        {s.inputTokens.toLocaleString('en-US')}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-text-muted">
                        {s.outputTokens.toLocaleString('en-US')}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-text-muted">
                        {s.requestsPerMonth.toLocaleString('en-US')}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-text">
                        {formatUsd(monthly)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-3">
            Alternatives to {model}
          </h2>
          <div className="space-y-3">
            {alternatives.map((alt) => (
              <div key={alt.name} className="rounded-xl border border-border bg-bg-elev p-5">
                <h3 className="text-[15px] font-semibold text-text mb-1">
                  {alt.href ? (
                    <Link href={alt.href} className="text-accent hover:opacity-80">
                      {alt.name}
                    </Link>
                  ) : (
                    alt.name
                  )}
                </h3>
                <p className="text-[13px] text-text-muted leading-relaxed">{alt.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-3">
            Track {model} usage with Spanlens
          </h2>
          <p className="text-[14px] text-text-muted leading-relaxed mb-4">
            Spanlens captures every {model} call with input + output tokens, exact cost,
            latency, and full request body. One line of code or a baseURL swap. Open
            source MIT licensed, self-hostable.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/signup"
              className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity text-center"
            >
              Start free →
            </Link>
            <Link
              href={`/integrations/${provider.toLowerCase()}`}
              className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors text-center"
            >
              {provider} integration guide
            </Link>
            <a
              href={providerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors text-center"
            >
              Official pricing ↗
            </a>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-4">
            FAQ
          </h2>
          <div className="space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-xl border border-border bg-bg-elev p-5">
                <summary className="cursor-pointer list-none text-[14px] font-medium text-text">
                  {f.q}
                </summary>
                <p className="mt-3 text-[13px] text-text-muted leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-8 font-mono text-[11px] text-text-faint">
          Last updated 2026-06-16. Prices in USD at the standard tier. Spot something out
          of date?{' '}
          <a href="mailto:hi@spanlens.io" className="underline hover:text-text-muted">
            Tell us
          </a>
          .
        </p>
      </article>

      <Footer />
    </div>
  )
}
