import type React from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { cn } from '@/lib/utils'

const PRICING_DESCRIPTION =
  'Spanlens pricing: Free (50K req/mo), Pro $29/mo (100K req, 90-day retention), Team $149/mo (1M req, 365-day retention). Open source LLM observability. Self-hostable under MIT.'

export const metadata = {
  alternates: { canonical: '/pricing' },
  title: 'Pricing · Spanlens LLM Observability',
  description: PRICING_DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'Spanlens Pricing — Free, Pro $29, Team $149',
    description: PRICING_DESCRIPTION,
    url: '/pricing',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spanlens Pricing — Free, Pro $29, Team $149',
    description: PRICING_DESCRIPTION,
    images: ['/icon.png'],
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
    a: 'Yes. Spanlens is fully MIT licensed with no ee/ folder. Run docker compose up on your own infrastructure and you get every feature listed above with zero license fee, no seat limit, and no usage cap. Self-hosted instances ingest into your own ClickHouse and Postgres. The hosted plans pay for managed infrastructure, not features.',
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
        ingest into your own ClickHouse and Postgres. The hosted plans above pay for managed infrastructure,
        not features. See the{' '}
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
    a: 'Yes. Plan changes are immediate and prorated. Cancellations take effect at the end of your current billing period — your data stays accessible for your plan\'s retention window so you can export before downgrade.',
  },
]

const pricingJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
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
    {
      '@type': 'Offer',
      name: 'Enterprise',
      price: '0',
      priceCurrency: 'USD',
      description: 'Custom volume, SSO (SAML/Okta), dedicated SLA. Contact for pricing.',
    },
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
      '50K requests / month',
      '60 req/min rate limit',
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
      '300 req/min rate limit',
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
      '1,500 req/min rate limit',
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
      'Custom rate limit',
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
    cta: 'Contact us',
    href: 'mailto:hi@spanlens.io',
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

      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-10">
          <h1 className="text-[36px] font-semibold tracking-[-0.6px] text-text mb-3">Spanlens Pricing — LLM Observability for Every Stage</h1>
          <p className="text-[16px] text-text-muted">
            Start free. Scale as you grow. Cancel anytime. Switching from{' '}
            <Link href="/compare/langfuse" className="text-accent hover:opacity-80">Langfuse</Link>
            {' '}or{' '}
            <Link href="/compare/helicone" className="text-accent hover:opacity-80">Helicone</Link>?
            See side-by-side comparisons.
          </p>
        </div>

        {/* Common features */}
        <div className="max-w-3xl mx-auto mb-14 rounded-xl border border-border bg-bg-elev px-6 py-5 text-sm">
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

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'rounded-xl border flex flex-col overflow-hidden',
                plan.highlight ? 'border-accent' : 'border-border',
              )}
            >
              {plan.highlight && (
                <div className="text-center py-1.5 bg-accent text-bg text-[11px] font-semibold tracking-wide uppercase">
                  Most popular
                </div>
              )}
              <div className={cn('flex-1 p-6', plan.highlight ? 'bg-accent-bg' : 'bg-bg-elev')}>
                <h2 className="text-[18px] font-semibold text-text mb-1">{plan.name}</h2>
                <p className="text-[13px] text-text-muted mb-4">{plan.description}</p>
                <div className="mb-1">
                  <span className="font-mono text-[32px] font-medium tracking-[-0.5px] text-text">{plan.price}</span>
                  <span className="font-mono text-[12px] text-text-muted">/mo</span>
                </div>
                {plan.overage ? (
                  <p className="font-mono text-[11px] text-text-faint mb-5">+ {plan.overage}</p>
                ) : (
                  <div className="mb-5" />
                )}
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-[13px] text-text-muted">
                      <Check className="h-3.5 w-3.5 text-good shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={cn(
                    'block w-full h-9 rounded-[6px] text-[13px] font-medium text-center leading-9 transition-opacity hover:opacity-90',
                    plan.highlight
                      ? 'bg-accent text-bg'
                      : 'border border-border bg-bg text-text',
                  )}
                >
                  {plan.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Overage policy */}
        <div className="mt-16 rounded-xl border border-border bg-bg-elev p-6 max-w-3xl mx-auto">
          <h3 className="font-semibold text-[15px] text-text mb-3">What happens if I go over my quota?</h3>
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
              <dd>Default 5× the soft limit. Past this, requests return 429 even with overage enabled. Adjustable 1–100× in settings.</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-x-4">
              <dt className="font-semibold text-text">Cost certainty mode</dt>
              <dd>Flip overage off in settings to hard-block at your quota instead.</dd>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-x-4">
              <dt className="font-semibold text-text">Free plan</dt>
              <dd>Proxy keeps working past 50K, but logging pauses (we don&apos;t want to break your app). Upgrade to Pro to resume logging plus overage.</dd>
            </div>
          </dl>
          <Link
            href="/docs/features/billing"
            className="text-[13px] text-accent hover:opacity-80 transition-opacity inline-flex items-center gap-1"
          >
            Full billing &amp; quota docs →
          </Link>
        </div>

        {/* Pricing FAQ — commercial-intent questions for AI search citation */}
        <div className="mt-12 max-w-3xl mx-auto">
          <h2 className="text-[20px] font-semibold tracking-[-0.4px] text-text mb-6">Pricing FAQ</h2>
          <div className="space-y-3">
            {PRICING_FAQS.map((f) => (
              <details key={f.q} className="group rounded-xl border border-border bg-bg-elev p-5">
                <summary className="cursor-pointer list-none text-[14px] font-medium text-text">
                  {f.q}
                </summary>
                <div className="mt-3 text-[13px] text-text-muted leading-relaxed">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
