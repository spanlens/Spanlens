import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'LLM observability · Spanlens Docs',
  description:
    'What LLM observability is, the five signal categories worth capturing, and how Spanlens maps each one to a concrete entity in the data model.',
  alternates: { canonical: '/docs/concepts/llm-observability' },
}

export default function LlmObservabilityConcept() {
  return (
    <div>
      <h1>LLM observability</h1>
      <p className="lead">
        LLM observability is the practice of capturing every call your application
        makes to a large language model, then surfacing the cost, latency, token
        usage, and behavioral signals that decide whether the app stays profitable,
        fast, and safe. It is the LLM-specific equivalent of APM for traditional
        services. This page is the conceptual entry point; the marketing-side hub
        lives at <a href="/llm-observability">/llm-observability</a>.
      </p>

      <h2>Why standard APM is not enough</h2>
      <p>
        Datadog, New Relic, and Sentry track HTTP requests and database spans. LLM
        calls have shapes those tools were not built to capture: token counts that
        drive non-linear cost, model variants priced differently within the same
        provider, prompt versions that change behavior without code changes, tool
        calls that branch into agent flows, and non-deterministic output where the
        same input gives different results on each run.
      </p>

      <h2>The five categories Spanlens captures</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Spanlens entity</th>
            <th>Surface</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cost (USD per request, per model, per customer)</td>
            <td>
              <code>requests.cost_usd</code> + tags
            </td>
            <td>
              <a href="/requests">/requests</a>, <a href="/savings">/savings</a>
            </td>
          </tr>
          <tr>
            <td>Latency (p50/p95/p99, TTFT for streaming)</td>
            <td>
              <code>requests.latency_ms</code>, <code>requests.time_to_first_token_ms</code>
            </td>
            <td>
              <a href="/requests">/requests</a>
            </td>
          </tr>
          <tr>
            <td>Quality (eval scores, judge↔human correlation)</td>
            <td>
              <code>evals</code>, <code>annotations</code>
            </td>
            <td>
              <a href="/evals">/evals</a>, <a href="/annotation">/annotation</a>
            </td>
          </tr>
          <tr>
            <td>Reliability (error rates, retry counts)</td>
            <td>
              <code>requests.status</code>, <code>requests.retry_count</code>
            </td>
            <td>
              <a href="/anomalies">/anomalies</a>, <a href="/alerts">/alerts</a>
            </td>
          </tr>
          <tr>
            <td>Security (PII matches, prompt injection, key leakage)</td>
            <td>
              <code>requests.pii_flags</code>, <code>security_events</code>
            </td>
            <td>
              <a href="/security">/security</a>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Three integration patterns</h2>
      <p>
        Spanlens supports the three patterns that dominate the space. Pick by stack,
        not by ideology.
      </p>

      <h3>1. Drop-in SDK</h3>
      <p>
        Swap the provider SDK import for a Spanlens-instrumented version. Same
        methods, same types. Fastest for single-language apps.
      </p>
      <CodeBlock language="ts">{`// Before
import OpenAI from 'openai'
const openai = new OpenAI()

// After
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI()`}</CodeBlock>

      <h3>2. Proxy</h3>
      <p>
        Point the provider <code>baseURL</code> at the Spanlens proxy. Works in any
        language including Ruby, Go, and raw HTTP.
      </p>
      <CodeBlock language="http">{`POST https://api.spanlens.io/proxy/openai/v1/chat/completions
Authorization: Bearer sl_live_...
Content-Type: application/json

{"model":"gpt-4o-mini","messages":[...]}`}</CodeBlock>

      <h3>3. OpenTelemetry</h3>
      <p>
        Emit OTLP/HTTP spans from your existing OTel pipeline. Best when you already
        have OTel exporters set up and want LLM spans to flow through the same
        infrastructure. See <a href="/docs/otel">/docs/otel</a> for setup.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/docs/concepts/data-model">Data model</a>, the eight entities that
          back every dashboard view.
        </li>
        <li>
          <a href="/docs/concepts/agent-tracing">Agent tracing</a>, span tree
          structure and critical path.
        </li>
        <li>
          <a href="/docs/concepts/evals">Evals</a>, scoring quality and tracking
          drift over prompt versions.
        </li>
        <li>
          <a href="/docs/concepts/prompt-management">Prompt management</a>, versioning,
          A/B, and statistical rollout decisions.
        </li>
      </ul>
    </div>
  )
}
