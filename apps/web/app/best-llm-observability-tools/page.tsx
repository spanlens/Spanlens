import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-jsonld'
import { openGraphFor } from '@/lib/page-metadata'
import { COMPETITORS, VERIFIED_ON, openSourceCompetitors } from '@/lib/competitors'

const SITE_URL = 'https://www.spanlens.io'
const PATH = '/best-llm-observability-tools'

export const metadata = {
  alternates: { canonical: PATH },
  openGraph: openGraphFor(PATH, { type: 'article' }),
  title: 'Best LLM Observability Tools in 2026',
  description:
    'Twelve LLM observability tools compared on licence, install shape, self-hosting, and how actively each is developed. GitHub figures verified 30 July 2026.',
}

const FAQS: [string, string][] = [
  [
    'What is the best LLM observability tool in 2026?',
    'There is no single best one. Langfuse has the largest open-source community, Comet Opik leads on evaluation, LiteLLM wins on multi-provider routing, and Traceloop is the choice when you want spans in an observability backend you already run. The right answer depends on whether you can change call sites, whether you must self-host, and whether cost or evaluation is your first question.',
  ],
  [
    'Which LLM observability tools are genuinely open source?',
    'Comet Opik, Helicone, Traceloop OpenLLMetry, Laminar, OpenLIT, and Spanlens ship under OSI-approved licences with no gated directory. Langfuse is MIT with an ee/ folder under a commercial licence. Arize Phoenix uses Elastic License 2.0, which is not OSI-approved. LangSmith and Braintrust are closed source.',
  ],
  [
    'Which tools work without changing my application code?',
    'Proxy and gateway tools do: Spanlens, Helicone, LiteLLM, and Portkey all sit in front of the provider so you change a base URL rather than wrapping call sites. Langfuse, Opik, Laminar, LangSmith, and Braintrust use SDK instrumentation. Traceloop, Phoenix, and OpenLIT go through OpenTelemetry.',
  ],
  [
    'How do I track LLM cost per request?',
    'You need the token counts from the provider response joined to a price table for that exact model version, because providers return dated model ids such as gpt-4o-mini-2024-07-18. Proxy-based tools compute this at the moment the response passes through. SDK-based tools compute it wherever you instrumented.',
  ],
  [
    'Can I self-host LLM observability?',
    'Yes for most of this list. Langfuse, Opik, Helicone, LiteLLM, Phoenix, Traceloop, Laminar, OpenLIT, and Spanlens all run on your own infrastructure. Portkey self-hosts the gateway but not the observability platform. LangSmith self-hosts on enterprise plans only, and Braintrust does not offer it.',
  ],
]

const SITUATIONS: { question: string; answer: string; picks: string[] }[] = [
  {
    question: 'You cannot change every call site',
    answer:
      'Pick a proxy or gateway. You change one base URL and every request through it is recorded, which matters most in an existing codebase with calls scattered across services.',
    picks: ['Spanlens', 'Helicone', 'LiteLLM', 'Portkey'],
  },
  {
    question: 'You want the largest community and the most documentation',
    answer:
      'Langfuse has 32,119 stars and the deepest set of guides, integrations, and community answers. When you hit an unusual problem, someone has probably written about it already.',
    picks: ['Langfuse'],
  },
  {
    question: 'Evaluation is the question, not logging',
    answer:
      'Choose a tool built around scoring rather than one that added it later. Datasets, judges, and experiment comparison should be the main surface, not a tab.',
    picks: ['Comet Opik', 'Braintrust', 'LangSmith'],
  },
  {
    question: 'You already run Grafana, Datadog, or Honeycomb',
    answer:
      'Do not adopt a second dashboard. Emit OpenTelemetry spans with LLM attributes into the backend you already pay for and already know how to query.',
    picks: ['Traceloop OpenLLMetry', 'Arize Phoenix', 'OpenLIT'],
  },
  {
    question: 'You route across many providers and need fallbacks',
    answer:
      'This is a gateway problem before it is an observability problem. Retries, budgets, and provider failover come first, and logging follows through callbacks.',
    picks: ['LiteLLM', 'Portkey'],
  },
  {
    question: 'Cost is the number your team argues about',
    answer:
      'Per-request USD next to the model version, aggregated by prompt version and by customer, is not the default in most of these tools. Check that the cost view exists before you commit.',
    picks: ['Spanlens', 'Helicone', 'LiteLLM'],
  },
  {
    question: 'The data cannot leave your infrastructure',
    answer:
      'Rule out anything closed source or hosted-only first, then check whether self-hosting gives you the whole product or only part of it.',
    picks: ['Langfuse', 'Comet Opik', 'Spanlens', 'Laminar'],
  },
]

