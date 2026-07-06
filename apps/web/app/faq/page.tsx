import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

const FAQ_DESCRIPTION =
  'Frequently asked questions about Spanlens — open-source LLM observability for OpenAI, Anthropic, and Gemini. Pricing, self-hosting, integration, comparisons, and security.'

export const metadata = {
  alternates: { canonical: '/faq' },
  title: 'FAQ · Spanlens LLM Observability',
  description: FAQ_DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'Spanlens FAQ — Open Source LLM Observability',
    description: FAQ_DESCRIPTION,
    url: '/faq',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spanlens FAQ — Open Source LLM Observability',
    description: FAQ_DESCRIPTION,
  },
}

interface FaqGroup {
  title: string
  items: { q: string; a: string }[]
}

const FAQ_GROUPS: FaqGroup[] = [
  {
    title: 'About Spanlens',
    items: [
      {
        q: 'What is Spanlens?',
        a: 'Spanlens is an open-source (MIT) LLM observability platform that logs every OpenAI, Anthropic, and Gemini request in one line of code. It tracks cost, latency, and tokens; traces multi-step agent workflows; catches anomalies and PII; and recommends cheaper models with dollar-figure savings estimates. Available as hosted SaaS at spanlens.io or as a self-hostable Docker image.',
      },
      {
        q: 'Who is Spanlens for?',
        a: 'LLM application developers shipping to production who need to see what their AI is doing. Common users include solo developers debugging cost spikes, teams running RAG chatbots, and AI agencies tracking per-customer spend. Spanlens replaces the "console.log + spreadsheet" workflow with a real observability stack.',
      },
      {
        q: 'Is Spanlens really open source?',
        a: 'Yes. The entire repository is MIT licensed with no ee/ folder. Every feature (request log, cost tracking, agent tracing, evals, Prompt A/B, anomaly detection, PII scan, model recommender, audit logs, SSO) is available in the self-hosted build. Spanlens is the same code we run for our hosted customers.',
      },
    ],
  },
  {
    title: 'How it works',
    items: [
      {
        q: 'How do I integrate Spanlens?',
        a: 'Three options. (1) Drop-in SDK: swap import { OpenAI } from "openai" with import { createOpenAI } from "@spanlens/sdk/openai" — same surface, every call captured. (2) Proxy: change your provider baseURL to https://api.spanlens.io/proxy/openai/v1 and put your Spanlens key in the Authorization header — works in any language. (3) OpenTelemetry: point your existing OTLP/HTTP exporter at Spanlens. p99 ingestion overhead is under 3ms.',
      },
      {
        q: 'Does Spanlens support Anthropic and Gemini?',
        a: 'Yes. OpenAI, Anthropic (including Bedrock), Google Gemini (including Vertex), Mistral, and Ollama (local LLMs) are all supported through the proxy or SDK. Streaming, tool use, vision, embeddings, and JSON mode are all captured with provider-specific parsers.',
      },
      {
        q: 'What about OpenTelemetry?',
        a: 'Spanlens accepts OTLP/HTTP at /v1/traces. Existing OTel SDKs (Python, Go, Java, Node.js) work without re-instrumentation. LLM-specific attributes are layered on top of standard span data, so you keep your existing tracing while gaining LLM-shaped views.',
      },
      {
        q: 'Does Spanlens work with LangChain, LlamaIndex, or the Vercel AI SDK?',
        a: 'Yes. Native integrations exist for LangGraph, LlamaIndex, MCP (Model Context Protocol), and the Vercel AI SDK. LangChain (JS and Python) works through the SDK callback handler. Agent workflows render as waterfall span trees with critical-path highlighting.',
      },
    ],
  },
  {
    title: 'Pricing & self-hosting',
    items: [
      {
        q: 'How much does Spanlens cost?',
        a: 'Free plan: 50K requests/mo, 1 seat, 14-day log retention, all core features, community support. Pro: $29/mo, 100K requests, 3 seats, 90-day retention, $8 per extra 100K. Team: $149/mo, 1M requests, 10 seats, 365-day retention, Slack + webhooks, $5 per extra 100K. Enterprise: custom volume with SSO and SLA. See spanlens.io/pricing for details.',
      },
      {
        q: 'Is Spanlens cheaper than Langfuse or Helicone?',
        a: 'For comparable usage tiers, yes. Spanlens Pro at $29/mo undercuts Langfuse Cloud Hobby ($59/mo) and Helicone Pro ($50/mo). The Team plan at $149/mo includes 1M requests with the lowest overage rate ($5 per 100K). For free self-hosting, all three are MIT or similar, but Langfuse keeps an ee/ folder gating enterprise security add-ons while Spanlens does not.',
      },
      {
        q: 'Can I self-host Spanlens for free?',
        a: 'Yes. docker compose up runs the full stack (web, server, Postgres, ClickHouse). No license fee, no seat cap, no feature gating. The hosted plans pay for managed infrastructure (uptime, backups, scaling), not features. Data stays in your own infrastructure when self-hosted.',
      },
      {
        q: 'What counts as a request?',
        a: 'One outbound LLM call (completion or embedding) equals one request. Streaming responses count as one request regardless of chunk count. Failed upstream calls are logged and still count. Internal agent steps that do not call an LLM (tool runs, retries before any provider call) do not count.',
      },
    ],
  },
  {
    title: 'Security & data handling',
    items: [
      {
        q: 'How does Spanlens handle PII?',
        a: 'PII detectors (SSN, credit card, email, IBAN, passport) run at log time and flag matches in the Security dashboard without blocking the request. API keys that slip into prompts are auto-masked before any row is persisted. For workloads where prompt bodies must not be stored at all, opt out per-call with the X-Spanlens-Log-Body: meta header — metadata is kept, prompt and response bodies are dropped.',
      },
      {
        q: 'Where is provider API key (OpenAI/Anthropic key) storage handled?',
        a: 'Provider keys are stored AES-256-GCM encrypted server-side and never logged. The decryption key is fetched only at proxy time to the upstream provider, then immediately discarded — it is never written to logs, never visible in the dashboard, and never returned to the client.',
      },
      {
        q: 'What about latency overhead?',
        a: 'p99 ingestion overhead is under 3ms. Logging happens async in a worker after the response is already streamed back to your client. If Spanlens itself ever fails, the original request still completes — the proxy passes through with no logging side effect. Spanlens never sits on the critical path.',
      },
      {
        q: 'Does Spanlens have SOC 2 or ISO 27001?',
        a: 'SOC 2 Type II is in progress (target Q3 2026). For now, hosted Spanlens runs on SOC 2-certified infrastructure (Vercel, Supabase) with AES-256 encryption at rest, TLS 1.2+ in transit, and a published DPA at spanlens.io/dpa. Self-hosting is the safest option for regulated workloads — your data never leaves your network.',
      },
    ],
  },
  {
    title: 'Data export & retention',
    items: [
      {
        q: 'Can I export my data?',
        a: 'Anytime. JSON, CSV, and Parquet exports are available from the dashboard. For higher-volume needs, pipe the raw stream to S3, BigQuery, or your warehouse via sink connectors. Exports are not metered and do not affect your request quota.',
      },
      {
        q: 'How long is data retained?',
        a: 'Free: 14 days. Pro: 90 days. Team: 365 days. Enterprise and self-hosted: configurable including unlimited. Retention is enforced at query time in ClickHouse — older rows are not deleted until the next compaction cycle, so a brief plan upgrade can recover slightly older data within the same billing window.',
      },
    ],
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': 'https://www.spanlens.io/faq#faq',
  mainEntity: FAQ_GROUPS.flatMap((g) =>
    g.items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  ),
}

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MarketingNav />

      <section className="max-w-3xl mx-auto px-6 py-20">
        <h1 className="text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text mb-3 leading-[1.05]">
          Frequently asked questions
        </h1>
        <p className="text-[16px] text-text-muted mb-12">
          Everything we get asked about Spanlens — integration, pricing, self-hosting,
          security, and how we compare to{' '}
          <Link href="/compare/langfuse" className="text-accent hover:opacity-80">Langfuse</Link>,{' '}
          <Link href="/compare/helicone" className="text-accent hover:opacity-80">Helicone</Link>, and{' '}
          <Link href="/compare/langsmith" className="text-accent hover:opacity-80">LangSmith</Link>.
        </p>

        {FAQ_GROUPS.map((group) => (
          <div key={group.title} className="mb-12">
            <h2 className="text-[20px] font-semibold tracking-[-0.4px] text-text mb-5">
              {group.title}
            </h2>
            <div className="space-y-3">
              {group.items.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-xl border border-border bg-bg-elev p-5"
                >
                  <summary className="cursor-pointer list-none text-[14px] font-medium text-text">
                    {item.q}
                  </summary>
                  <p className="mt-3 text-[13px] text-text-muted leading-relaxed">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-16 rounded-xl border border-border bg-bg-elev p-6 text-center">
          <p className="text-[14px] text-text-muted mb-4">
            Still have questions? We respond to every email.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <a
              href="mailto:hi@spanlens.io"
              className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity"
            >
              hi@spanlens.io
            </a>
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
