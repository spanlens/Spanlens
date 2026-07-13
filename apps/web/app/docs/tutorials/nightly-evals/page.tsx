import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'Nightly evals on production traffic · Spanlens Docs',
  description:
    'Tutorial: set up an LLM-as-judge evaluator on a nightly sample of production traffic and catch prompt quality regressions before users complain.',
  alternates: { canonical: '/docs/tutorials/nightly-evals' },
}

export default function NightlyEvalsTutorial() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Tutorial: nightly evals on production traffic</h1>
      <p className="lead">
        Forty-five minutes. We create an LLM-as-judge evaluator, run it once by hand on a
        sample of yesterday&apos;s requests, then schedule the same run nightly via cron.
        The output is a quality score per prompt version, sitting next to cost and
        latency in the dashboard.
      </p>

      <h2>What you will end up with</h2>
      <ul>
        <li>One Evaluator named <em>Helpfulness check</em> targeting your <code>rag-system</code> prompt.</li>
        <li>One Eval Run per night, sampling 100 production responses, scoring each 0..1.</li>
        <li>Trend line in <a href="/evals">/evals</a> showing average score per day.</li>
        <li>Drill-down to the five lowest-scoring samples each night for manual review.</li>
      </ul>

      <h2>Prerequisites</h2>
      <ul>
        <li>You have at least one prompt version logged (the <a href="/docs/tutorials/rag-chatbot">RAG tutorial</a> sets this up).</li>
        <li>You have at least one provider key (OpenAI or Anthropic) registered. The judge LLM uses that key.</li>
        <li>A scheduler that can hit an HTTPS endpoint with a header (Vercel Cron, GitHub Actions, a real cron box, Modal, Inngest, anything).</li>
      </ul>

      <h2>Step 1. Create the Evaluator</h2>
      <p>
        Open <a href="/evals">/evals</a> and click <strong>New evaluator</strong>. Fill in:
      </p>
      <ul>
        <li><strong>Targets prompt</strong>: <code>rag-system</code> (the name you registered).</li>
        <li><strong>Name</strong>: <code>Helpfulness check</code>.</li>
        <li><strong>Type</strong>: <code>llm_judge</code> (the only type today).</li>
        <li>
          <strong>Criterion</strong>: write the rubric. Keep it specific. Example:
          <CodeBlock language="text">{`Rate how helpful this response is to the user's question, on a scale of 1 to 5.
- 5: directly answers the question with correct, cited information from the context.
- 4: directly answers but does not cite, or has a minor inaccuracy.
- 3: partially answers; misses something important.
- 2: largely off-topic or hallucinates.
- 1: refuses, errors out, or returns gibberish.

Reply with: {"score": <1-5>, "reasoning": "<one sentence>"}`}</CodeBlock>
        </li>
        <li><strong>Judge provider / model</strong>: pick a stronger model than the one being judged. If <code>rag-system</code> uses gpt-4o-mini, judge with gpt-4o.</li>
        <li><strong>Scale</strong>: <code>1</code> to <code>5</code>. Spanlens normalizes to 0..1 on save.</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        See <a href="/docs/features/evals">Evals reference</a> for the full evaluator
        config and the schema used to validate the judge&apos;s response.
      </p>

      <h2>Step 2. Run it once by hand</h2>
      <p>
        Confirm the evaluator works before automating. From the evaluator detail page,
        click <strong>Run</strong> and select:
      </p>
      <ul>
        <li><strong>Source</strong>: <code>production</code>.</li>
        <li><strong>Prompt version</strong>: <code>rag-system@1</code>.</li>
        <li><strong>Time window</strong>: last 24 hours.</li>
        <li><strong>Sample size</strong>: 25 (small for a smoke test).</li>
      </ul>
      <p>
        The server samples 25 responses tagged with <code>prompt_version_id =
        rag-system@1</code>, asks the judge to score each, and writes one{' '}
        <code>eval_results</code> row per sample. Total run cost is shown on completion;
        for 25 samples on gpt-4o the bill is usually under $0.10.
      </p>
      <p>
        When the run shows <strong>Completed</strong>, the average score and the five
        lowest-scoring drilldowns appear. Read the low ones. If the judge is being
        nitpicky in ways you do not care about, tighten the criterion and re-run.
      </p>

      <h2>Step 3. Trigger runs via the REST API</h2>
      <p>
        The same UI action is also a REST endpoint. Authenticate with your project
        Spanlens key (<code>sl_live_*</code>).
      </p>
      <CodeBlock language="bash">{`# Look up the evaluator id once
curl -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  https://api.spanlens.io/api/v1/evaluators

# Trigger a new run
curl -X POST https://api.spanlens.io/api/v1/eval-runs \\
  -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "evaluator_id": "<id-from-above>",
    "source": "production",
    "prompt_version_id": "<rag-system@1 uuid>",
    "sample_from": "2026-05-30T00:00:00Z",
    "sample_to":   "2026-05-31T00:00:00Z",
    "sample_size": 100
  }'`}</CodeBlock>
      <p>
        Response includes the new <code>eval_run.id</code>. The run is async; poll{' '}
        <code>GET /api/v1/eval-runs/&lt;id&gt;</code> for <code>status: completed</code>.
      </p>
      <p className="text-sm text-muted-foreground">
        Estimate cost before kicking off: <code>POST /api/v1/eval-runs/estimate</code>{' '}
        accepts the same body and returns the expected judge cost based on average sample
        size.
      </p>

      <h2>Step 4. Schedule it</h2>
      <p>
        Now make it run automatically every night at 2am UTC. Three common patterns; pick
        what your stack already has.
      </p>

      <h3>Vercel Cron</h3>
      <p>
        Add a route handler in your app and declare a cron in <code>vercel.json</code>.
      </p>
      <CodeBlock language="json">{`// vercel.json
{
  "crons": [
    { "path": "/api/cron/nightly-eval", "schedule": "0 2 * * *" }
  ]
}`}</CodeBlock>
      <CodeBlock language="ts">{`// app/api/cron/nightly-eval/route.ts
export async function GET(req: Request) {
  // Vercel sends an Authorization header you can verify against CRON_SECRET
  if (req.headers.get('authorization') !== \`Bearer \${process.env.CRON_SECRET}\`) {
    return new Response('unauthorized', { status: 401 })
  }

  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const isoDay = (d: Date) => d.toISOString()

  const res = await fetch('https://api.spanlens.io/api/v1/eval-runs', {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${process.env.SPANLENS_API_KEY}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      evaluator_id: process.env.SPANLENS_EVALUATOR_ID,
      source: 'production',
      prompt_version_id: process.env.SPANLENS_PROMPT_VERSION_ID,
      sample_from: isoDay(yesterday),
      sample_to: isoDay(now),
      sample_size: 100,
    }),
  })

  if (!res.ok) return new Response(await res.text(), { status: 500 })
  return Response.json(await res.json())
}`}</CodeBlock>

      <h3>GitHub Actions</h3>
      <CodeBlock language="yaml">{`# .github/workflows/nightly-eval.yml
name: Nightly Spanlens eval
on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger eval run
        env:
          SPANLENS_API_KEY: \${{ secrets.SPANLENS_API_KEY }}
          EVALUATOR_ID: \${{ vars.SPANLENS_EVALUATOR_ID }}
          PV_ID: \${{ vars.SPANLENS_PROMPT_VERSION_ID }}
        run: |
          NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
          FROM=$(date -u -d '1 day ago' +"%Y-%m-%dT%H:%M:%SZ")
          curl -sf -X POST https://api.spanlens.io/api/v1/eval-runs \\
            -H "Authorization: Bearer $SPANLENS_API_KEY" \\
            -H "Content-Type: application/json" \\
            -d "{
              \\"evaluator_id\\": \\"$EVALUATOR_ID\\",
              \\"source\\": \\"production\\",
              \\"prompt_version_id\\": \\"$PV_ID\\",
              \\"sample_from\\": \\"$FROM\\",
              \\"sample_to\\":   \\"$NOW\\",
              \\"sample_size\\": 100
            }"`}</CodeBlock>

      <h3>Plain cron</h3>
      <CodeBlock language="bash">{`# crontab -e
0 2 * * * /usr/local/bin/nightly-eval.sh >> /var/log/nightly-eval.log 2>&1`}</CodeBlock>
      <p>The shell script is the same <code>curl</code> from the GitHub Actions job.</p>

      <h2>Step 5. Alert when scores drop</h2>
      <p>
        Set up an <a href="/docs/features/alerts">alert</a> on the evaluator&apos;s
        <em>average score</em> metric. Threshold below 0.7 (or whatever your baseline is)
        fires a webhook to Slack / PagerDuty. Catch a prompt regression before users
        complain.
      </p>

      <h2>Cost guardrails</h2>
      <ul>
        <li>
          The judge cost is paid through <em>your</em> provider key (the OpenAI / Anthropic
          key you registered). It shows up as normal requests in <a href="/requests">/requests</a>{' '}
          tagged with <code>x-spanlens-internal=eval</code>.
        </li>
        <li>
          A sample of 100 against gpt-4o costs roughly $0.30 to $0.80 per run. Nightly is
          ~$25/month per evaluator. Use a cheaper judge model if cost matters more than
          calibration.
        </li>
        <li>
          The <code>POST /eval-runs/estimate</code> endpoint returns a pre-run cost
          estimate. Useful as a sanity check in the cron handler before firing the real
          request.
        </li>
      </ul>

      <h2>Tuning the rubric</h2>
      <p>
        Two failure modes to watch for:
      </p>
      <ul>
        <li>
          <strong>Judge is too lenient.</strong> Average score stuck at 0.95 forever, even
          on bad responses. Make the rubric stricter (more explicit deductions for each
          failure type).
        </li>
        <li>
          <strong>Judge is too strict.</strong> Average score never above 0.6, lots of 2s
          on perfectly good answers. Add explicit examples of what counts as a 5.
        </li>
      </ul>
      <p>
        Iterate on the rubric the same way you iterate on a prompt: version it, score the
        same N samples with v1 vs v2 of the rubric, eyeball the deltas.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/features/evals">Evals reference</a> for full config options,
        or <a href="/docs/features/prompt-ab">Prompt A/B</a> to compare two prompt
        versions on the same evaluator.
      </p>
    </div>
  )
}