function jsonLd() {
  const url = `${SITE_URL}${PATH}`
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      '@id': `${url}#article`,
      headline: 'Best LLM Observability Tools in 2026',
      description: metadata.description,
      url,
      datePublished: VERIFIED_ON,
      dateModified: VERIFIED_ON,
      inLanguage: 'en',
      author: { '@id': `${SITE_URL}/#organization` },
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': `${url}#list`,
      name: 'LLM observability tools compared',
      itemListElement: COMPETITORS.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        url: c.compareSlug ? `${SITE_URL}/compare/${c.compareSlug}` : c.homepage,
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: FAQS.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ]
}

const CELL = 'align-top px-4 py-2.5 text-text-muted border-b border-border text-[13px]'

export default function BestLlmObservabilityToolsPage() {
  const openSource = openSourceCompetitors()

  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav />
      <BreadcrumbJsonLd trail={[{ name: 'Best LLM observability tools', path: PATH }]} />
      {jsonLd().map((block) => (
        <script
          key={block['@type']}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}

      <section className="max-w-[1000px] mx-auto px-6 pt-20 pb-10">
        <h1 className="text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text leading-[1.05]">
          Best LLM observability tools in 2026
        </h1>
        <p className="mt-5 text-[17px] text-text-muted leading-relaxed max-w-[70ch]">
          There is no single best tool. The useful question is narrower: can you change every call
          site, must the data stay on your infrastructure, and is your first question about cost or
          about quality? Those three answers eliminate most of this list for you.
        </p>
        <p className="mt-4 text-[14px] text-text-muted leading-relaxed max-w-[70ch]">
          Below are twelve tools with the licence you actually get, how you wire each one in, whether
          self-hosting gives you the whole product, and how actively each repository is developed.
          GitHub figures were read on {VERIFIED_ON}.
        </p>
        <p className="mt-4 text-[13px] text-text-faint leading-relaxed max-w-[70ch]">
          Disclosure: we build Spanlens, which is one of the twelve. It is also the youngest and
          smallest project here, and the table says so.
        </p>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-14">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-5">
          Open-source tools by GitHub stars
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Open-source LLM observability tools with stars, licence, install shape and self-hosting
              as of {VERIFIED_ON}
            </caption>
            <thead>
              <tr className="bg-bg-elev">
                <th scope="col" className="px-4 py-3 text-[12px] uppercase tracking-[0.06em] text-text-faint font-medium">
                  Tool
                </th>
                <th scope="col" className="px-4 py-3 text-[12px] uppercase tracking-[0.06em] text-text-faint font-medium">
                  Stars
                </th>
                <th scope="col" className="px-4 py-3 text-[12px] uppercase tracking-[0.06em] text-text-faint font-medium">
                  Licence
                </th>
                <th scope="col" className="px-4 py-3 text-[12px] uppercase tracking-[0.06em] text-text-faint font-medium">
                  How you install it
                </th>
                <th scope="col" className="px-4 py-3 text-[12px] uppercase tracking-[0.06em] text-text-faint font-medium">
                  Self-host
                </th>
              </tr>
            </thead>
            <tbody>
              {openSource.map((c, i) => (
                <tr key={c.name} className={i % 2 === 0 ? 'bg-bg-elev/30' : undefined}>
                  <th
                    scope="row"
                    className="text-left align-top px-4 py-2.5 font-normal text-text border-b border-border text-[13px]"
                  >
                    {c.compareSlug ? (
                      <Link href={`/compare/${c.compareSlug}`} className="hover:text-accent transition-colors">
                        {c.name}
                      </Link>
                    ) : (
                      c.name
                    )}
                  </th>
                  <td className={`${CELL} font-mono`}>{c.stars?.toLocaleString('en-US')}</td>
                  <td className={CELL}>{c.license}</td>
                  <td className={CELL}>{c.install}</td>
                  <td className={CELL}>{c.selfHost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-text-faint">
          LangSmith and Braintrust are closed source and have no public repository, so they are not in
          this table. Both appear in the tool-by-tool notes below.
        </p>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-14">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
          Which tool fits which situation
        </h2>
        <div className="space-y-6">
          {SITUATIONS.map((s) => (
            <article key={s.question} className="rounded-xl border border-border bg-bg-elev p-6">
              <h3 className="text-[17px] font-semibold text-text">{s.question}</h3>
              <p className="mt-2 text-[14px] text-text-muted leading-relaxed max-w-[75ch]">{s.answer}</p>
              <p className="mt-3 font-mono text-[12px] text-text-faint">
                Look at: <span className="text-text">{s.picks.join(', ')}</span>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-14">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">Tool by tool</h2>
        <div className="space-y-5">
          {COMPETITORS.map((c) => (
            <article key={c.name} className="rounded-xl border border-border bg-bg-elev p-6">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                <h3 className="text-[18px] font-semibold text-text">{c.name}</h3>
                {c.stars !== undefined ? (
                  <span className="font-mono text-[11px] text-text-faint">
                    {c.stars.toLocaleString('en-US')} stars
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-text-faint">closed source</span>
                )}
              </header>
              <p className="text-[14px] text-text leading-relaxed max-w-[75ch]">
                <span className="text-text-faint">Best for. </span>
                {c.bestFor}
              </p>
              <p className="mt-2 text-[14px] text-text-muted leading-relaxed max-w-[75ch]">
                <span className="text-text-faint">The catch. </span>
                {c.tradeoff}
              </p>
              <div className="mt-4 flex flex-wrap gap-4 font-mono text-[12px]">
                {c.compareSlug ? (
                  <Link href={`/compare/${c.compareSlug}`} className="text-accent hover:underline">
                    Spanlens vs {c.name} →
                  </Link>
                ) : null}
                <a
                  href={c.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-faint hover:text-text transition-colors"
                >
                  {c.name} site ↗
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-14">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
          How these figures were gathered
        </h2>
        <div className="text-[14px] text-text-muted leading-relaxed max-w-[75ch] space-y-3">
          <p>
            Stars, licence, and commit activity come from the GitHub API, read on {VERIFIED_ON}. The
            activity claims are counts over a fixed window rather than impressions: for the 1 May to
            30 July 2026 period, Langfuse and Comet Opik each recorded more than 300 commits, while
            Helicone recorded 24 and the Portkey gateway recorded 26 with none after 25 May.
          </p>
          <p>
            Licence descriptions say what you get rather than repeating the SPDX identifier, because
            the identifier hides what matters. Langfuse reports as non-standard because MIT sits
            alongside a commercially licensed ee/ folder. Arize Phoenix uses Elastic License 2.0,
            which restricts offering the software as a service and is not OSI-approved.
          </p>
          <p>
            Funding rounds, acquisitions, and valuations are deliberately absent. They change often,
            they are hard to verify from a public API, and a wrong claim about another company is not
            worth making on a page like this.
          </p>
          <p>
            Install shape and self-hosting reflect each project&apos;s own documentation at the time
            of writing. If something here is out of date or wrong, tell us at{' '}
            <a href="mailto:support@spanlens.io" className="text-accent hover:underline">
              support@spanlens.io
            </a>{' '}
            and we will correct it.
          </p>
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-16">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
          Frequently asked
        </h2>
        <div className="space-y-4">
          {FAQS.map(([q, a]) => (
            <details key={q} className="rounded-xl border border-border bg-bg-elev p-5">
              <summary className="cursor-pointer text-[15px] font-medium text-text">{q}</summary>
              <p className="mt-3 text-[14px] text-text-muted leading-relaxed max-w-[75ch]">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-20">
        <div className="rounded-xl border border-border bg-bg-elev p-8">
          <h2 className="text-[20px] font-semibold text-text">Keep reading</h2>
          <p className="mt-2 text-[14px] text-text-muted leading-relaxed max-w-[70ch]">
            Head-to-head pages go deeper than the notes above, feature by feature.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[13px]">
            <Link href="/compare" className="text-accent hover:underline">
              All comparisons
            </Link>
            <Link href="/alternatives" className="text-accent hover:underline">
              Alternatives hub
            </Link>
            <Link href="/llm-observability" className="text-accent hover:underline">
              What LLM observability is
            </Link>
            <Link href="/llm-cost-tracking" className="text-accent hover:underline">
              LLM cost tracking
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
