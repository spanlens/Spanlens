import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

const SITE_URL = 'https://www.spanlens.io'

export interface IntegrationStep {
  title: string
  body: string
  code?: string
  lang?: 'ts' | 'python' | 'bash' | 'http'
}

export interface IntegrationFaq {
  q: string
  a: string
}

export interface IntegrationTemplateProps {
  /** Brand name as shown in copy. */
  provider: string
  /** URL slug, e.g. 'openai'. */
  slug: string
  /** Provider home/docs URL for the external "Official" link. */
  providerUrl: string
  /** One-line value prop shown under the H1. */
  tagline: string
  /** 1-2 sentence intro paragraph. */
  intro: string
  /** Features Spanlens captures for this provider. */
  captured: string[]
  /** Step-by-step integration. */
  steps: IntegrationStep[]
  /** Provider-specific FAQ for AI search citation. */
  faqs: IntegrationFaq[]
}

export function IntegrationTemplate({
  provider,
  slug,
  providerUrl,
  tagline,
  intro,
  captured,
  steps,
  faqs,
}: IntegrationTemplateProps) {
  const title = `${provider} LLM Observability — Spanlens Integration`
  const description = `Log every ${provider} API call with Spanlens. Track cost, latency, tokens, and full request/response in one line. Open source, self-hostable.`

  const pageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${SITE_URL}/integrations/${slug}`,
    url: `${SITE_URL}/integrations/${slug}`,
    headline: `${provider} observability with Spanlens`,
    description,
    about: {
      '@type': 'SoftwareApplication',
      name: 'Spanlens',
      applicationCategory: 'DeveloperApplication',
      url: SITE_URL,
    },
    mentions: { '@type': 'Thing', name: provider },
    isPartOf: { '@type': 'WebSite', name: 'Spanlens', url: SITE_URL },
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/integrations/${slug}#faq`,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MarketingNav />

      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12">
        <Link
          href="/docs"
          className="font-mono text-[12px] text-text-faint hover:text-text-muted transition-colors"
        >
          ← Docs
        </Link>
        <h1 className="mt-4 text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text leading-[1.05]">
          {provider} observability with Spanlens
        </h1>
        <p className="mt-4 text-[18px] text-text-muted leading-relaxed">{tagline}</p>
        <p className="mt-4 text-[15px] text-text-muted leading-relaxed">{intro}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px]">
          <Link
            href="/signup"
            className="h-9 px-4 rounded-[6px] bg-accent text-bg font-medium leading-9 hover:opacity-90 transition-opacity"
          >
            Start free →
          </Link>
          <a
            href={providerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-4 rounded-[6px] border border-border text-text font-medium leading-9 hover:bg-bg-elev transition-colors"
          >
            {provider} docs ↗
          </a>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-4">
          What Spanlens captures for {provider}
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[14px] text-text-muted">
          {captured.map((c) => (
            <li key={c} className="flex items-start gap-2">
              <span className="text-good mt-0.5">✓</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-6">
          Integration steps
        </h2>
        <ol className="space-y-6">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-border bg-bg-elev p-5">
              <div className="flex items-start gap-3">
                <span className="shrink-0 h-7 w-7 rounded-full bg-accent text-bg font-mono text-[12px] font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <h3 className="text-[16px] font-semibold text-text mb-2">{step.title}</h3>
                  <p className="text-[14px] text-text-muted leading-relaxed">{step.body}</p>
                  {step.code && (
                    <pre className="mt-3 rounded-lg border border-border bg-bg p-4 overflow-x-auto">
                      <code className="font-mono text-[12px] text-text whitespace-pre">{step.code}</code>
                    </pre>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-text mb-6">
          {provider} integration FAQ
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

      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="rounded-xl border border-border bg-bg-elev p-6 text-center">
          <p className="text-[14px] text-text-muted mb-4">
            See every {provider} call in your dashboard within 60 seconds.
          </p>
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
        </div>
      </section>

      <Footer />
    </div>
  )
}
