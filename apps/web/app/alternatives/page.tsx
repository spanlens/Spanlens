import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

export const metadata = {
  title: 'Best LLM Observability Alternatives · 2026',
  description:
    'Open-source and SaaS alternatives to Langfuse, Helicone, LangSmith, Braintrust, and Arize Phoenix in 2026. Honest tradeoffs, drop-in proxy install, MIT license, and self-host with one Docker command.',
  alternates: { canonical: '/alternatives' },
}

const SITE_URL = 'https://www.spanlens.io'
const YEAR = 2026

interface AlternativeEntry {
  slug: string
  competitor: string
  oneLine: string
  whySwitch: string
  installShape: string
  license: string
  selfHost: string
}

const ENTRIES: AlternativeEntry[] = [
  {
    slug: 'langfuse',
    competitor: 'Langfuse',
    oneLine:
      'The most mature OSS observability tool. We diverge on instrumentation model (proxy vs SDK), license boundary (full MIT vs OSS plus EE folder), and built-in eval shape.',
    whySwitch:
      'Teams pick Spanlens over Langfuse when they want a 1-line baseURL swap instead of wrapping every call, full MIT with no EE folder gating SCIM or audit logs, and statistical Prompt A/B (Welch t-test) built in.',
    installShape: 'SDK wrap or OTel exporter',
    license: 'MIT core + EE folder',
    selfHost: 'Yes, Docker Compose',
  },
  {
    slug: 'helicone',
    competitor: 'Helicone',
    oneLine:
      'The closest architectural match. Both are proxy-based, though Helicone entered maintenance mode after its 2026 Mintlify acquisition.',
    whySwitch:
      'Spanlens adds Critical Path agent tracing, Prompt A/B with Welch t-test, judge-to-human correlation tracking, and a ClickHouse fallback-replay safety net that survives transient backend outages without losing rows.',
    installShape: '1-line baseURL swap',
    license: 'Apache 2.0',
    selfHost: 'Yes, Docker Compose',
  },
  {
    slug: 'langsmith',
    competitor: 'LangSmith',
    oneLine:
      "LangChain's commercial offering. Excellent if you live inside LangChain, locked-in if you don't.",
    whySwitch:
      'Spanlens is framework-agnostic. The proxy works whether you use LangChain, LangGraph, Vercel AI SDK, or plain HTTP from any language. No callback handler required for off-chain code paths.',
    installShape: 'LangChain callback or SDK',
    license: 'Closed source',
    selfHost: 'Paid plan only',
  },
  {
    slug: 'braintrust',
    competitor: 'Braintrust',
    oneLine: 'Eval-first, closed-source SaaS. Strong eval UX.',
    whySwitch:
      'Spanlens bundles eval into a full observability platform with proxy-based logging, agent tracing, cost optimization, and Prompt A/B. You can self-host the whole thing with one Docker command instead of staying on a hosted-only product.',
    installShape: 'SDK wrap',
    license: 'Closed source',
    selfHost: 'No (cloud only)',
  },
  {
    slug: 'arize-phoenix',
    competitor: 'Arize Phoenix',
    oneLine: 'Source-available (ELv2) observability from Arize. Python-first, ML-engineer-leaning.',
    whySwitch:
      'Spanlens is built for application developers shipping LLM features. JS/TS gets equal-class SDK support, the install is a baseURL swap rather than an OTel pipeline, and the license is full MIT instead of ELv2.',
    installShape: 'OTel exporter or SDK',
    license: 'ELv2 (source-available)',
    selfHost: 'Yes, Docker',
  },
]

const MIGRATION_GUIDES = [
  { slug: 'from-langfuse', label: 'Migrate from Langfuse', minutes: 30 },
  { slug: 'from-helicone', label: 'Migrate from Helicone', minutes: 15 },
  { slug: 'from-langsmith', label: 'Migrate from LangSmith', minutes: 45 },
]

