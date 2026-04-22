import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Cost tracking · Spanlens Docs',
  description:
    'Accurate per-request USD cost computed from provider token prices. Handles dated model variants via longest-prefix matching.',
}

export default function CostTrackingDocs() {
  return (
    <div>
      <h1>Cost tracking</h1>
      <p className="lead">
        Every request row carries a <code>cost_usd</code> field computed at ingest time from your
        actual token usage and the provider&apos;s current list price. No approximations, no
        post-hoc math in the dashboard — the number is deterministic and auditable.
      </p>

      <h2>Why it matters</h2>
      <p>
        Provider dashboards show spend a day late and at the billing-period level. That&apos;s
        useless for the daily question — &ldquo;is my new feature&apos;s LLM usage going to blow
        up the budget?&rdquo; Spanlens computes cost the moment the response lands, so you can
        track per-minute, per-project, per-user cost without waiting for an invoice.
      </p>

      <h2>How it works</h2>

      <h3>Price table</h3>
      <p>
        <code>apps/server/src/lib/cost.ts</code> ships a curated <code>MODEL_PRICES</code> map —
        USD per 1M tokens, separately for prompt and completion. Snapshot as of 2026-04:
      </p>
      <CodeBlock language="ts">{`'gpt-4o':                         { prompt: 2.5,   completion: 10   }
'gpt-4o-mini':                    { prompt: 0.15,  completion: 0.6  }
'gpt-4-turbo':                    { prompt: 10,    completion: 30   }
'claude-opus-4-7':                { prompt: 15,    completion: 75   }
'claude-sonnet-4-6':              { prompt: 3,     completion: 15   }
'claude-haiku-4-5-20251001':      { prompt: 0.8,   completion: 4    }
'gemini-1.5-pro':                 { prompt: 1.25,  completion: 5    }
'gemini-1.5-flash':               { prompt: 0.075, completion: 0.3  }
// ...`}</CodeBlock>

      <h3>The formula</h3>
      <CodeBlock language="ts">{`promptCost     = (promptTokens     / 1_000_000) * price.prompt
completionCost = (completionTokens / 1_000_000) * price.completion
totalCost      = promptCost + completionCost`}</CodeBlock>

      <h3>The dated-variant problem (critical gotcha)</h3>
      <p>
        OpenAI returns <strong>dated variants</strong> in the <code>model</code> field of the
        response body (e.g. you request <code>gpt-4o-mini</code> and get back{' '}
        <code>gpt-4o-mini-2024-07-18</code>). That dated string is what lands in{' '}
        <code>requests.model</code>. Naive lookup against <code>MODEL_PRICES[&apos;gpt-4o-mini&apos;]</code>
        {' '}would miss and return <code>null</code>.
      </p>
      <p>
        <code>calculateCost()</code> handles this by:
      </p>
      <ol>
        <li>Exact match first — if <code>gpt-4o-mini-2024-07-18</code> is in the table, use it.</li>
        <li>
          Otherwise, <strong>longest boundary-aware prefix match</strong>. The model id must start
          with a registered key followed by <code>-</code>, so <code>gpt-4</code> does not
          accidentally match <code>gpt-4o-mini</code>.
        </li>
      </ol>
      <p>
        The same matching pattern is reused by <a href="/docs/features/savings">Savings</a> and any
        future feature that keys on model family.
      </p>

      <h3>Graceful degradation on unknown models</h3>
      <p>
        If a request comes in for a model we don&apos;t have pricing for (brand-new release,
        fine-tuned custom model), <code>calculateCost()</code> returns <code>null</code> and the
        row&apos;s <code>cost_usd</code> is <code>NULL</code>. Dashboard filters this out of
        cost aggregates — we never estimate or fabricate. The gap is visible, not hidden.
      </p>
      <p>
        Fix: open a PR to add the model to <code>MODEL_PRICES</code> with the provider&apos;s
        official rate. Backfill isn&apos;t retroactive; cost appears on new requests only.
      </p>

      <h2>Using it</h2>

      <h3>Programmatic access</h3>
      <p>
        Cost is a first-class field on every request. Fetch via:
      </p>
      <CodeBlock language="bash">{`# All requests with cost, last 7 days
GET /api/v1/requests?sinceHours=168

# Aggregate cost by model
GET /api/v1/stats?sinceHours=720&groupBy=model
# → [
#     { "model": "gpt-4o", "requestCount": 1204, "totalCostUsd": 12.84 },
#     { "model": "gpt-4o-mini", "requestCount": 42103, "totalCostUsd": 6.32 }
#   ]`}</CodeBlock>

      <h3>Per-project rollup</h3>
      <p>
        Pass <code>projectId</code> to scope. Useful for chargeback when multiple teams share one
        Spanlens org:
      </p>
      <CodeBlock language="bash">{`GET /api/v1/stats?projectId=<uuid>&sinceHours=720&groupBy=model`}</CodeBlock>

      <h2>Design choices</h2>
      <ul>
        <li>
          <strong>Computed at ingest, not at read time.</strong> Freezes the price at the moment of
          the call. If OpenAI drops gpt-4o prices tomorrow, your historical cost data doesn&apos;t
          retroactively change. Audit-friendly.
        </li>
        <li>
          <strong>Stored as <code>numeric(14,8)</code>.</strong> 8 decimal places of precision —
          enough to represent fractional cents on very cheap models without rounding error.
        </li>
        <li>
          <strong>Table, not API.</strong> We don&apos;t fetch live prices from provider APIs —
          they don&apos;t expose one. Hand-maintained table is the reality for the industry.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Price table drifts.</strong> When a provider changes prices, our table needs a
          PR. Tracked as a monthly maintenance item. If you&apos;re self-hosting, pin a specific
          commit or expect to cherry-pick updates.
        </li>
        <li>
          <strong>No cache-token pricing separate line yet.</strong> Anthropic&apos;s{' '}
          <code>cache_read_input_tokens</code> and <code>cache_creation_input_tokens</code> are
          currently folded into prompt tokens. We&apos;re adding separate accounting so cost
          reflects the 10× discount. Roadmap.
        </li>
        <li>
          <strong>No batch API discount.</strong> OpenAI and Anthropic both offer ~50% off batch
          calls. Spanlens treats a batch response as a normal request. Mark batch traffic with a
          custom tag and filter manually for now.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/requests">Requests</a>, <a href="/docs/features/savings">Savings</a>,{' '}
        <a href="/dashboard">/dashboard</a>. Source:{' '}
        <code>apps/server/src/lib/cost.ts</code>.
      </p>
    </div>
  )
}
