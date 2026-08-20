import { OG_IMAGE } from '@/lib/page-metadata'
import type React from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-jsonld'
import { cn } from '@/lib/utils'

const PRICING_DESCRIPTION =
  'Spanlens pricing: Free (50K req/mo), Pro $29/mo (100K req, 90-day retention), Team $149/mo (1M req, 365-day retention). Open source LLM observability. Self-hostable under MIT.'

export const metadata = {
  alternates: { canonical: '/pricing' },
  title: 'Pricing · Spanlens LLM Observability',
  description: PRICING_DESCRIPTION,
  openGraph: {
    siteName: 'Spanlens',
    type: 'website',
    title: 'Spanlens Pricing (Free, Pro $29, Team $149)',
    description: PRICING_DESCRIPTION,
    url: '/pricing',
    locale: 'en_US',
    images: OG_IMAGE,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spanlens Pricing (Free, Pro $29, Team $149)',
    description: PRICING_DESCRIPTION,
  },
}

// Plain-text FAQ versions used for JSON-LD FAQPage. Mirror the JSX answers
// below but stripped of components so search engines extract clean facts.
const PRICING_FAQS_TEXT: { q: string; a: string }[] = [
  {
    q: 'Is Spanlens cheaper than Langfuse Cloud or Helicone?',
    a: 'Spanlens Pro is $29/mo with 100K requests included plus $8 per extra 100K. Langfuse Cloud Hobby starts at $59/mo for the same tier of usage and Helicone Pro starts at $50/mo. Spanlens Team at $149/mo includes 1M requests with the lowest overage rate ($5 per 100K).',
  },
  {
    q: 'Can I self-host Spanlens for free?',
    a: 'Yes. Spanlens is fully MIT licensed with no ee/ folder. Run docker compose up on your own infrastructure and you get every feature listed above with zero license fee, no seat limit, and no usage cap. Self-hosted instances ingest into your own Postgres. The hosted plans pay for managed infrastructure, not features.',
  },
  {
    q: 'What counts as a "request"?',
    a: 'One outbound LLM call (an OpenAI/Anthropic/Gemini/Ollama completion or embedding) equals one request. Streaming responses count as one request regardless of how many chunks are produced. Failed upstream calls (4xx/5xx from the provider) are still logged and still count. Internal agent steps that do not call an LLM (tool runs, retries before any provider call, dashboard views) do not count.',
  },
  {
    q: 'Do I need a credit card to start?',
    a: 'No. The Free plan (50K requests/mo) requires only an email signup. You can upgrade to Pro or Team at any time without losing your historical data.',
  },
  {
    q: 'Can I switch plans or cancel anytime?',
    a: 'Yes. Plan changes are immediate and prorated. Cancellations take effect at the end of your current billing period. Your data stays accessible for your plan\'s retention window so you can export before downgrade.',
  },
]

