import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

export const metadata = {
  title: 'Self-Hosted LLM Observability · Open Source',
  description:
    'Self-host Spanlens, an open source LLM observability and monitoring platform, with one Docker command. Logging, cost tracking, and tracing on your infra.',
  alternates: { canonical: '/self-hosting' },
}

const SITE_URL = 'https://www.spanlens.io'

interface SelfHostFaq {
  question: string
  answer: string
}

const FAQS: SelfHostFaq[] = [
  {
    question: 'Is self-hosting Spanlens free?',
    answer:
      'Yes. The entire repository is MIT licensed, including the dashboard, the proxy, evals, and security scanning. There is no enterprise edition folder, no feature gate, and no license key. Self-hosting is free forever.',
  },
  {
    question: 'What infrastructure do I need to self-host?',
    answer:
      'A Supabase project (the free tier works), a ClickHouse instance (the bundled docker-compose ships one), and anywhere that can run Docker. The full stack starts with one docker compose up command.',
  },
  {
    question: 'Does my LLM data leave my network when self-hosting?',
    answer:
      'No. The proxy, the request logs, the traces, and your encrypted provider keys all stay on your own infrastructure. Spanlens never sees your prompts or completions.',
  },
  {
    question: 'How do I upgrade a self-hosted deployment?',
    answer:
      'Run docker compose pull and docker compose up -d. Images are published to GHCR with semver tags for both amd64 and arm64, and schema migrations are idempotent so re-running them is safe.',
  },
  {
    question: 'Can I use the hosted dashboard with a self-hosted backend?',
    answer:
      'Yes. You can run only the API server on your infrastructure and point the hosted dashboard at it, or run the full stack including the web dashboard yourself.',
  },
]

const FEATURES = [
  {
    title: 'Request logging',
    body: 'Every OpenAI, Anthropic, and Gemini call captured with model, tokens, cost, latency, and full body.',
  },
  {
    title: 'Cost tracking',
    body: 'Per-request breakdowns, daily rollups, budget alerts, and model-swap savings suggestions.',
  },
  {
    title: 'Agent tracing',
    body: 'Multi-step workflows rendered as waterfall span trees with the critical path highlighted.',
  },
  {
    title: 'Anomaly detection',
    body: 'Spend spikes, latency regressions, and error bursts surfaced automatically.',
  },
  {
    title: 'PII and injection scanning',
    body: 'Request bodies scanned at log time. API keys are masked before storage.',
  },
  {
    title: 'Evals and Prompt A/B',
    body: 'LLM-as-judge scoring and statistical prompt experiments with Welch t-test built in.',
  },
]

function buildFaqJsonLd(): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  }
  return JSON.stringify(payload)
}

function buildBreadcrumbJsonLd(): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Self-hosting', item: `${SITE_URL}/self-hosting` },
    ],
  }
  return JSON.stringify(payload)
}

const COMPOSE_SNIPPET = `curl -o docker-compose.yml \\
  https://raw.githubusercontent.com/spanlens/Spanlens/main/docker-compose.yml

docker compose up -d
# Dashboard on :3000, proxy + API on :3001`

export default function SelfHostingLanding() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildFaqJsonLd() }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildBreadcrumbJsonLd() }}
      />

      <section className="max-w-[1000px] mx-auto px-6 pt-20 pb-10">
        <p className="font-mono text-[12px] text-text-faint">Open source · MIT · Docker</p>
        <h1 className="mt-3 text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text leading-[1.05]">
          Self-hosted LLM observability with one Docker command
        </h1>
        <p className="mt-4 text-[18px] text-text-muted leading-relaxed max-w-[760px]">
          Spanlens is an open source LLM observability and monitoring platform you can run
          entirely on your own infrastructure. Request logging, cost tracking, agent tracing,
          and evals for OpenAI, Anthropic, and Gemini. Your prompts, completions, and provider
          keys never leave your network.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <a
            href="https://github.com/spanlens/Spanlens"
            target="_blank"
            rel="noopener noreferrer"
            className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity text-center"
          >
            View on GitHub →
          </a>
          <Link
            href="/docs/self-host"
            className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors text-center"
          >
            Read the full guide
          </Link>
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-16">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-3">
          Up and running in minutes
        </h2>
        <p className="text-[14px] text-text-muted mb-5 max-w-[680px] leading-relaxed">
          Pre-built images are published to GHCR for amd64 and arm64. The bundled
          docker-compose starts the dashboard, the proxy and API server, and ClickHouse
          together. Bring a free Supabase project for auth and relational data.
        </p>
        <pre className="rounded-xl border border-border bg-bg-elev p-5 overflow-x-auto font-mono text-[13px] text-text leading-relaxed">
          <code>{COMPOSE_SNIPPET}</code>
        </pre>
        <p className="mt-3 font-mono text-[11px] text-text-faint">
          Full walkthrough with env vars, schema setup, and backups in the{' '}
          <Link href="/docs/self-host" className="text-accent hover:underline">
            self-hosting docs
          </Link>
          .
        </p>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-16">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
          Everything in the cloud version, on your infra
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="rounded-xl border border-border bg-bg-elev p-5">
              <h3 className="text-[15px] font-semibold text-text mb-2">{feature.title}</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-16">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-3">
          Why teams self-host Spanlens
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <li className="rounded-xl border border-border bg-bg p-5">
            <div className="text-[15px] font-semibold text-text">Compliance</div>
            <p className="mt-1.5 text-[13px] text-text-muted leading-relaxed">
              SOC 2, HIPAA, or data residency rules forbid sending LLM bodies through a
              third-party SaaS. Self-hosting keeps every byte inside your boundary.
            </p>
          </li>
          <li className="rounded-xl border border-border bg-bg p-5">
            <div className="text-[15px] font-semibold text-text">True open source</div>
            <p className="mt-1.5 text-[13px] text-text-muted leading-relaxed">
              The whole repository is MIT. No enterprise folder, no gated SCIM or audit logs,
              no license server to phone home.
            </p>
          </li>
          <li className="rounded-xl border border-border bg-bg p-5">
            <div className="text-[15px] font-semibold text-text">Cost at scale</div>
            <p className="mt-1.5 text-[13px] text-text-muted leading-relaxed">
              At high request volumes, running your own stack can cost less than any
              per-request hosted plan. You control retention and storage.
            </p>
          </li>
        </ul>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-16">
        <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-6">
          Frequently asked questions
        </h2>
        <div className="flex flex-col gap-4">
          {FAQS.map((faq) => (
            <article key={faq.question} className="rounded-xl border border-border bg-bg-elev p-5">
              <h3 className="text-[15px] font-semibold text-text mb-2">{faq.question}</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-[1000px] mx-auto px-6 pb-24">
        <div className="rounded-xl border border-border bg-bg-elev p-8 text-center">
          <p className="text-[15px] text-text-muted mb-5 max-w-[640px] mx-auto leading-relaxed">
            Not ready to run your own infra? The hosted version is free for 50K requests a
            month, and you can migrate to self-hosted later without changing your SDK code.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link
              href="/signup"
              className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity"
            >
              Start free →
            </Link>
            <Link
              href="/alternatives"
              className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors"
            >
              Compare alternatives
            </Link>
          </div>
          <p className="mt-4 font-mono text-[11px] text-text-faint">
            MIT licensed · Docker one-liner · No feature gates
          </p>
        </div>
      </section>

      <Footer />
    </div>
  )
}
