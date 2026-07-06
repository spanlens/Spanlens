import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

const DESCRIPTION =
  'LLM cost tracking captures per-request USD spend by model, prompt version, and customer. Learn how to monitor OpenAI, Anthropic, and Gemini bills, set budget alerts, and reduce spend with model swaps.'

export const metadata = {
  alternates: { canonical: '/llm-cost-tracking' },
  title: 'LLM Cost Tracking: Monitor and Reduce Your AI API Spend',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'LLM Cost Tracking — Monitor and Reduce Your AI API Spend',
    description: DESCRIPTION,
    url: '/llm-cost-tracking',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LLM Cost Tracking — Monitor and Reduce Your AI API Spend',
    description: DESCRIPTION,
  },
}

const SITE_URL = 'https://www.spanlens.io'

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  '@id': `${SITE_URL}/llm-cost-tracking`,
  url: `${SITE_URL}/llm-cost-tracking`,
  headline: 'LLM Cost Tracking: Monitor and Reduce Your AI API Spend',
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
    q: 'How do I track LLM API costs?',
    a: 'Calculate cost per request from input + output tokens against the current model price table. Aggregate by model, prompt version, customer, or endpoint. Spanlens does this automatically — every captured request includes a cost_usd field computed from the provider response and the latest published price.',
  },
  {
    q: 'How is GPT-4o priced?',
    a: 'GPT-4o costs $2.50 per 1M input tokens and $10 per 1M output tokens at the standard tier. Cached inputs cost $1.25 per 1M. GPT-4o-mini is $0.15 per 1M input and $0.60 per 1M output — about 15x cheaper. See /pricing/gpt-4o for a fuller breakdown including monthly cost scenarios.',
  },
  {
    q: 'How do I reduce my OpenAI bill?',
    a: 'Five high-leverage moves. (1) Route classification and routing calls to GPT-4o-mini instead of GPT-4o — same quality for narrow tasks at one-fifteenth the cost. (2) Enable prompt caching for shared system prompts. (3) Set max_tokens so retries cannot run away with output cost. (4) Switch to JSON mode and trim the response schema. (5) Pre-summarize long context once instead of resending it per turn.',
  },
  {
    q: 'What is a model savings recommender?',
    a: 'A tool that analyzes your captured traffic and suggests model swaps with dollar figures attached, like "swap these gpt-4o classification calls to gpt-4o-mini, save $412/mo." Spanlens has one built in. The recommendation includes evidence: sample requests, expected accuracy delta from your own eval data, and the exact filter to apply.',
  },
  {
    q: 'How do budget alerts work?',
    a: 'Budget alerts fire when projected spend exceeds a configured threshold. Spanlens supports daily, weekly, and monthly budgets with optional alerts at 50%, 80%, and 100%. Alerts go to email on Pro and to Slack + webhooks on Team. The projection uses a rolling 7-day rate, not just a linear extrapolation of MTD spend.',
  },
  {
    q: 'Can I bill my customers for their LLM usage?',
    a: 'Yes. Tag each request with a customer ID using the X-Spanlens-User header. Spanlens then aggregates per-customer cost in /users — feed that to your billing system. Same applies for sessions, projects, or any other dimension you tag.',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/llm-cost-tracking#faq`,
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function LlmCostTrackingHub() {
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
          LLM Cost Tracking: Monitor and Reduce Your AI API Spend
        </h1>
        <p className="text-[18px] text-text-muted mb-12 leading-relaxed">
          What to capture, how to slice it, and the five swaps that typically cut
          OpenAI + Anthropic + Gemini bills by 30 to 60 percent without quality regression.
        </p>

        <section className="prose prose-sm max-w-none text-text-muted space-y-5 text-[15px] leading-relaxed">
          <p>
            LLM API bills surprise teams because cost is a moving target. Token counts
            change with prompt edits, model prices change with provider releases, and a
            single hot user can multiply your spend overnight. Without per-request tracking,
            the first signal you get is the monthly invoice — by which point the damage is
            already booked.
          </p>
          <p>
            This guide covers what cost data to capture, how to aggregate it, and the
            handful of high-leverage swaps that actually move the bill. For interactive
            estimation, use the{' '}
            <Link href="/tools/llm-cost-calculator" className="text-accent hover:opacity-80">
              LLM cost calculator
            </Link>
            . For provider-specific pricing breakdowns, see{' '}
            <Link href="/pricing/gpt-4o" className="text-accent hover:opacity-80">
              /pricing/gpt-4o
            </Link>
            ,{' '}
            <Link href="/pricing/claude-3-5-sonnet" className="text-accent hover:opacity-80">
              /pricing/claude-3-5-sonnet
            </Link>
            , and{' '}
            <Link href="/pricing/gemini-2-0-flash" className="text-accent hover:opacity-80">
              /pricing/gemini-2-0-flash
            </Link>
            .
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            What to capture per request
          </h2>
          <div className="space-y-3">
            {[
              ['Model variant (exact dated name)', 'gpt-4o-mini-2024-07-18 is priced differently from gpt-4o-2024-08-06. Always capture the exact returned name, not just the requested model alias.'],
              ['Input tokens (with cache split)', 'Anthropic and OpenAI both return cache_creation and cache_read counts separately. Cached tokens are cheaper and worth tracking independently.'],
              ['Output tokens', 'Reasoning models (o1, o3-mini, Claude extended thinking) emit reasoning tokens that are billed as output but produce no user-visible text. Capture them as a separate field.'],
              ['Provider returned cost (where available)', 'Anthropic now returns usage cost in the response. Capture it as cost_usd_provider for reconciliation against your own calculation.'],
              ['Latency split (TTFT and total)', 'For cost-vs-quality decisions, time-to-first-token often matters more than total time. Streaming captures both.'],
              ['Customer / session / endpoint tags', 'Three dimensions almost everyone wants to slice by. Tag at request time with X-Spanlens-User, X-Spanlens-Session, and a custom tag header.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl border border-border bg-bg-elev p-5">
                <h3 className="text-[15px] font-semibold text-text mb-1">{title}</h3>
                <p className="text-[13px] text-text-muted leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Five swaps that cut bills 30 to 60 percent
          </h2>
          <ol className="space-y-4">
            {[
              ['Route routing calls to a small model', 'Classification, intent detection, and routing decisions almost never need a frontier model. Replace GPT-4o with GPT-4o-mini for these — same quality for narrow tasks at one-fifteenth the cost. Confirm with an eval comparison before rollout.'],
              ['Enable prompt caching for shared system prompts', 'Anthropic prompt caching is 90% off cache reads. OpenAI cache reads are 50% off. If your system prompt is more than 1K tokens and shared across many requests, caching pays back immediately.'],
              ['Cap max_tokens', 'A failed structured-output retry that runs to 4096 tokens costs 100x a successful one. Set max_tokens explicitly. Detect failures earlier with stricter output schemas.'],
              ['Pre-summarize long context once', 'For an agent with a growing conversation history, summarize the older turns once and replace them with the summary. A 10-turn conversation that sends the full history every turn costs O(n²) — summarizing makes it O(n).'],
              ['Switch reasoning models for the right tasks only', 'o1 and o3-mini are 6x to 60x more expensive than GPT-4o on output. Use them for hard reasoning steps only, not as a default. Most agent workflows have at most one or two reasoning-heavy steps.'],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3 rounded-xl border border-border bg-bg-elev p-5">
                <span className="shrink-0 h-7 w-7 rounded-full bg-accent text-bg font-mono text-[12px] font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold text-text mb-1">{title}</h3>
                  <p className="text-[13px] text-text-muted leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Model price quick reference
          </h2>
          <div className="rounded-xl border border-border bg-bg-elev overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Model
                  </th>
                  <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Input / 1M
                  </th>
                  <th className="text-right px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Output / 1M
                  </th>
                  <th className="text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['GPT-4o', '$2.50', '$10.00', '/pricing/gpt-4o'],
                  ['GPT-4o-mini', '$0.15', '$0.60', '/pricing/gpt-4o-mini'],
                  ['o3-mini', '$1.10', '$4.40', null],
                  ['Claude 3.5 Sonnet', '$3.00', '$15.00', '/pricing/claude-3-5-sonnet'],
                  ['Claude 3.5 Haiku', '$0.80', '$4.00', null],
                  ['Gemini 2.0 Flash', '$0.10', '$0.40', '/pricing/gemini-2-0-flash'],
                  ['Gemini 1.5 Pro', '$1.25', '$5.00', null],
                ].map(([model, inp, out, href], i, arr) => (
                  <tr key={model as string} className={i < arr.length - 1 ? 'border-b border-border' : ''}>
                    <td className="px-4 py-2.5 font-semibold text-text">{model}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-muted">{inp}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-muted">{out}</td>
                    <td className="px-4 py-2.5">
                      {href ? (
                        <Link href={href as string} className="text-accent hover:opacity-80">
                          See breakdown →
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
          <p className="mt-2 font-mono text-[11px] text-text-faint">
            Prices in USD as of 2026-06. See each model page for region, cache, and batch discounts.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Related
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { href: '/tools/llm-cost-calculator', title: 'LLM Cost Calculator', body: 'Estimate monthly spend across providers in your browser.' },
              { href: '/llm-observability', title: 'LLM Observability Hub', body: 'The broader monitoring picture cost is a subset of.' },
              { href: '/agent-tracing', title: 'Agent Tracing', body: 'Per-step cost breakdown for multi-step workflows.' },
              { href: '/pricing', title: 'Spanlens Pricing', body: 'How Spanlens itself prices request logging.' },
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

        <section className="mt-16">
          <div className="rounded-xl border border-border bg-bg-elev p-6 text-center">
            <p className="text-[14px] text-text-muted mb-4">
              See your real cost per request, per model, per customer.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                href="/signup"
                className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity"
              >
                Start free →
              </Link>
              <Link
                href="/tools/llm-cost-calculator"
                className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors"
              >
                Try the calculator
              </Link>
            </div>
          </div>
        </section>
      </article>

      <Footer />
    </div>
  )
}
