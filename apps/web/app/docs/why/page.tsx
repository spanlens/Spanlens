import Link from 'next/link'
import { FeatureCoverageRadar } from '../_components/charts'

export const metadata = {
  alternates: { canonical: '/docs/why' },
  title: 'Why Spanlens · Spanlens Docs',
  description:
    'Why pick Spanlens over Helicone, Langfuse, LangSmith, or Arize Phoenix. Honest comparison of the six things only Spanlens does end-to-end.',
}

export default function WhySpanlens() {
  return (
    <div>
      <h1>Why Spanlens</h1>
      <p className="lead">
        There are good LLM observability tools out there. We&apos;ve used them, learned from them,
        and built Spanlens to fix six specific things that bothered us. If none of these matter to
        you, one of the other tools will be fine.
      </p>

      <h2>The six things only Spanlens does end-to-end</h2>

      <ol>
        <li>
          <strong>One-line baseURL proxy install.</strong> No SDK wrapping, no OTel exporter, no
          framework adapter. Change the base URL in your existing OpenAI / Anthropic / Gemini
          client and you&apos;re instrumented. Helicone has the same idea but only OpenAI;
          Spanlens covers all three providers and Azure OpenAI on the same shape.
        </li>
        <li>
          <strong>Cache-token billing that&apos;s actually right.</strong> Anthropic{' '}
          <code>cache_read_input_tokens</code> bills at 0.1× input; OpenAI{' '}
          <code>cached_tokens</code> bills at 0.5×. Most tools roll cache reads into prompt
          tokens — over-reporting cache-heavy workloads by 2–10×. We split them and price each
          tier separately.
        </li>
        <li>
          <strong>Critical Path on agent traces.</strong> When your agent fires five parallel
          tool calls, the answer to &ldquo;why is this slow?&rdquo; is the longest dependency
          chain, not the slowest single span. Spanlens computes it automatically and
          highlights it in the waterfall. LangSmith / Langfuse show the tree; you eyeball the
          critical path yourself.
        </li>
        <li>
          <strong>Prompt A/B with Welch&apos;s t-test built in.</strong> Ship v1 and v2 to a
          traffic split, watch them battle on cost / latency / eval score, then get a
          statistical significance verdict instead of staring at means. No copy-pasting into a
          notebook.
        </li>
        <li>
          <strong>Model-swap recommender with dollar figures.</strong> &ldquo;Switch this prompt
          from <code>gpt-4o</code> to <code>gpt-4o-mini</code> — expected monthly saving
          $412.10, no quality regression.&rdquo; The recommendation comes with the eval
          evidence and a one-click experiment to verify before you ship.
        </li>
        <li>
          <strong>Silent-loss-proof ingest.</strong> When the analytics DB hiccups,
          we don&apos;t drop your logs — they land in a fallback queue and replay automatically
          when the DB is back. Cron-driven, observable from <Link href="/docs/features/cost-tracking" className="text-accent hover:underline">/health/deep</Link>.
          Important when you bill customers based on these numbers.
        </li>
      </ol>

      <h2>How we line up against the others</h2>

      <p>Snapshot as of May 2026. Read this as &ldquo;default behavior, no plugins, no enterprise tier&rdquo;.</p>

      <div className="overflow-x-auto">
        <table className="[&_th:not(:first-child)]:text-center [&_td:not(:first-child)]:text-center">
          <thead>
            <tr>
              <th></th>
              <th>Spanlens</th>
              <th>Helicone</th>
              <th>Langfuse</th>
              <th>LangSmith</th>
              <th>Phoenix</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>One-line baseURL install</td>
              <td>✓</td>
              <td>OpenAI only</td>
              <td>SDK wrap</td>
              <td>SDK wrap</td>
              <td>OTel</td>
            </tr>
            <tr>
              <td>Self-hostable (MIT)</td>
              <td>✓</td>
              <td>✓</td>
              <td>~ (EE folder)</td>
              <td>—</td>
              <td>✓</td>
            </tr>
            <tr>
              <td>Cache-token split billing</td>
              <td>✓</td>
              <td>partial</td>
              <td>partial</td>
              <td>partial</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Critical Path on traces</td>
              <td>✓</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Prompt A/B with t-test</td>
              <td>✓</td>
              <td>—</td>
              <td>manual</td>
              <td>manual</td>
              <td>manual</td>
            </tr>
            <tr>
              <td>Model-swap $ recommendation</td>
              <td>✓</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Judge-vs-human correlation</td>
              <td>✓</td>
              <td>—</td>
              <td>—</td>
              <td>~</td>
              <td>~</td>
            </tr>
            <tr>
              <td>OpenTelemetry ingest</td>
              <td>✓</td>
              <td>—</td>
              <td>✓</td>
              <td>✓</td>
              <td>✓</td>
            </tr>
          </tbody>
        </table>
      </div>

      <FeatureCoverageRadar />

      <h2>When Spanlens is the wrong choice</h2>
      <ul>
        <li>
          <strong>You&apos;re LangChain-native and want every chain decoration first-party.</strong>{' '}
          We support LangChain, LangGraph, LCEL, Vercel AI SDK, and LlamaIndex via a single
          callback handler — but LangSmith is built by the LangChain team and goes deeper into
          their internals.
        </li>
        <li>
          <strong>You need on-prem SOC 2 with FedRAMP yesterday.</strong> Our self-host is solid,
          but the cloud is SOC 2 Type II and our compliance roadmap targets ISO 27001 in 2026 Q3.
          For air-gapped FedRAMP today, talk to enterprise vendors.
        </li>
        <li>
          <strong>You want a vector DB or RAG framework, not observability.</strong> Spanlens
          observes RAG pipelines (every retrieve / rerank / generate span shows up) but we
          don&apos;t ship a vector store. That&apos;s Pinecone / Weaviate / Qdrant territory.
        </li>
      </ul>

      <h2>Migration paths</h2>
      <p>
        Spanlens is a drop-in replacement at the baseURL level, so you can run it side-by-side
        with whatever you have today and turn the other off only when you&apos;re happy. There&apos;s
        no &ldquo;rip out and replace&rdquo; commitment. See the{' '}
        <Link href="/docs/quick-start" className="text-accent hover:underline">Quick start</Link>{' '}
        for both fresh-install and CLI-migration paths.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Spotted a fact about a competitor that&apos;s out of date? Email{' '}
        <a href="mailto:support@spanlens.io" className="text-accent hover:underline">support@spanlens.io</a>{' '}
        — we&apos;ll fix it within a day.
      </p>
    </div>
  )
}