function buildItemListJsonLd(): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${SITE_URL}/alternatives#list`,
    name: `Best LLM Observability Alternatives in ${YEAR}`,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: ENTRIES.length,
    itemListElement: ENTRIES.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/compare/${entry.slug}`,
      name: `Spanlens vs ${entry.competitor}`,
    })),
  }
  return JSON.stringify(payload)
}

function buildBreadcrumbJsonLd(): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Alternatives',
        item: `${SITE_URL}/alternatives`,
      },
    ],
  }
  return JSON.stringify(payload)
}

export default function AlternativesHub() {
  const listJsonLd = buildItemListJsonLd()
  const breadcrumbJsonLd = buildBreadcrumbJsonLd()

  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: listJsonLd }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <section className="max-w-[1000px] mx-auto px-6 pt-20 pb-10">
        <p className="font-mono text-[12px] text-text-faint">LLM observability · {YEAR}</p>
        <h1 className="mt-3 text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text leading-[1.05]">
          Best LLM observability alternatives in {YEAR}
        </h1>
        <p className="mt-4 text-[18px] text-text-muted leading-relaxed max-w-[760px]">
          A practical map of where each LLM observability tool wins and where it does not.
          Drop-in proxy versus SDK-first. Open source versus closed. Self-hostable versus
          cloud-only. Below are the five most common alternatives teams compare Spanlens to,
          plus migration guides if you already have data in one of them.
        </p>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-10">
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <caption className="sr-only">
              Summary table of LLM observability tools compared to Spanlens in {YEAR}.
            </caption>
            <thead>
              <tr className="bg-bg-elev">
                <th
                  scope="col"
                  className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint border-b border-border"
                >
                  Tool
                </th>
                <th
                  scope="col"
                  className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint border-b border-border"
                >
                  Install
                </th>
                <th
                  scope="col"
                  className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint border-b border-border"
                >
                  License
                </th>
                <th
                  scope="col"
                  className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint border-b border-border"
                >
                  Self-host
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th
                  scope="row"
                  className="text-left align-top px-4 py-2.5 font-normal text-text border-b border-border"
                >
                  <Link href="/" className="hover:text-accent transition-colors">
                    Spanlens
                  </Link>
                </th>
                <td className="align-top px-4 py-2.5 text-text-muted border-b border-border">
                  1-line baseURL swap or SDK
                </td>
                <td className="align-top px-4 py-2.5 text-text-muted border-b border-border">
                  MIT (entire repo)
                </td>
                <td className="align-top px-4 py-2.5 text-text-muted border-b border-border">
                  Yes, one Docker command
                </td>
              </tr>
              {ENTRIES.map((entry, i) => (
                <tr key={entry.slug} className={i % 2 === 0 ? 'bg-bg-elev/30' : undefined}>
                  <th
                    scope="row"
                    className="text-left align-top px-4 py-2.5 font-normal text-text border-b border-border"
                  >
                    <Link
                      href={`/compare/${entry.slug}`}
                      className="hover:text-accent transition-colors"
                    >
                      {entry.competitor}
                    </Link>
                  </th>
                  <td className="align-top px-4 py-2.5 text-text-muted border-b border-border">
                    {entry.installShape}
                  </td>
                  <td className="align-top px-4 py-2.5 text-text-muted border-b border-border">
                    {entry.license}
                  </td>
                  <td className="align-top px-4 py-2.5 text-text-muted border-b border-border">
                    {entry.selfHost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-16">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
          Tool-by-tool
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ENTRIES.map((entry) => (
            <article
              key={entry.slug}
              className="rounded-xl border border-border bg-bg-elev p-6 flex flex-col"
            >
              <header className="flex items-baseline justify-between gap-3 mb-3">
                <h3 className="text-[18px] font-semibold text-text">
                  Spanlens vs {entry.competitor}
                </h3>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint shrink-0">
                  {YEAR}
                </span>
              </header>
              <p className="text-[13px] text-text-muted leading-relaxed">{entry.oneLine}</p>
              <p className="mt-3 text-[13px] text-text leading-relaxed">{entry.whySwitch}</p>
              <div className="mt-4">
                <Link
                  href={`/compare/${entry.slug}`}
                  className="font-mono text-[12px] text-accent hover:underline"
                >
                  Read full comparison →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-16">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-3">
          Already on one of these? Migrate in under an hour.
        </h2>
        <p className="text-[14px] text-text-muted mb-6 max-w-[680px] leading-relaxed">
          Step-by-step guides with code diffs, env var mapping, and a dual-run cutover plan
          so you can switch without losing history.
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {MIGRATION_GUIDES.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/docs/migrate/${guide.slug}`}
                className="block rounded-xl border border-border bg-bg p-5 hover:border-accent transition-colors"
              >
                <div className="text-[15px] font-semibold text-text">{guide.label}</div>
                <div className="mt-1 font-mono text-[11px] text-text-faint">
                  About {guide.minutes} minutes
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-24">
        <div className="rounded-xl border border-border bg-bg-elev p-8 text-center">
          <p className="text-[15px] text-text-muted mb-5 max-w-[640px] mx-auto leading-relaxed">
            Try Spanlens free for 50K requests a month. No credit card. Drop the SDK in, see
            every LLM call in your dashboard within 60 seconds.
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
          <p className="mt-4 font-mono text-[11px] text-text-faint">
            Free tier · No credit card · Self-host with Docker
          </p>
        </div>
      </section>

      <Footer />
    </div>
  )
}
