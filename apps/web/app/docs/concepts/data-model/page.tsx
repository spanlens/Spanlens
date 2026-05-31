import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Data model · Spanlens Docs',
  description:
    'Spanlens data model in one page. Request, Trace, Span, Prompt Version, Eval, Dataset, and how they relate so you can answer billing, debugging, and quality questions without crossing teams.',
  alternates: { canonical: '/docs/concepts/data-model' },
}

export default function DataModelDocs() {
  return (
    <div>
      <h1>Data model</h1>
      <p className="lead">
        Spanlens stores everything in eight core entities. Most of what you do in the
        dashboard is querying one or two of them. This page lays out each entity, what it
        stores, how it relates to the others, and which UI surface reads from it, so you
        can pick the right primitive when you write your own integration or run an
        ad-hoc query.
      </p>

      <h2>The eight entities at a glance</h2>
      <table>
        <thead>
          <tr>
            <th>Entity</th>
            <th>Storage</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><a href="#request"><code>Request</code></a></td>
            <td>ClickHouse</td>
            <td>One LLM call. Cost, latency, tokens, full body.</td>
          </tr>
          <tr>
            <td><a href="#trace"><code>Trace</code></a></td>
            <td>Supabase</td>
            <td>One logical user interaction. Aggregates spans.</td>
          </tr>
          <tr>
            <td><a href="#span"><code>Span</code></a></td>
            <td>Supabase</td>
            <td>One step inside a trace. Forms the tree.</td>
          </tr>
          <tr>
            <td><a href="#prompt"><code>Prompt Version</code></a></td>
            <td>Supabase</td>
            <td>Immutable snapshot of a prompt template.</td>
          </tr>
          <tr>
            <td><a href="#evaluator"><code>Evaluator</code></a></td>
            <td>Supabase</td>
            <td>How to score outputs (LLM-as-judge config).</td>
          </tr>
          <tr>
            <td><a href="#eval-run"><code>Eval Run</code> + <code>Eval Result</code></a></td>
            <td>Supabase</td>
            <td>One execution of an evaluator + per-sample scores.</td>
          </tr>
          <tr>
            <td><a href="#dataset"><code>Dataset</code> + <code>Dataset Item</code></a></td>
            <td>Supabase</td>
            <td>Reusable test inputs for offline evaluation.</td>
          </tr>
          <tr>
            <td><a href="#user-session"><code>User / Session</code></a></td>
            <td>columns on Request</td>
            <td>Header-driven grouping. No separate table.</td>
          </tr>
        </tbody>
      </table>

      <h3>Storage split: why two databases?</h3>
      <p>
        High-cardinality append-only data (Requests) lives in ClickHouse for columnar
        compression and fast time-range aggregation. Relational data with frequent updates
        (Traces, Prompts, Evals, billing, RLS) lives in Supabase Postgres. They are joined
        at the application layer via shared UUIDs.
      </p>
      <ul>
        <li><strong>ClickHouse</strong>: <code>requests</code> (the only table)</li>
        <li><strong>Supabase</strong>: everything else, including the <code>organization_id</code> tenant boundary enforced by Row Level Security</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Self-hosting? Both stores are part of the bundled docker-compose. See{' '}
        <a href="/docs/self-host">Self-hosting</a>.
      </p>

      <h2 id="request">Request</h2>
      <p>
        A Request is one LLM call. Created by the proxy automatically; you never create one
        from the SDK directly.
      </p>
      <CodeBlock language="text">{`Table: requests (ClickHouse)
Order key: (organization_id, project_id, created_at, id)
Partition: monthly by created_at
TTL: 365 days, plan-based filtering at query time`}</CodeBlock>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>id</code></td><td>UUID</td><td>Stable id, surfaced in <a href="/requests">/requests</a> URL.</td></tr>
          <tr><td><code>organization_id</code> / <code>project_id</code></td><td>UUID</td><td>Tenant scope. Always filter on these.</td></tr>
          <tr><td><code>provider</code> / <code>model</code></td><td>LowCardinality(String)</td><td>Compressed for fast group-by queries.</td></tr>
          <tr><td><code>prompt_tokens</code> / <code>completion_tokens</code> / <code>total_tokens</code></td><td>UInt32</td><td>Parsed from provider response.</td></tr>
          <tr><td><code>cache_read_tokens</code> / <code>cache_write_tokens</code></td><td>UInt32</td><td>From OpenAI prompt cache, Anthropic cache control.</td></tr>
          <tr><td><code>cost_usd</code></td><td>Decimal(18, 8)</td><td>Computed from <code>model_prices</code> at log time. Null if model is unseeded.</td></tr>
          <tr><td><code>latency_ms</code> / <code>proxy_overhead_ms</code></td><td>UInt32</td><td>End-to-end and our share.</td></tr>
          <tr><td><code>status_code</code></td><td>UInt16</td><td>HTTP status from upstream.</td></tr>
          <tr><td><code>request_body</code> / <code>response_body</code></td><td>String, ZSTD(3)</td><td>Full bodies. Can be empty if <code>x-spanlens-log-body=meta|none</code>.</td></tr>
          <tr><td><code>trace_id</code> / <code>span_id</code></td><td>Nullable(UUID)</td><td>Set when the call ran inside a Spanlens trace.</td></tr>
          <tr><td><code>prompt_version_id</code></td><td>Nullable(UUID)</td><td>Set via <code>x-spanlens-prompt-version</code>.</td></tr>
          <tr><td><code>user_id</code> / <code>session_id</code></td><td>Nullable(String)</td><td>Set via <code>x-spanlens-user</code> / <code>x-spanlens-session</code>.</td></tr>
          <tr><td><code>flags</code> / <code>response_flags</code></td><td>String (JSON)</td><td>Security findings (PII, jailbreak). See <a href="/docs/features/security">Security</a>.</td></tr>
          <tr><td><code>truncated</code></td><td>Bool</td><td>True if the stream was cut at the 290s deadline.</td></tr>
        </tbody>
      </table>

      <h3>Where it appears in the UI</h3>
      <ul>
        <li><a href="/requests">/requests</a>: every Request, filterable</li>
        <li><a href="/users">/users</a>: Requests grouped by <code>user_id</code></li>
        <li><a href="/savings">/savings</a>: cost analysis joined with <code>model_prices</code></li>
        <li><a href="/anomalies">/anomalies</a>: spikes detected by aggregating Requests over time windows</li>
      </ul>

      <h2 id="trace">Trace</h2>
      <p>
        A Trace groups Spans for one logical interaction (one user question, one cron tick,
        one webhook). Created explicitly via the SDK or implicitly by the LangChain /
        Vercel AI callback handlers.
      </p>
      <CodeBlock language="text">{`Table: traces (Supabase)
Status: running | completed | error
Aggregates (refreshed by DB trigger on span change):
  span_count, total_tokens, total_cost_usd, duration_ms`}</CodeBlock>
      <p>
        The trigger means dashboards only have to query <code>traces</code> to render
        summary rows; they do not have to re-aggregate Spans on every read.
      </p>
      <p>
        UI: <a href="/traces">/traces</a> (list + detail with waterfall).
      </p>

      <h2 id="span">Span</h2>
      <p>
        A Span is one step inside a Trace: an LLM call, a tool call, a retrieval, an
        embedding, or arbitrary custom work. Spans form a tree via{' '}
        <code>parent_span_id</code>.
      </p>
      <CodeBlock language="text">{`Table: spans (Supabase)
span_type: llm | tool | retrieval | embedding | custom
parent_span_id: UUID, NO FK constraint (intentional)`}</CodeBlock>
      <p>
        The lack of a foreign key on <code>parent_span_id</code> is deliberate. Real agent
        code (LangGraph parallel fan-out, <code>Promise.all([...])</code>) closes spans in
        non-deterministic order. The lack of FK lets the database accept the spans in
        whatever order they arrive without rejecting late writes.
      </p>
      <p>
        LLM spans optionally link to the underlying Request via <code>request_id</code>{' '}
        when the call went through the Spanlens proxy. This is how the trace waterfall
        shows token counts and cost on LLM nodes without re-querying ClickHouse.
      </p>

      <h2 id="prompt">Prompt and Prompt Version</h2>
      <p>
        A Prompt is just a name. A Prompt Version is an immutable snapshot of that
        prompt&apos;s content. Creating a new version never touches the old one; old logged
        requests keep their link to the version they actually used.
      </p>
      <CodeBlock language="text">{`Table: prompt_versions (Supabase)
Unique: (organization_id, name, version)
content: text (the template)
variables: jsonb [{ name, description, required }]`}</CodeBlock>
      <p>
        Requests link to a version via <code>requests.prompt_version_id</code>, set when
        the call carries the <code>x-spanlens-prompt-version</code> header
        (SDK helper: <code>withPromptVersion(&apos;name@version&apos;)</code>).
      </p>
      <p>
        UI: <a href="/prompts">/prompts</a> (list + version tree), Prompt A/B view (compare
        two versions on production traffic with significance tests).
      </p>

      <h2 id="evaluator">Evaluator</h2>
      <p>
        Reusable definition of <em>how to score outputs</em>. Independent of any specific
        run.
      </p>
      <CodeBlock language="text">{`Table: evaluators (Supabase)
type: 'llm_judge' (only type today)
config: jsonb {
  criterion,
  judge_provider, judge_model,
  scale_min, scale_max (normalized to 0..1 on save)
}`}</CodeBlock>
      <p>UI: <a href="/evals">/evals</a> (evaluator list).</p>

      <h2 id="eval-run">Eval Run and Eval Result</h2>
      <p>
        An Eval Run is one execution of an Evaluator over N samples. Each Eval Result is
        one score for one sample (either a Request from production, or a Dataset Item).
      </p>
      <CodeBlock language="text">{`Table: eval_runs (Supabase)
source: 'production' | 'dataset'
sample_size: 1..1000
status: pending | running | completed | failed
avg_score: numeric (set on completion)

Table: eval_results (Supabase)
request_id or dataset_item_id (exactly one)
score: 0..1
reasoning: judge's explanation
judge_cost_usd, judge_tokens`}</CodeBlock>
      <p>
        UI: <a href="/evals">/evals</a> (run history per evaluator, drill into score
        distribution, list 5 lowest-scoring samples).
      </p>

      <h2 id="dataset">Dataset and Dataset Item</h2>
      <p>
        A Dataset is a named collection of test cases. Each Dataset Item is one input,
        optionally with an <code>expected_output</code> for accuracy-style scoring.
      </p>
      <CodeBlock language="text">{`Table: datasets (Supabase)
Unique: (organization_id, name)

Table: dataset_items (Supabase)
input: jsonb, two accepted shapes:
  { "variables": { "name": "Alice", ... } }   ← for variable-based prompts
  { "messages": [ {role, content}, ... ] }    ← for raw chat input
expected_output: text (optional)
source_request_id: links back to the production request it was imported from`}</CodeBlock>
      <p>
        Datasets can be populated three ways: manual entry, CSV import, or one-click
        &quot;import this request&quot; from the request detail page.
      </p>
      <p>UI: <a href="/datasets">/datasets</a>.</p>

      <h2 id="user-session">User and Session</h2>
      <p>
        Spanlens does not have a Users table or a Sessions table. Both are columns on the
        Request row, populated from request headers:
      </p>
      <table>
        <thead>
          <tr>
            <th>Concept</th>
            <th>Header</th>
            <th>SDK helper</th>
            <th>Column on <code>requests</code></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>End user</td>
            <td><code>x-spanlens-user</code></td>
            <td><code>withUser(id)</code></td>
            <td><code>user_id</code></td>
          </tr>
          <tr>
            <td>Session / conversation</td>
            <td><code>x-spanlens-session</code></td>
            <td><code>withSession(id)</code></td>
            <td><code>session_id</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        UI: <a href="/users">/users</a> aggregates by <code>user_id</code>, showing
        cost, request count, and last-seen timestamp per end user.
      </p>

      <h2>How they fit together</h2>
      <CodeBlock language="text">{`Organization (tenant boundary)
└── Project
    ├── API Key (sl_live_...)
    │   └── Provider Key (encrypted OpenAI / Anthropic / Gemini key)
    │
    ├── Prompt
    │   └── Prompt Version (immutable)
    │
    ├── Evaluator
    │   └── Eval Run
    │       └── Eval Result ──┐
    │                         │ (one per scored sample)
    ├── Dataset               │
    │   └── Dataset Item ─────┤
    │                         │
    ├── Trace                 │
    │   └── Span              │
    │       └── (optional) request_id ──┐
    │                                   │
    └── Request (ClickHouse) ───────────┤
        ├── user_id (header column)     │
        ├── session_id (header column)  │
        └── prompt_version_id ──────────┘`}</CodeBlock>

      <h2>Tenant boundary</h2>
      <p>
        Every table carries <code>organization_id</code>. On Supabase, Row Level Security
        forces every read and write to match the caller&apos;s organization. On ClickHouse,
        we enforce the same via the <code>requestsScope</code> helper in{' '}
        <code>apps/server/src/lib/requests-query.ts</code>; bypassing it is treated as a
        security bug.
      </p>
      <p className="text-sm text-muted-foreground">
        Plan retention (Free 14 days, Pro 90 days, Team 365 days) is layered on top of the
        365-day ClickHouse TTL: queries auto-filter by <code>created_at &gt;= now() - plan_retention</code>{' '}
        unless the call is a billing read with <code>ignoreRetention: true</code>.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/integrations/langgraph">LangGraph integration</a> for graph
        topology specifics, or <a href="/docs/proxy">direct proxy</a> for non-Node clients.
      </p>
    </div>
  )
}
