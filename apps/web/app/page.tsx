import { OG_IMAGE } from '@/lib/page-metadata'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { Hero } from '@/components/landing/hero'
import { LedgerBand } from '@/components/landing/ledger-band'
import { Bento } from '@/components/landing/bento'
import { TraceSlab } from '@/components/landing/trace-slab'
import { IntegrationsArc } from '@/components/landing/integrations-arc'
import { Faq } from '@/components/landing/faq'
import { Plans, type LandingPlan } from '@/components/landing/plans'
import { ClosingCta } from '@/components/landing/closing-cta'

// The root layout deliberately omits `openGraph.url` so child pages don't
// inherit the homepage URL (see app/layout.tsx). The homepage is the one page
// where that URL is correct, so it declares the block itself. Declaring
// `openGraph` replaces the layout's copy wholesale rather than merging, so
// `type`/`siteName`/`locale` are repeated here on purpose.
export const metadata = {
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Spanlens',
    locale: 'en_US',
    url: '/',
    images: OG_IMAGE,
  },
}

const SITE_URL = 'https://www.spanlens.io'

// Not all of these have a card on the page any more, but they are the canonical
// capability list behind the SoftwareApplication `featureList` below.
const FEATURES = [
  {
    kicker: '01',
    title: 'Request log',
    body: 'Every call with model, tokens, cost, latency, and full body. Filter, group, export.',
    accent: '$0.0021',
  },
  {
    kicker: '02',
    title: 'Cost tracking',
    body: 'Per-request breakdown, daily rollups, budget alerts before you blow the month.',
    accent: '−38%',
  },
  {
    kicker: '03',
    title: 'Agent tracing',
    body: 'Multi-step workflows as waterfall span trees. Find the one step that took 18s.',
    accent: '12 spans',
  },
  {
    kicker: '04',
    title: 'Anomaly detection',
    body: '3σ deviations in latency or cost vs. your 7-day baseline, flagged on arrival.',
    accent: '3.1σ',
  },
  {
    kicker: '05',
    title: 'PII + injection scan',
    body: 'Regex detection on request bodies at log time. API keys auto-masked before storage; PII patterns flagged for review.',
    accent: 'SSN · email',
  },
  {
    kicker: '06',
    title: 'Model recommender',
    body: '"Your gpt-4o calls look like classification, try gpt-4o-mini." With numbers.',
    accent: '−$412/mo',
  },
  {
    kicker: '07',
    title: 'Evals',
    body: 'LLM-as-judge scores every response 0 to 1. Know if v8 is actually better than v7, not just cheaper.',
    accent: '0.82 avg',
  },
  {
    kicker: '08',
    title: 'Experiments & datasets',
    body: 'Replay a fixed dataset across prompt versions and models. Quality, cost, and latency side by side.',
    accent: 'v7 vs v8',
  },
  {
    kicker: '09',
    title: 'User analytics',
    body: 'Per end-user and per-session cost, volume, and errors. Find the customer burning your budget.',
    accent: '1,204 users',
  },
]

// Canonical plan list. It renders the plan ledger AND derives the Offer blocks
// in the structured data below, so the two cannot drift apart. These figures
// must stay in step with /pricing and with PLAN_LIMITS in the server's quota
// module; the Figma comp carried placeholder numbers, not these.
const PLANS: LandingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    unit: '/mo',
    blurb: 'For the first integration.',
    bullets: [
      '50K req / mo',
      '14 day retention',
      '1 seat',
      'All core features',
      'Community support',
    ],
    cta: 'Start free',
    href: '/signup',
    primary: false,
  },
  {
    name: 'Pro',
    price: '$29',
    unit: '/mo',
    blurb: 'For features already in production.',
    bullets: [
      '100K req / mo',
      '90 day retention',
      '3 seats',
      '5 alerts · email notify',
      '+$8 / 100K extra',
    ],
    cta: 'Start Pro',
    href: '/signup?plan=pro',
    primary: true,
    tag: 'Most popular',
  },
  {
    name: 'Team',
    price: '$149',
    unit: '/mo',
    blurb: 'For several products and tighter control.',
    bullets: [
      '1M req / mo',
      '365 day retention',
      '10 seats',
      'Slack · webhooks · unlimited alerts',
      '+$5 / 100K extra',
    ],
    cta: 'Start Team',
    href: '/signup?plan=team',
    primary: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    unit: '',
    blurb: 'For volume, SSO and a signed contract.',
    bullets: [
      'Custom volume & rate limits',
      '365 day retention (extendable)',
      'SSO (SAML / Okta)',
      'Unlimited seats',
      'Dedicated support + SLA',
    ],
    cta: 'Contact us',
    href: 'mailto:hi@spanlens.io',
    primary: false,
  },
]

