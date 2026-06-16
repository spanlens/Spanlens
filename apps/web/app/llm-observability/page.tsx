import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

const DESCRIPTION =
  'LLM observability is the practice of logging, tracing, and analyzing every call your application makes to a large language model. This guide covers what to monitor, how to instrument, and how Spanlens compares to Langfuse, Helicone, and LangSmith.'

export const metadata = {
  alternates: { canonical: '/llm-observability' },
  title: 'LLM Observability: The 2026 Guide for Production AI Apps',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'LLM Observability — A 2026 Guide for Production AI Apps',
    description: DESCRIPTION,
    url: '/llm-observability',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LLM Observability — A 2026 Guide for Production AI Apps',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

const SITE_URL = 'https://www.spanlens.io'

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  '@id': `${SITE_URL}/llm-observability`,
  url: `${SITE_URL}/llm-observability`,
  headline: 'LLM Observability: The 2026 Guide for Production AI Apps',
  description: DESCRIPTION,
  datePublished: '2026-06-16',
  dateModified: '2026-06-16',
  author: { '@type': 'Organization', name: 'Spanlens', url: SITE_URL },
  publisher: {
    '@type': 'Organization',
    name: 'Spanlens',
    logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.png` },
  },
  isPartOf: { '@type': 'WebSite', name: 'Spanlens', url: SITE_URL },
}

const faqs = [
  {
    q: 'What is LLM observability?',
    a: 'LLM observability is the practice of capturing every call your application makes to a large language model, then surfacing cost, latency, token usage, and behavioral signals. It is the LLM-specific equivalent of APM (application performance monitoring) for traditional services.',
  },
  {
    q: 'Why is LLM observability different from regular APM?',
    a: 'Regular APM tracks HTTP requests and database queries. LLM calls have unique signals: token counts that drive cost, model variants with different quality, prompt versions that change behavior, tool use that branches into agent flows, and non-deterministic output. Standard APM misses cost-per-call, model-by-model breakdown, prompt drift, and PII in request bodies.',
  },
  {
    q: 'What should I monitor for an LLM application?',
    a: 'Five categories. Cost: per-request USD by model and customer. Latency: p50/p95/p99 split by model and prompt version. Quality: eval scores per output, drift over time, human vs judge correlation. Reliability: error rates, retry counts, timeouts. Security: PII matches, prompt injection patterns, API key leakage in logs.',
  },
  {
    q: 'How do I add LLM observability to an existing app?',
    a: 'Three common patterns. Drop-in SDK: swap the provider SDK import for an observability-instrumented version. Proxy: change the LLM baseURL so every call routes through a logging endpoint. OpenTelemetry: emit OTLP spans from your existing tracing setup. Drop-in is fastest for single-language apps, proxy is best for polyglot stacks, OTel is best if you already have an OTel pipeline.',
  },
  {
    q: 'What is the difference between Spanlens, Langfuse, Helicone, and LangSmith?',
    a: 'Spanlens is a drop-in proxy with built-in evals, agent tracing, and Prompt A/B, fully MIT licensed. Langfuse uses an SDK + OTel model with a commercial ee/ folder for enterprise add-ons. Helicone is closest architecturally (proxy-first) but entered maintenance after the 2026 Mintlify acquisition. LangSmith is LangChain-native and excels inside LangChain pipelines.',
  },
  {
    q: 'Can I self-host LLM observability?',
    a: 'Yes. Spanlens, Langfuse, and Arize Phoenix all offer self-hostable builds. Spanlens runs from one Docker compose file with no enterprise feature gating. Langfuse self-host omits the ee/ folder features (SCIM, audit logs, data masking). Helicone self-host is community-maintained after the acquisition.',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/llm-observability#faq`,
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function LlmObservabilityHub() {
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
        <h1 className="text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text mb-3 leading-[1.05]">
          LLM Observability: The 2026 Guide for Production AI Apps
        </h1>
        <p className="text-[18px] text-text-muted mb-12 leading-relaxed">
          What to monitor, how to instrument, and how to pick a tool when your LLM app
          stops being a prototype.
        </p>

        <section className="prose prose-sm max-w-none text-text-muted space-y-5 text-[15px] leading-relaxed">
          <p>
            LLM observability is the practice of capturing every call your application
            makes to a large language model, then surfacing the cost, latency, token usage,
            and behavioral signals that decide whether the app stays profitable, fast,
            and safe. It is the LLM-specific equivalent of APM (application performance
            monitoring) for traditional services, but the failure modes are different
            enough that you cannot just point Datadog or New Relic at the problem.
          </p>
          <p>
            This page is a hub. It links out to deeper guides on{' '}
            <Link href="/agent-tracing" className="text-accent hover:opacity-80">
              agent tracing
            </Link>
            ,{' '}
            <Link href="/llm-cost-tracking" className="text-accent hover:opacity-80">
              LLM cost tracking
            </Link>
            , the major{' '}
            <Link href="/compare" className="text-accent hover:opacity-80">
              tool comparisons
            </Link>
            , and provider-specific integration walkthroughs for{' '}
            <Link href="/integrations/openai" className="text-accent hover:opacity-80">
              OpenAI
            </Link>
            ,{' '}
            <Link href="/integrations/anthropic" className="text-accent hover:opacity-80">
              Anthropic
            </Link>
            , and{' '}
            <Link href="/integrations/gemini" className="text-accent hover:opacity-80">
              Gemini
            </Link>
            .
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            What to monitor
          </h2>
          <p className="text-[15px] text-text-muted leading-relaxed mb-5">
            A production LLM app generates five categories of signal worth capturing.
            Most teams start with cost because the bill is the first thing that surprises
            them, but the other four catch issues earlier.
          </p>
          <div className="space-y-4">
            {[
              {
                title: 'Cost (USD per request)',
                body: 'Calculated from input + output tokens against the current model price table. Aggregate by model, prompt version, customer, or endpoint. Surfaces the gpt-4o classification calls that should have been gpt-4o-mini.',
              },
              {
                title: 'Latency (p50, p95, p99)',
                body: 'Split by model and prompt version. Streaming responses report time-to-first-token and time-to-last-token separately. A p99 spike usually means a hot prompt got long, not that the provider is down.',
              },
              {
                title: 'Quality (eval scores)',
                body: 'Score every response with an LLM-as-judge or a stored human label. Track drift by prompt version. Pair with experiments so you can replay a fixed dataset across versions and compare before rollout.',
              },
              {
                title: 'Reliability (error rates and retries)',
                body: 'Upstream 429/500, network timeouts, structured-output parse failures. Catch the silent retry loop that doubles your bill without doubling your output.',
              },
              {
                title: 'Security (PII, injection, secret leakage)',
                body: 'Scan request bodies for SSN/credit card/email/IBAN/passport, prompt-injection patterns, and stray API keys. Flag for review without blocking the request, since blocking the LLM call to the user is usually worse than the security issue.',
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-bg-elev p-5">
                <h3 className="text-[16px] font-semibold text-text mb-2">{item.title}</h3>
                <p className="text-[14px] text-text-muted leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            How to instrument
          </h2>
          <p className="text-[15px] text-text-muted leading-relaxed mb-5">
            Three patterns dominate. Pick based on your stack rather than ideology.
          </p>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-bg-elev p-5">
              <h3 className="text-[16px] font-semibold text-text mb-2">
                1. Drop-in SDK
              </h3>
              <p className="text-[14px] text-text-muted leading-relaxed">
                Swap the provider SDK import for an observability-instrumented version.
                Same surface area, same types. Fastest for single-language apps. Spanlens,
                Langfuse, and LangSmith all ship drop-in wrappers for OpenAI and Anthropic.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elev p-5">
              <h3 className="text-[16px] font-semibold text-text mb-2">2. Proxy</h3>
              <p className="text-[14px] text-text-muted leading-relaxed">
                Point the LLM baseURL at a logging endpoint and put your observability
                key in the Authorization header. Works in any language including Ruby,
                Go, and raw HTTP. Spanlens and Helicone are proxy-first; Langfuse can
                proxy via its gateway but it is not the default mode.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elev p-5">
              <h3 className="text-[16px] font-semibold text-text mb-2">
                3. OpenTelemetry
              </h3>
              <p className="text-[14px] text-text-muted leading-relaxed">
                Emit OTLP spans from your existing tracing setup. Best if you already
                have an OTel pipeline and want LLM spans to flow through it. Spanlens,
                Langfuse, and Arize Phoenix all accept OTLP/HTTP at /v1/traces. See{' '}
                <Link href="/docs/otel" className="text-accent hover:opacity-80">
                  /docs/otel
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Tool landscape (2026)
          </h2>
          <p className="text-[15px] text-text-muted leading-relaxed mb-5">
            The space has consolidated around five tools. Each compares head-to-head
            with Spanlens on a dedicated page.
          </p>
          <div className="rounded-xl border border-border bg-bg-elev overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Tool
                  </th>
                  <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Model
                  </th>
                  <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    License
                  </th>
                  <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Compare
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Spanlens', 'Proxy + SDK + OTel', 'MIT (full)', null],
                  ['Langfuse', 'SDK + OTel', 'MIT + ee/ folder', '/compare/langfuse'],
                  ['Helicone', 'Proxy', 'Apache 2.0 (in maintenance)', '/compare/helicone'],
                  ['LangSmith', 'LangChain callbacks', 'Closed source', '/compare/langsmith'],
                  ['Braintrust', 'SDK', 'Closed source', '/compare/braintrust'],
                  ['Arize Phoenix', 'SDK + OTel', 'ELv2', '/compare/arize-phoenix'],
                ].map(([tool, model, license, href], i) => (
                  <tr
                    key={tool}
                    className={i < 5 ? 'border-b border-border' : ''}
                  >
                    <td className="px-4 py-2.5 font-semibold text-text">{tool}</td>
                    <td className="px-4 py-2.5 text-text-muted">{model}</td>
                    <td className="px-4 py-2.5 text-text-muted">{license}</td>
                    <td className="px-4 py-2.5">
                      {href ? (
                        <Link href={href} className="text-accent hover:opacity-80">
                          Compare →
                        </Link>
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Related guides
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { href: '/agent-tracing', title: 'AI Agent Tracing', body: 'Multi-step agent workflows as waterfall spans with critical path.' },
              { href: '/llm-cost-tracking', title: 'LLM Cost Tracking', body: 'Per-request cost, budget alerts, model swap recommendations.' },
              { href: '/integrations/openai', title: 'OpenAI Observability', body: 'Drop-in proxy for the OpenAI API with cost and tracing.' },
              { href: '/integrations/anthropic', title: 'Anthropic Observability', body: 'Claude Opus/Sonnet/Haiku with prompt-cache cost split.' },
              { href: '/integrations/gemini', title: 'Gemini Observability', body: 'Google Gemini and Vertex AI with multimodal capture.' },
              { href: '/docs/otel', title: 'OpenTelemetry Setup', body: 'Wire OTLP/HTTP from your existing OTel pipeline.' },
              { href: '/tools/llm-cost-calculator', title: 'LLM Cost Calculator', body: 'Estimate monthly cost across OpenAI, Anthropic, and Gemini.' },
              { href: '/docs/concepts/data-model', title: 'Data Model', body: 'Requests, spans, traces, prompts, datasets — how Spanlens stores them.' },
            ].map((g) => (
              <Link
                key={g.href}
                href={g.href}
                className="rounded-xl border border-border bg-bg-elev p-4 hover:border-border-strong transition-colors"
              >
                <div className="text-[14px] font-semibold text-text mb-1">{g.title}</div>
                <div className="text-[12px] text-text-muted leading-relaxed">{g.body}</div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
            Frequently asked questions
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

        <section className="mt-16">
          <div className="rounded-xl border border-border bg-bg-elev p-6 text-center">
            <p className="text-[14px] text-text-muted mb-4">
              Add LLM observability in one line. Free tier, no credit card.
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
      </article>

      <Footer />
    </div>
  )
}
