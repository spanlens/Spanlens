import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Prompt management · Spanlens Docs',
  description:
    'How Spanlens versions prompts, runs Prompt A/B with Welch t-test on latency and cost, computes z-test on error rate, and rolls back without deploys.',
  alternates: { canonical: '/docs/concepts/prompt-management' },
}

export default function PromptManagementConcept() {
  return (
    <div>
      <h1>Prompt management</h1>
      <p className="lead">
        Prompt management treats prompts as deployable artifacts with versions,
        rollout, and rollback — not strings hardcoded in your application. Spanlens
        provides versioning, side-by-side diff, Prompt A/B with statistical
        significance, gradual rollout, and one-click rollback without redeploying
        your code.
      </p>

      <h2>Prompt as a versioned entity</h2>
      <p>
        A <code>prompt</code> in Spanlens is a named template with an ordered list of{' '}
        <code>prompt_versions</code>. Each version has a UUID, a creation timestamp,
        a draft/published flag, and the full template body. Templates can include
        variables (<code>{`{{customer_name}}`}</code>) that are filled at request
        time.
      </p>
      <CodeBlock language="ts">{`import { SpanlensClient } from '@spanlens/sdk'

const client = new SpanlensClient()

// Resolve the latest published version of a prompt by name
const prompt = await client.prompts.resolve('classify_intent', { tag: 'production' })
const messages = prompt.render({ customer_name: 'Alex' })

// Then send to OpenAI/Anthropic as usual
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages,
})`}</CodeBlock>
      <p>
        The resolved version ID flows into the response captured by Spanlens via the{' '}
        <code>X-Spanlens-Prompt-Version</code> header, so every request lands in the
        dashboard already tagged with the prompt version that produced it.
      </p>

      <h2>Prompt A/B with Welch t-test</h2>
      <p>
        Spanlens runs side-by-side prompt versions on a configurable traffic split
        (default 50/50) and reports statistical significance on the three metrics
        that matter:
      </p>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Test</th>
            <th>Why this test</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Latency (ms)</td>
            <td>Welch&apos;s t-test</td>
            <td>Unequal variances expected (one version may be much slower).</td>
          </tr>
          <tr>
            <td>Cost (USD)</td>
            <td>Welch&apos;s t-test</td>
            <td>Same as latency — unequal variance is the norm.</td>
          </tr>
          <tr>
            <td>Error rate (4xx/5xx + parse failures)</td>
            <td>Two-proportion z-test</td>
            <td>Errors are Bernoulli, t-test would be incorrect here.</td>
          </tr>
          <tr>
            <td>Quality (eval score)</td>
            <td>Welch&apos;s t-test</td>
            <td>Continuous score on [0, 1].</td>
          </tr>
        </tbody>
      </table>
      <p>
        The dashboard surfaces p-values and effect sizes. A green &quot;significant
        improvement&quot; verdict requires p &lt; 0.05 with a directional improvement
        on the primary metric you picked at experiment setup.
      </p>

      <h2>Gradual rollout</h2>
      <p>
        Once an A/B reaches significance, promote the winner via gradual rollout.
        Spanlens routes 10% → 50% → 100% of traffic with configurable bake periods,
        and automatic rollback if the error rate or eval score collapses during a
        bake. Rollback is a single API call (or button click) and does not require a
        redeploy.
      </p>
      <CodeBlock language="ts">{`await client.prompts.promote('classify_intent', {
  to_version: 'pv_xxx',
  rollout: [
    { percent: 10, bake_minutes: 30 },
    { percent: 50, bake_minutes: 60 },
    { percent: 100 },
  ],
  auto_rollback_on: {
    error_rate_increase: 0.02, // rollback if errors rise more than 2 pp
    eval_score_drop: 0.05,
  },
})`}</CodeBlock>

      <h2>Diff and history</h2>
      <p>
        Each version stores its full body, so the diff view shows additions and
        deletions inline. The version history is append-only — published versions
        cannot be edited, only superseded by a new version. Rollback is achieved by
        promoting an older version, not by editing.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/docs/features/prompts">Prompts feature page</a>, dashboard
          surface.
        </li>
        <li>
          <a href="/docs/features/prompt-ab">Prompt A/B</a>, experiment setup.
        </li>
        <li>
          <a href="/docs/features/prompts-playground">Playground</a>, test prompts
          across models and inputs.
        </li>
        <li>
          <a href="/docs/concepts/evals">Evals</a>, how scores feed into A/B
          decisions.
        </li>
      </ul>
    </div>
  )
}
