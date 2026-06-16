import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

const DESCRIPTION =
  'AI agent tracing captures multi-step LLM workflows as waterfall span trees with critical path highlighting. Learn how to instrument LangChain, LangGraph, CrewAI, and the Vercel AI SDK with one line of code.'

export const metadata = {
  alternates: { canonical: '/agent-tracing' },
  title: 'AI Agent Tracing: Debug Multi-Agent LLM Workflows in Production',
  description: DESCRIPTION,
  openGraph: {
    type: 'article',
    title: 'AI Agent Tracing — Debug Multi-Agent LLM Workflows',
    description: DESCRIPTION,
    url: '/agent-tracing',
    images: ['/icon.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Agent Tracing — Debug Multi-Agent LLM Workflows',
    description: DESCRIPTION,
    images: ['/icon.png'],
  },
}

const SITE_URL = 'https://www.spanlens.io'

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  '@id': `${SITE_URL}/agent-tracing`,
  url: `${SITE_URL}/agent-tracing`,
  headline: 'AI Agent Tracing: Debug Multi-Agent LLM Workflows in Production',
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
    q: 'What is agent tracing?',
    a: 'Agent tracing captures every step of a multi-step LLM workflow as a hierarchical span tree. Each LLM call, tool invocation, and sub-agent run becomes a span with parent/child links. Tracing lets you see which step took the most time, which step called which tool, and where the workflow diverged from the expected path.',
  },
  {
    q: 'How is agent tracing different from regular distributed tracing?',
    a: 'Regular distributed tracing tracks HTTP and database spans. Agent tracing adds LLM-specific attributes (model, tokens, cost, prompt version), captures tool-use arguments and results inline, and computes critical path through non-deterministic flows where retries and parallel branches are common. OpenTelemetry semantic conventions for LLMs are still evolving, so agent-tracing tools usually layer their own attributes on top.',
  },
  {
    q: 'How do I trace a LangChain agent?',
    a: 'Three options. Spanlens drop-in: import the @spanlens/sdk LangChain callback handler and pass it to the executor — every chain, tool, and LLM call becomes a span. Proxy: route LangChain LLM calls through the Spanlens proxy URL and the trace is reconstructed server-side from request headers. OpenTelemetry: install the OTel instrumentation package and point the exporter at any OTLP/HTTP endpoint.',
  },
  {
    q: 'What is critical path in agent tracing?',
    a: 'Critical path is the longest dependency chain through a trace — the actual bottleneck, not just the longest single span. For a 12-step agent where steps run in parallel, the critical path is the path that determines total wall-clock time. Optimizing a non-critical-path span has zero effect on total latency. Spanlens highlights the critical path automatically; most other tools require manual analysis.',
  },
  {
    q: 'Can I trace agents built with CrewAI, LangGraph, or AutoGen?',
    a: 'Yes. LangGraph has a native Spanlens integration that captures node executions and state transitions. CrewAI and AutoGen work through the proxy or the SDK callback pattern. Multi-agent frameworks generally produce traces with one root span per agent task and child spans per LLM call.',
  },
  {
    q: 'How much overhead does agent tracing add?',
    a: 'For Spanlens, p99 ingestion overhead is under 3ms because logging happens async in a worker after the LLM response has already been streamed to the client. Tracing does not sit on the critical path. Span emission is fire-and-forget with a fallback queue if the ingest endpoint is briefly unreachable.',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/agent-tracing#faq`,
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function AgentTracingHub() {
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
          AI Agent Tracing: Debug Multi-Agent LLM Workflows in Production
        </h1>
        <p className="text-[18px] text-text-muted mb-12 leading-relaxed">
          What agent tracing captures, how it differs from regular APM tracing, and how
          to instrument LangChain, LangGraph, CrewAI, and the Vercel AI SDK in one line.
        </p>

        <section className="prose prose-sm max-w-none text-text-muted space-y-5 text-[15px] leading-relaxed">
          <p>
            An LLM agent is a workflow where a language model decides what to do next.
            That decision can be a tool call, a sub-agent invocation, another LLM call
            with a different prompt, or a return value to the caller. Production agents
            usually combine all four, branch on intermediate results, retry on failure,
            and run sub-tasks in parallel. The whole thing is non-deterministic, which
            means debugging by re-running it does not always reproduce the bug.
          </p>
          <p>
            Agent tracing captures this entire flow as a span tree. Each LLM call, tool
            invocation, and sub-agent run becomes a span with parent/child links, exact
            timing, model variant, token counts, cost, and inputs/outputs. When something
            goes wrong (the bill triples, p99 latency doubles, the eval score collapses)
            the trace shows exactly which step caused it.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Anatomy of an agent trace
          </h2>
          <p className="text-[15px] text-text-muted leading-relaxed mb-5">
            A typical agent trace has four layers. Spanlens renders all four in a single
            waterfall view with the critical path highlighted.
          </p>
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-bg-elev p-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Layer 1: Trace root
              </div>
              <h3 className="text-[15px] font-semibold text-text mb-1">User-facing task</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                One span per user request. Holds end-to-end latency, total cost, and the
                trace ID. Where most dashboards start.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elev p-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Layer 2: Agent steps
              </div>
              <h3 className="text-[15px] font-semibold text-text mb-1">
                Classify, retrieve, plan, summarize
              </h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                One span per logical step. Includes the agent state at entry and exit.
                For LangGraph, one span per node. For CrewAI, one span per crew task.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elev p-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Layer 3: LLM calls
              </div>
              <h3 className="text-[15px] font-semibold text-text mb-1">
                Provider request and response
              </h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                One span per upstream call. Captures model, tokens, cost, latency,
                streaming details, and tool-use arguments. The most common source of
                cost and latency surprises.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elev p-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Layer 4: Tool calls
              </div>
              <h3 className="text-[15px] font-semibold text-text mb-1">
                External fetches, DB queries, code execution
              </h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                One span per tool invocation triggered by the LLM. Captures the
                arguments the LLM produced and the return value the tool sent back.
                Often where bugs hide because the LLM looks reasonable but the tool
                output was wrong.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Critical path: the only span that matters for latency
          </h2>
          <p className="text-[15px] text-text-muted leading-relaxed mb-3">
            For an agent that runs four steps in parallel and one step sequentially after,
            total wall-clock time depends on the slowest of the parallel four plus the
            sequential one. Optimizing the fastest parallel step has zero effect on total
            latency. The critical path identifies which spans actually drive total time.
          </p>
          <p className="text-[15px] text-text-muted leading-relaxed">
            Spanlens computes the critical path automatically on every trace. The view
            colors critical-path spans differently and lists them at the top of the trace
            detail. Most other tools render the waterfall but leave the critical-path
            calculation as a manual exercise.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Framework integrations
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { href: '/docs/integrations/langgraph', title: 'LangGraph', body: 'Native integration captures node executions and state transitions.' },
              { href: '/docs/integrations/llamaindex', title: 'LlamaIndex', body: 'Drop-in handler instruments retrieval, synthesis, and query engines.' },
              { href: '/docs/integrations/vercel-ai', title: 'Vercel AI SDK', body: 'streamText and generateText calls become spans with tool details.' },
              { href: '/docs/integrations/mcp', title: 'MCP (Model Context Protocol)', body: 'Capture MCP tool servers and the LLM that called them in one trace.' },
              { href: '/integrations/openai', title: 'OpenAI Assistants', body: 'Threads, runs, and steps render as a parent/child span tree.' },
              { href: '/integrations/anthropic', title: 'Anthropic + tool use', body: 'Multi-turn tool flows captured with per-tool spans.' },
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
          <h2 className="text-[24px] font-semibold tracking-[-0.4px] text-text mb-4">
            Debugging checklist
          </h2>
          <p className="text-[15px] text-text-muted leading-relaxed mb-5">
            When a production agent misbehaves, work the trace top-down.
          </p>
          <ol className="space-y-3 text-[14px] text-text-muted">
            {[
              'Start at the trace root. Is total latency in the expected range? If yes, the bug is functional, not performance.',
              'Look at the critical path. Which spans contributed to the bulk of wall-clock time? Are any of them retries?',
              'For the slowest LLM span, check the model variant and prompt version. Did either change recently?',
              'For a tool span with a wrong return value, capture both the LLM-generated arguments and the tool output. Was the LLM call reasonable but the tool wrong, or was the LLM hallucinating arguments?',
              'For a workflow that took the wrong branch, look at the LLM call that made the routing decision. What was the input state? Add this case to your eval dataset.',
              'For a cost spike, group spans by model and check whether one prompt version triggered a long-context retry.',
            ].map((step, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-border bg-bg-elev p-4">
                <span className="shrink-0 h-6 w-6 rounded-full bg-accent text-bg font-mono text-[11px] font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
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
              Trace your first agent in 60 seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                href="/signup"
                className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity"
              >
                Start free →
              </Link>
              <Link
                href="/docs/tutorials/agent-tracing"
                className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors"
              >
                Agent tracing tutorial
              </Link>
            </div>
          </div>
        </section>
      </article>

      <Footer />
    </div>
  )
}