const FAQS: [string, string][] = [
  [
    'How does instrumentation work?',
    'Swap the provider SDK for our drop-in. Same surface, same types. We record the full request and response on the wire, with no extra round-trip and no sampling by default.',
  ],
  [
    'What about latency overhead?',
    'p99 overhead is under 3ms. Ingestion happens async in a worker. If we ever fail, your request completes anyway. Spanlens never sits on the critical path.',
  ],
  [
    'How do you handle PII?',
    'PII detectors (SSN, credit card, email, IBAN, passport, etc.) run at log time and flag matches for review in the Security dashboard, without blocking the request. API keys that slip into prompts are auto-masked before the row lands on disk. For workloads where prompt bodies must not be stored at all, opt out per-call with X-Spanlens-Log-Body: meta.',
  ],
  [
    'Do you support OpenTelemetry?',
    'Yes. OTLP/HTTP ingest and export. Your existing OTel tracing flows into the same span store; LLM spans get LLM-specific attributes on top.',
  ],
  [
    "What's the data retention?",
    'Free is 14 days. Pro is 90 days, Team is 365 days. Enterprise & self-hosted are configurable, including unlimited.',
  ],
  [
    'Can I export my data?',
    'Anytime. JSON, CSV, Parquet. Or pipe the raw stream to S3, BigQuery, or your warehouse via our sink connectors.',
  ],
  [
    'Can Spanlens tell me if a prompt actually got better?',
    'Yes. Evals scores responses with an LLM-as-judge on a 0 to 1 scale, per prompt version. Pair it with Experiments to replay a dataset across versions and models, so you compare quality, cost, and latency on the same inputs before you roll out.',
  ],
  [
    'Does Spanlens work for a whole team?',
    'Projects isolate workloads, roles and invitations manage access, and audit logs record every change. Team and Enterprise add Slack, webhooks, unlimited alerts, and SSO.',
  ],
]

// Canonical product entity for the whole site. Comparison and integration
// pages reference it by `@id` rather than declaring their own partial copy.
//
// No `aggregateRating` / `review`: Google wants one of them for the Software
// App rich result, and Ahrefs reports the absence as an error, but there are
// no genuine ratings to publish and inventing them would be worse than
// forgoing the rich result. Add real ones here if that ever changes.
const softwareApplicationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SITE_URL}/#software`,
  name: 'Spanlens',
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'LLM Observability',
  operatingSystem: 'Web, Linux, macOS, Windows (Docker)',
  url: SITE_URL,
  description:
    'Drop-in LLM observability for OpenAI, Anthropic, and Gemini. Logging, cost tracking, agent tracing, evals, anomaly detection, and PII scanning. Open source.',
  // Enterprise is excluded on purpose. `price` is required on an Offer, and
  // "contact us" has no number to put there; emitting the Offer without one
  // fails validation ("Missing required price property"), and inventing a
  // figure would be worse. The three priced plans carry the pricing signal.
  offers: PLANS.filter((p) => p.price !== 'Custom').map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: p.price.replace('$', ''),
    priceCurrency: 'USD',
    category: p.unit ? `subscription${p.unit}` : 'custom',
  })),
  featureList: FEATURES.map((f) => `${f.title}: ${f.body}`),
  softwareVersion: '0.6.1',
  license: 'https://opensource.org/licenses/MIT',
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(([q, a]) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: a,
    },
  })),
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MarketingNav signupLabel="Start free →" />
      {/* 01 */} <Hero />
      {/* 02 */} <LedgerBand />
      {/* 03 */} <Bento />
      {/* 04 */} <TraceSlab />
      {/* 05 */} <IntegrationsArc />
      {/*
        06 in the comp is a pull-quote band attributed to two named people at
        two named companies. Neither the people nor the companies exist
        anywhere in this repo, so shipping it would put fabricated customer
        testimonials on a live commercial page. The slot is filled by the FAQ,
        which is real and which the FAQPage structured data above requires to
        be visible. Restore the quote band only with real, attributable,
        consented quotes.
      */}
      <Faq items={FAQS} />
      {/* 07 */} <Plans plans={PLANS} />
      {/* 08 */} <ClosingCta />
      <Footer />
    </div>
  )
}