const PRICING_FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Is Spanlens cheaper than Langfuse Cloud or Helicone?',
    a: (
      <>
        Spanlens Pro is <span className="font-mono">$29/mo</span> with 100K requests included plus{' '}
        <span className="font-mono">$8</span> per extra 100K. Langfuse Cloud Hobby starts at{' '}
        <span className="font-mono">$59/mo</span> for the same tier of usage and Helicone Pro starts at{' '}
        <span className="font-mono">$50/mo</span>. Spanlens Team at <span className="font-mono">$149/mo</span>{' '}
        includes 1M requests with the lowest overage rate (<span className="font-mono">$5</span> per 100K). Compare side-by-side on{' '}
        <Link href="/compare/langfuse" className="text-accent hover:opacity-80">Spanlens vs Langfuse</Link> and{' '}
        <Link href="/compare/helicone" className="text-accent hover:opacity-80">Spanlens vs Helicone</Link>.
      </>
    ),
  },
  {
    q: 'Can I self-host Spanlens for free?',
    a: (
      <>
        Yes. Spanlens is fully MIT licensed with no <code className="font-mono text-xs">ee/</code> folder. Run{' '}
        <code className="font-mono text-xs">docker compose up</code> on your own infrastructure and you get every
        feature listed above with zero license fee, no seat limit, and no usage cap. Self-hosted instances
        ingest into your own Postgres. The hosted plans above pay for managed infrastructure, not features.
        See the{' '}
        <Link href="/docs/self-host" className="text-accent hover:opacity-80">self-hosting guide</Link>.
      </>
    ),
  },
  {
    q: 'What counts as a "request"?',
    a: (
      <>
        One outbound LLM call (an OpenAI/Anthropic/Gemini/Ollama completion or embedding) equals one request.
        Streaming responses count as one request regardless of how many chunks are produced. Failed upstream
        calls (4xx/5xx from the provider) are still logged and still count, because most of the cost of logging
        is on ingest. Internal agent steps that don&apos;t call an LLM (tool runs, retries before any provider
        call, dashboard views) do not count.
      </>
    ),
  },
  {
    q: 'Do I need a credit card to start?',
    a: 'No. The Free plan (50K requests/mo) requires only an email signup. You can upgrade to Pro or Team at any time without losing your historical data.',
  },
  {
    q: 'Can I switch plans or cancel anytime?',
    a: 'Yes. Plan changes are immediate and prorated. Cancellations take effect at the end of your current billing period. Your data stays accessible for your plan\'s retention window so you can export before downgrade.',
  },
]

// Same `@id` as the homepage node: one product entity, described twice.
// See app/page.tsx for why there is no aggregateRating.
const pricingJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': 'https://www.spanlens.io/#software',
  name: 'Spanlens',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web, Linux, macOS, Windows (Docker)',
  url: 'https://www.spanlens.io',
  description:
    'Open source LLM observability platform: request logging, cost tracking, agent tracing, prompt versioning. One line to integrate.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description: '50K requests/month, 1 seat, 14-day log retention, community support.',
    },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '29',
      priceCurrency: 'USD',
      description:
        '100K requests/month, 3 seats, 90-day log retention, email support. Overage $8 per 100K extra requests.',
    },
    {
      '@type': 'Offer',
      name: 'Team',
      price: '149',
      priceCurrency: 'USD',
      description:
        '1M requests/month, 10 seats, 365-day log retention, Slack + webhooks, priority support. Overage $5 per 100K extra requests.',
    },
    // No Enterprise Offer. `price` is required and "contact for pricing" has
    // no number; the earlier `price: '0'` read as free, and the
    // priceSpecification that replaced it still failed validation ("Missing
    // required price property for Software App"). The plan stays in the
    // visible table, which is where a buyer looks for it anyway.
  ],
}

const pricingFaqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': 'https://www.spanlens.io/pricing#faq',
  mainEntity: PRICING_FAQS_TEXT.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    description: 'For personal projects and exploration',
    features: [
      '50K requests / month, then a hard 429',
      '1 seat',
      '1 workspace',
      'Unlimited projects',
      '14-day log retention',
      'All core features included',
      'CSV + JSON export',
      'Community support',
    ],
    overage: null,
    cta: 'Start free',
    href: '/signup',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$29',
    description: 'For solo developers shipping to production',
    features: [
      '100K requests / month',
      '3 seats',
      '2 workspaces',
      'Unlimited projects',
      '90-day log retention',
      '5 alerts',
      'Email notifications',
      'CSV + JSON export',
      'Email support',
    ],
    overage: '$8 / 100K extra requests',
    cta: 'Start Pro',
    href: '/signup?plan=pro',
    highlight: true,
  },
  {
    name: 'Team',
    price: '$149',
    description: 'For teams that need full visibility',
    features: [
      '1M requests / month',
      '10 seats',
      '5 workspaces',
      'Unlimited projects',
      '365-day log retention',
      'Unlimited alerts',
      'Email + Slack notifications',
      'Webhooks',
      'CSV + JSON export',
      'Priority support',
    ],
    overage: '$5 / 100K extra requests',
    cta: 'Start Team',
    href: '/signup?plan=team',
    highlight: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'For large teams with advanced needs',
    features: [
      'Custom requests / month',
      'Unlimited seats',
      'Unlimited workspaces',
      'Unlimited projects',
      '365-day log retention (extendable by contract)',
      'Unlimited alerts',
      'Email + Slack + Discord',
      'Webhooks',
      'CSV + JSON export',
      'SSO (SAML / Okta)',
      'Dedicated support + SLA',
    ],
    overage: null,
    cta: 'Talk to sales',
    href: 'mailto:hi@spanlens.io?subject=Spanlens%20Enterprise%20inquiry&body=Hi%20Spanlens%20team%2C%0A%0AWe%27re%20interested%20in%20the%20Enterprise%20plan.%0A%0ACompany%3A%20%0AExpected%20monthly%20request%20volume%3A%20%0AWhat%20we%20need%20(SSO%2C%20on-prem%2C%20custom%20SLA%2C%20etc.)%3A%20%0A',
    highlight: false,
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd) }}
      />
      {/* Nav */}
      <MarketingNav />
      <BreadcrumbJsonLd trail={[{ name: 'Pricing', path: '/pricing' }]} />

      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="mx-auto mb-12 max-w-[760px] text-center">
          <h1 className="font-display track-h2 mb-4 text-[40px] leading-[1.12] text-text sm:text-[46px]">
            Spanlens Pricing for LLM Observability at Every Stage
          </h1>
          <p className="text-[16.5px] leading-[1.6] text-text-muted">
            Start free. Scale as you grow. Cancel anytime. Switching from{' '}
            <Link href="/compare/langfuse" className="text-accent hover:opacity-80">Langfuse</Link>
            {' '}or{' '}
            <Link href="/compare/helicone" className="text-accent hover:opacity-80">Helicone</Link>?
            See side-by-side comparisons.
          </p>
        </div>

        {/* Common features */}
        <div className="max-w-3xl mx-auto mb-14 rounded-card border border-border bg-bg-elev px-6 py-5 text-sm">
          <p className="font-semibold text-text mb-2.5">Every plan includes</p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-1.5 gap-x-6 text-text-muted">
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              <code className="font-mono text-xs bg-bg px-1.5 py-0.5 rounded border border-border">npx @spanlens/cli init</code>
              <span>1-command setup</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              Self-hostable (Docker)
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              OpenAI / Anthropic / Gemini
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              Agent tracing (Gantt view)
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              PII + prompt-injection detection
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              Anomaly detection (3σ)
            </li>
          </ul>
        </div>

        {/* Self-host callout, separated from the paid grid so it's clear self-host is free, not a tier add-on */}
        <div className="max-w-3xl mx-auto mb-10 rounded-card border border-accent-border bg-accent-bg/40 px-6 py-4 text-[13px] flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <strong className="text-text font-semibold">Or self-host for free.</strong>
            {' '}Spanlens is fully MIT, no <code className="font-mono text-xs">ee/</code> folder. Run
            {' '}<code className="font-mono text-xs">docker compose up</code> on your own infrastructure and
            get every feature listed below at zero cost.
          </div>
          <Link
            href="/self-hosting"
            className="shrink-0 text-accent hover:opacity-80 font-medium font-mono text-[12px]"
          >
            Self-host guide →
          </Link>
        </div>

        {/* Plan cards. The highlighted plan is marked by an accent hairline, a
            tinted ground and a badge; everything else stays neutral so the one
            recommendation is unambiguous. */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'flex flex-col rounded-card border p-6',
                plan.highlight ? 'border-accent bg-accent-bg' : 'border-border bg-bg-elev',
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-[16px] font-semibold text-text">{plan.name}</h2>
                {plan.highlight && (
                  <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-accent-fg">
                    Most popular
                  </span>
                )}
              </div>
              {/* Fixed height keeps the four price rows on one baseline even
                  when a description wraps to two lines. */}
              <p className="mb-5 min-h-[38px] text-[13px] leading-[1.45] text-text-muted">
                {plan.description}
              </p>
              <div className="mb-1 flex items-baseline gap-1.5">
                <span className="font-display track-h2 text-[40px] leading-none text-text">
                  {plan.price}
                </span>
                {/* "Custom / month" is nonsense, so the cadence suffix only
                    rides along with an actual figure. */}
                {plan.price.startsWith('$') && (
                  <span className="text-[13.5px] text-text-faint">/ month</span>
                )}
              </div>
              {plan.overage ? (
                <p className="mb-6 font-mono text-[11px] text-text-faint">+ {plan.overage}</p>
              ) : (
                <div className="mb-6" />
              )}
              <Button
                asChild
                variant={plan.highlight ? 'signal' : 'outline'}
                className="w-full rounded-full"
              >
                <Link href={plan.href}>{plan.cta}</Link>
              </Button>
              <ul className="mt-6 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-text-muted">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-[7px] h-1 w-1 shrink-0 rounded-full',
                        plan.highlight ? 'bg-accent' : 'bg-text-faint',
                      )}
                    />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Tax note. Paddle is merchant of record and adds VAT/GST at checkout */}
        <p className="mt-6 text-center text-[12px] text-text-faint">
          Prices in USD, exclusive of applicable taxes. VAT/GST is added at checkout by Paddle.
        </p>

        {/* Overage policy */}
        <div className="mx-auto mt-16 max-w-3xl rounded-card border border-border bg-bg-elev p-6">
          <h3 className="mb-3 text-[15px] font-semibold text-text">What happens if I go over my quota?</h3>
          <p className="text-[13px] text-text-muted mb-4">
            Paid plans default to <strong className="text-text">overage billing</strong> so you&apos;re never
            surprise-blocked mid-month:
          </p>
          <dl className="text-[13px] text-text-muted space-y-3 mb-4">
            <div className="grid grid-cols-[140px_1fr] gap-x-4">
              <dt className="font-semibold text-text">Soft limit</dt>
              <dd>Your plan&apos;s included quota (100K on Pro, 1M on Team). Extra requests pass through and accumulate.</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-x-4">
              <dt className="font-semibold text-text">Overage billing</dt>
              <dd>Pro <span className="font-mono">$8</span> / Team <span className="font-mono">$5</span> per 100K extra requests, charged immediately at the end of your billing period (not deferred to next month).</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-x-4">
              <dt className="font-semibold text-text">Hard cap</dt>
              <dd>Default 5× the soft limit. Past this, requests return 429 even with overage enabled. Adjustable 1 to 100× in settings.</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-x-4">
              <dt className="font-semibold text-text">Cost certainty mode</dt>
              <dd>Flip overage off in settings to hard-block at your quota instead.</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-x-4">
              <dt className="font-semibold text-text">Free plan</dt>
              <dd>No overage. At <span className="font-mono">50K</span> requests/month the proxy returns a hard <span className="font-mono">429</span> so a runaway dev loop can&apos;t quietly cost you money. Upgrade to Pro for a soft limit with authorized overage.</dd>
            </div>
          </dl>
          <Link
            href="/docs/features/billing"
            className="text-[13px] text-accent hover:opacity-80 transition-opacity inline-flex items-center gap-1"
          >
            Full billing &amp; quota docs →
          </Link>
        </div>

        {/* Pricing FAQ. Commercial-intent questions for AI search citation */}
        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="font-display track-h3 mb-6 text-[24px] text-text">Pricing FAQ</h2>
          {/* One panel with hairline-divided rows rather than a stack of cards:
              the questions read as a single list, and the page already carries
              four plan cards competing for attention. */}
          <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-bg-elev">
            {PRICING_FAQS.map((f) => (
              <details key={f.q} className="group px-6 py-5">
                <summary className="cursor-pointer list-none text-[14.5px] font-semibold text-text">
                  {f.q}
                </summary>
                <div className="mt-2.5 text-[13.5px] leading-relaxed text-text-muted">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
