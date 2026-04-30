import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Savings · Spanlens Docs',
  description:
    'Model recommendations based on your real token distribution. Suggests cheaper substitutes with estimated monthly savings.',
}

export default function SavingsDocs() {
  return (
    <div>
      <h1>Savings</h1>
      <p className="lead">
        Spanlens analyzes your last 7 days of LLM traffic and suggests specific{' '}
        <strong>(provider, model)</strong> pairs that can be swapped for cheaper alternatives at
        the same task quality. Recommendations come with an estimated monthly savings figure in USD
        — no hand-waving.
      </p>

      <h2>Why it matters</h2>
      <p>
        The most common LLM cost mistake is <em>using GPT-4 for everything</em>. Extraction,
        classification, short-form generation, intent detection — these workloads are indistinguishable
        from GPT-4o-mini at 1/15 the price, but teams default to the most capable model out of
        caution and never revisit.
      </p>
      <p>
        Savings is a cold look at your actual usage: &ldquo;You sent 42,000 gpt-4o calls last week
        with an average prompt of 180 tokens and output of 85 tokens. That pattern fits the
        gpt-4o-mini envelope. Switching would save ~$380/month.&rdquo;
      </p>

      <h2>How it works</h2>

      <h3>Aggregation</h3>
      <p>
        Every 24 hours we aggregate the last <code>N=7</code> days of <code>requests</code> grouped
        by <code>(provider, model)</code>, computing:
      </p>
      <ul>
        <li><code>sampleCount</code> — how many requests in the bucket</li>
        <li><code>avgPromptTokens</code>, <code>avgCompletionTokens</code></li>
        <li><code>totalCostUsd</code> — actual spend</li>
        <li>Extrapolated monthly cost = 7-day total ÷ 7 × 30</li>
      </ul>

      <h3>Substitute matching</h3>
      <p>
        Each bucket is matched against a curated <code>SUBSTITUTES</code> rule table in{' '}
        <code>lib/model-recommend-rules.ts</code>. Current rules (subject to change as models
        release):
      </p>
      <table>
        <thead>
          <tr>
            <th>Current model</th>
            <th>Suggested substitute</th>
            <th>Cost ratio</th>
            <th>Token envelope</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>openai:gpt-4o</code></td>
            <td><code>openai:gpt-4o-mini</code></td>
            <td>6%</td>
            <td>prompt ≤ 500, completion ≤ 150</td>
          </tr>
          <tr>
            <td><code>anthropic:claude-3-opus</code></td>
            <td><code>anthropic:claude-haiku-4.5</code></td>
            <td>4%</td>
            <td>prompt ≤ 500, completion ≤ 200</td>
          </tr>
          <tr>
            <td><code>anthropic:claude-3-5-sonnet</code></td>
            <td><code>anthropic:claude-haiku-4.5</code></td>
            <td>25%</td>
            <td>prompt ≤ 800, completion ≤ 250</td>
          </tr>
          <tr>
            <td><code>gemini:gemini-1.5-pro</code></td>
            <td><code>gemini:gemini-1.5-flash</code></td>
            <td>6.7%</td>
            <td>prompt ≤ 1000, completion ≤ 300</td>
          </tr>
        </tbody>
      </table>
      <p>
        A recommendation fires only if <strong>both</strong> avg-prompt and avg-completion fit
        inside the envelope. This is the conservative guard — if your average request exceeds the
        envelope, the suggested cheaper model probably will underperform on your actual workload,
        and we don&apos;t show it.
      </p>

      <h3>Longest-prefix matching for dated variants</h3>
      <p>
        OpenAI returns dated model strings (<code>gpt-4o-mini-2024-07-18</code>) in the response
        body, and that&apos;s what ends up in <code>requests.model</code>. The matcher does an
        exact lookup first, then falls back to <strong>longest boundary-aware prefix match</strong>
        so a dated variant correctly resolves to its family rule:
      </p>
      <CodeBlock language="ts">{`matchSubstitute('openai:gpt-4o-2024-08-06')
// → resolves to 'openai:gpt-4o' rule
// → suggests gpt-4o-mini`}</CodeBlock>

      <h3>Savings calculation</h3>
      <CodeBlock language="text">{`monthlyCostCurrent   = totalCostUsd * (30 / 7)
monthlyCostSuggested = monthlyCostCurrent * substitute.costRatio
estimatedSavingsUsd  = monthlyCostCurrent - monthlyCostSuggested`}</CodeBlock>
      <p>
        Only recommendations with <code>estimatedSavingsUsd ≥ $5</code> surface in the dashboard
        — below that, the signal-to-noise isn&apos;t worth your attention.
      </p>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        Visit <a href="/savings">/savings</a> in the sidebar. Each row shows:
      </p>
      <ul>
        <li>Current model + sample count + monthly cost</li>
        <li>Suggested model + estimated monthly cost after swap</li>
        <li>Estimated savings in USD/month</li>
        <li>Rationale — the rule&apos;s <code>reason</code> string (e.g. &ldquo;Short inputs/outputs suggest classification workload&rdquo;)</li>
      </ul>

      <h3>API</h3>
      <CodeBlock language="bash">{`GET /api/v1/recommendations

# →
#   [
#     {
#       "currentProvider": "openai",
#       "currentModel": "gpt-4o-2024-08-06",
#       "sampleCount": 42103,
#       "avgPromptTokens": 180,
#       "avgCompletionTokens": 85,
#       "monthlyCostCurrentUsd": 412.50,
#       "suggestedProvider": "openai",
#       "suggestedModel": "gpt-4o-mini",
#       "monthlyCostSuggestedUsd": 24.75,
#       "estimatedSavingsUsd": 387.75,
#       "reason": "Short inputs/outputs suggest classification/extraction workload — gpt-4o-mini covers it at ~15x lower cost."
#     }
#   ]`}</CodeBlock>

      <h2>Design choices</h2>
      <ul>
        <li>
          <strong>Rules are curated, not ML.</strong> Empirical cost ratios and token envelopes
          come from hand-tested substitutions. A learned recommender would drift as model prices
          change weekly; curated rules are easier to audit and correct.
        </li>
        <li>
          <strong>No A/B auto-rollout.</strong> We show you the recommendation; you decide whether
          to switch. Automated multi-armed-bandit model routing is out of scope for launch — it&apos;s
          a different product surface.
        </li>
        <li>
          <strong>Conservative envelope.</strong> Better to miss a borderline recommendation than
          to suggest a swap that degrades your UX. False negatives are recoverable; false positives
          break trust.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Token-based, not task-based.</strong> A 200-token prompt can be &ldquo;summarize
          this article&rdquo; (gpt-4o-mini is fine) or &ldquo;generate the JSON schema for my domain
          model&rdquo; (gpt-4o is better). The envelope catches most cases but occasional false
          positives are possible — hence the manual-approval loop.
        </li>
        <li>
          <strong>Rule table needs periodic refresh.</strong> New models (GPT-5, Claude 4.7) need
          rule entries added. Tracked as a Phase 3 maintenance item.
        </li>
        <li>
          <strong>No cross-provider recommendations yet.</strong> We don&apos;t suggest
          &ldquo;switch from gpt-4o-mini to claude-haiku&rdquo; even when cheaper — accuracy
          comparisons across providers are too workload-dependent to ship blind.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/prompts">Prompts</a> (A/B by cost), <a href="/savings">/savings</a>{' '}
        dashboard. Source: <code>apps/server/src/lib/model-recommend-rules.ts</code>.
      </p>
    </div>
  )
}
