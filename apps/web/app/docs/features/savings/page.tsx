import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Savings · Spanlens Docs',
  description:
    'Model recommendations based on your real token distribution. Suggests cheaper substitutes with estimated monthly savings, confidence tiers, and email alerts.',
}

export default function SavingsDocs() {
  return (
    <div>
      <h1>Savings</h1>
      <p className="lead">
        Spanlens analyzes your LLM traffic over a configurable window (7 / 14 / 30 days) and
        suggests specific <strong>(provider, model)</strong> pairs that can be swapped for cheaper
        alternatives at the same task quality. Recommendations come with an estimated monthly
        savings figure in USD and a confidence tier — no hand-waving.
      </p>

      <h2>Why it matters</h2>
      <p>
        The most common LLM cost mistake is <em>using GPT-4 for everything</em>. Extraction,
        classification, short-form generation, intent detection — these workloads are
        indistinguishable from GPT-4o-mini at 1/15 the price, but teams default to the most
        capable model out of caution and never revisit.
      </p>
      <p>
        Savings is a cold look at your actual usage: &ldquo;You sent 42,000 gpt-4o calls last week
        with an average prompt of 180 tokens and output of 85 tokens. That pattern fits the
        gpt-4o-mini envelope. Switching would save ~$380/month.&rdquo;
      </p>

      <h2>How it works</h2>

      <h3>Aggregation</h3>
      <p>
        Spanlens aggregates the <code>requests</code> table over your chosen analysis window (see{' '}
        <a href="#analysis-window">Analysis window</a> below), grouped by{' '}
        <code>(provider, model)</code>, computing:
      </p>
      <ul>
        <li><code>sampleCount</code> — how many requests in the bucket</li>
        <li><code>avgPromptTokens</code>, <code>avgCompletionTokens</code></li>
        <li><code>totalCostUsdLastNDays</code> — actual spend over the window</li>
        <li>Extrapolated monthly cost = window total ÷ window days × 30</li>
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
            <td><code>openai:gpt-4.1</code></td>
            <td><code>openai:gpt-4.1-mini</code></td>
            <td>20%</td>
            <td>prompt ≤ 500, completion ≤ 150</td>
          </tr>
          <tr>
            <td><code>openai:gpt-4-turbo</code></td>
            <td><code>openai:gpt-4o</code></td>
            <td>25%</td>
            <td>prompt ≤ 2000, completion ≤ 500</td>
          </tr>
          <tr>
            <td><code>openai:gpt-4</code></td>
            <td><code>openai:gpt-4o</code></td>
            <td>8.3%</td>
            <td>prompt ≤ 4000, completion ≤ 1000</td>
          </tr>
          <tr>
            <td><code>anthropic:claude-opus-4-7</code></td>
            <td><code>anthropic:claude-haiku-4.5</code></td>
            <td>20%</td>
            <td>prompt ≤ 500, completion ≤ 200</td>
          </tr>
          <tr>
            <td><code>anthropic:claude-3-opus-20240229</code></td>
            <td><code>anthropic:claude-haiku-4.5</code></td>
            <td>6.7%</td>
            <td>prompt ≤ 500, completion ≤ 200</td>
          </tr>
          <tr>
            <td><code>anthropic:claude-sonnet-4-6</code></td>
            <td><code>anthropic:claude-haiku-4.5</code></td>
            <td>33.3%</td>
            <td>prompt ≤ 800, completion ≤ 250</td>
          </tr>
          <tr>
            <td><code>anthropic:claude-3-5-sonnet-20241022</code></td>
            <td><code>anthropic:claude-haiku-4.5</code></td>
            <td>33.3%</td>
            <td>prompt ≤ 800, completion ≤ 250</td>
          </tr>
          <tr>
            <td><code>gemini:gemini-2.5-pro</code></td>
            <td><code>gemini:gemini-2.5-flash</code></td>
            <td>25%</td>
            <td>prompt ≤ 1000, completion ≤ 300</td>
          </tr>
          <tr>
            <td><code>gemini:gemini-1.5-pro</code></td>
            <td><code>gemini:gemini-1.5-flash</code></td>
            <td>6%</td>
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
      <CodeBlock language="text">{`monthlyCostCurrent   = totalCostUsdLastNDays * (30 / windowDays)
monthlyCostSuggested = monthlyCostCurrent * substitute.costRatio
estimatedMonthlySavingsUsd = monthlyCostCurrent - monthlyCostSuggested`}</CodeBlock>
      <p>
        Only recommendations with <code>estimatedMonthlySavingsUsd ≥ $5</code> surface in the
        dashboard by default — below that, the signal-to-noise isn&apos;t worth your attention.
        You can override this with the <code>?minSavings=</code> query parameter.
      </p>

      <h3>Confidence tiers</h3>
      <p>
        Each recommendation is assigned a confidence tier based on projected savings and sample
        volume. Higher volume = more representative average tokens = more trustworthy envelope
        match.
      </p>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Criteria</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>High</strong></td>
            <td>≥ $40/mo projected savings <em>and</em> ≥ 100 samples</td>
            <td>3-bar indicator (green)</td>
          </tr>
          <tr>
            <td><strong>Medium</strong></td>
            <td>≥ $10/mo projected savings <em>and</em> ≥ 30 samples</td>
            <td>2-bar indicator (neutral)</td>
          </tr>
          <tr>
            <td><strong>Low</strong></td>
            <td>Below medium threshold</td>
            <td>1-bar indicator (muted)</td>
          </tr>
        </tbody>
      </table>
      <p>
        The hero tile at the top of the Savings dashboard surfaces the highest tier available and
        its aggregate savings figure. High-confidence recommendations also trigger automatic{' '}
        <a href="#email-alerts">email alerts</a> once per recommendation.
      </p>

      <h2 id="analysis-window">Analysis window</h2>
      <p>
        The topbar of the Savings page has a <strong>7d / 14d / 30d</strong> selector that
        controls how far back Spanlens looks when computing averages. The selection is per-session
        (not persisted) and defaults to 7 days.
      </p>
      <ul>
        <li>
          <strong>7 days</strong> — most responsive to recent model usage changes; default.
        </li>
        <li>
          <strong>14 days</strong> — smooths out weekly spikes; useful when traffic is seasonal.
        </li>
        <li>
          <strong>30 days</strong> — highest sample counts, most stable confidence tiers.
        </li>
      </ul>
      <p>
        Changing the window re-fetches the API with a different <code>?hours=</code> value and
        recomputes all savings estimates in-page — no page reload needed.
      </p>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        Visit <a href="/savings">/savings</a> in the sidebar. The page has three zones:
      </p>
      <ul>
        <li>
          <strong>Hero tile</strong> — summary card showing your best confidence tier, how many
          recommendations are in it, and their combined monthly savings.
        </li>
        <li>
          <strong>Recommendation rows</strong> — each row shows the current model (sample count,
          monthly cost) → suggested model (projected cost, savings), a confidence bar, a rationale
          string, and two action buttons: <strong>Simulate</strong> and <strong>Hide</strong>.
        </li>
        <li>
          <strong>Hidden section</strong> — recommendations you&apos;ve dismissed live here. A
          &ldquo;Show hidden&rdquo; toggle expands the section; each row has a{' '}
          <strong>Restore</strong> button to un-dismiss it.
        </li>
      </ul>

      <h3>Hiding recommendations</h3>
      <p>
        Click <strong>Hide</strong> on a row to dismiss a recommendation you&apos;ve already
        evaluated and decided against. Dismissed rows move to the collapsible &ldquo;Hidden
        recommendations&rdquo; section at the bottom of the page and are stored in{' '}
        <code>localStorage</code> — they persist across page reloads in the same browser. Click{' '}
        <strong>Restore</strong> inside the hidden section to bring a row back.
      </p>
      <p>
        When all visible recommendations have been hidden, the empty state message changes from the
        generic &ldquo;no opportunities&rdquo; copy to &ldquo;All recommendations hidden — use
        Restore to bring them back.&rdquo;
      </p>

      <h2 id="email-alerts">High-confidence email alerts</h2>
      <p>
        Every day at 09:00 UTC, Spanlens runs the recommendation engine for every organization and
        checks for <strong>high-confidence</strong> swaps (≥ $40/mo + ≥ 100 samples) that
        haven&apos;t been notified before. When new high-confidence recommendations are found, the
        org owner receives a plain-text email listing:
      </p>
      <ul>
        <li>The current and suggested (provider, model) pair</li>
        <li>Projected monthly savings in USD</li>
        <li>Sample count (for context on estimate quality)</li>
        <li>A direct link to the Savings dashboard</li>
      </ul>
      <p>
        Notifications are idempotent — each (org, swap pair) triggers at most one email, stored
        in the <code>recommendation_notifications</code> table. Future cron runs skip already-
        notified pairs. A new notification fires only if a net-new high-confidence recommendation
        appears (e.g., more traffic builds confidence on a previously low-tier swap).
      </p>

      <h3>API</h3>
      <h4>GET /api/v1/recommendations</h4>
      <CodeBlock language="bash">{`GET /api/v1/recommendations
GET /api/v1/recommendations?hours=336          # 14-day window
GET /api/v1/recommendations?hours=720          # 30-day window
GET /api/v1/recommendations?minSavings=20      # only show ≥ $20/mo

# →
#   {
#     "data": [
#       {
#         "currentProvider": "openai",
#         "currentModel": "gpt-4o-2024-08-06",
#         "sampleCount": 42103,
#         "avgPromptTokens": 180,
#         "avgCompletionTokens": 85,
#         "totalCostUsdLastNDays": 96.25,
#         "suggestedProvider": "openai",
#         "suggestedModel": "gpt-4o-mini",
#         "estimatedMonthlySavingsUsd": 387.75,
#         "reason": "Short inputs/outputs suggest classification/extraction workload — gpt-4o-mini covers it at ~15x lower cost."
#       }
#     ],
#     "meta": { "hours": 168, "minSavingsUsd": 5 }
#   }`}</CodeBlock>

      <p>Query parameters:</p>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>hours</code></td>
            <td><code>168</code> (7 days)</td>
            <td>Analysis window in hours. Use <code>336</code> for 14 days, <code>720</code> for 30 days.</td>
          </tr>
          <tr>
            <td><code>minSavings</code></td>
            <td><code>5</code></td>
            <td>Minimum projected monthly savings in USD. Recommendations below this threshold are excluded.</td>
          </tr>
        </tbody>
      </table>

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
        <li>
          <strong>Email alerts are once-per-recommendation.</strong> Nagging users with the same
          recommendation every day would train them to ignore the emails. One notification per
          high-confidence finding; future findings on new pairs trigger fresh alerts.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Token-based, not task-based.</strong> A 200-token prompt can be &ldquo;summarize
          this article&rdquo; (gpt-4o-mini is fine) or &ldquo;generate the JSON schema for my
          domain model&rdquo; (gpt-4o is better). The envelope catches most cases but occasional
          false positives are possible — hence the manual-approval loop.
        </li>
        <li>
          <strong>No cross-provider recommendations yet.</strong> We don&apos;t suggest
          &ldquo;switch from gpt-4o-mini to claude-haiku&rdquo; even when cheaper — accuracy
          comparisons across providers are too workload-dependent to ship blind.
        </li>
        <li>
          <strong>Dismiss state is browser-local.</strong> Hiding a recommendation is stored in{' '}
          <code>localStorage</code> and does not sync across devices or team members.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/prompts">Prompts</a> (A/B by cost),{' '}
        <a href="/savings">/savings</a> dashboard. Source:{' '}
        <code>apps/server/src/lib/model-recommend-rules.ts</code>,{' '}
        <code>apps/server/src/lib/recommendation-notify.ts</code>.
      </p>
    </div>
  )
}
