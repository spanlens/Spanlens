import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  alternates: { canonical: '/docs/features/evals' },
  title: 'Evals · Spanlens Docs',
  description:
    'LLM-as-judge evaluation, automatically score production responses on a 0..1 scale and quantify quality per prompt version.',
}

export default function EvalsDocs() {
  return (
    <div>
      <h1>Evals</h1>
      <p className="lead">
        Automatically score production response quality using an LLM-as-judge. Cost and latency
        are already measured, Evals adds quality to the picture so you can answer{' '}
        <em>did this prompt actually get better?</em>
      </p>

      <h2>The problem it solves</h2>
      <p>
        What Spanlens already measures: cost, latency, error rate.{' '}
        <strong>What it couldn&apos;t measure:</strong> whether the response is actually good.
      </p>
      <p>
        Even if v1 is faster and cheaper than v2, that comparison is meaningless if the response
        quality degraded. Evals is the infrastructure for assigning a 0..1 score to response
        content.
      </p>

      <h2>How it works</h2>

      <h3>Quick-start with a template</h3>
      <p>
        Visit <a href="/evals">/evals</a> on a fresh workspace and the empty state shows ten
        built-in evaluator templates grouped into three categories. Click <em>Use template</em>{' '}
        to pre-fill the New evaluator dialog with a curated criterion and a recommended judge
        model. You only need to pick which prompt the evaluator targets.
      </p>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Templates</th>
            <th>Default judge</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Quality</strong> (5)</td>
            <td>
              Response quality · Readability · Completeness · Persona match · Conciseness
            </td>
            <td><code>gpt-4o-mini</code></td>
          </tr>
          <tr>
            <td><strong>Safety</strong> (4)</td>
            <td>
              No PII leak · Toxicity · Hallucination · Prompt injection
            </td>
            <td><code>gpt-4o-mini</code> (Hallucination uses{' '}
              <code>claude-3-5-sonnet</code> for reasoning depth)</td>
          </tr>
          <tr>
            <td><strong>Cost</strong> (1)</td>
            <td>Cost vs quality (could a cheaper model have produced this answer?)</td>
            <td><code>claude-3-5-sonnet</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Templates are stored in <code>evaluator_templates</code> on the server, not hard-coded
        in the dashboard, so new templates can ship without a frontend deploy. The catalogue
        is global (every workspace sees the same suggestions) and read-only from the dashboard;
        every field on a template (criterion, judge provider/model, score range) is still
        editable in the New evaluator dialog after you load it.
      </p>

      <h3>Define an evaluator</h3>
      <p>An evaluator is a reusable definition of <em>how to score responses</em>.</p>
      <ul>
        <li><code>prompt_name</code>, which prompt this evaluator targets</li>
        <li><code>name</code>, e.g. &quot;Helpfulness check&quot;</li>
        <li>
          <code>type</code>, one of <code>llm_judge</code>, <code>regex</code>,{' '}
          <code>json_schema</code>, <code>exact_match</code>, <code>contains</code>, or{' '}
          <code>embedding</code>. The <code>regex</code> type checks the response body
          against a configured pattern and scores 1 on match. The <code>json_schema</code>{' '}
          type validates the response body against a JSON Schema document via Ajv and
          scores 1 on valid. <code>exact_match</code> (config <code>value</code>, optional{' '}
          <code>caseSensitive</code> / <code>trim</code>) scores 1 when the response
          equals the value; <code>contains</code> (config <code>substring</code>,
          optional <code>caseSensitive</code>) scores 1 when the substring is present.
          The four deterministic types are free of LLM cost. <code>embedding</code>{' '}
          (config <code>provider</code> / <code>model</code>, optional{' '}
          <code>reference_text</code> / <code>threshold</code>) scores the cosine
          similarity (0–1) of the response vs a reference answer — the reference is the
          dataset item&apos;s <code>expected_output</code> when present, otherwise{' '}
          <code>reference_text</code>; it calls an embeddings API on your provider key.
        </li>
        <li>
          <code>config</code>:
          <ul>
            <li><code>criterion</code>, scoring criterion sentence</li>
            <li>
              <code>judge_provider</code>, <code>openai</code>, <code>anthropic</code>, or{' '}
              <code>gemini</code>. Gemini uses <code>responseMimeType: application/json</code> with{' '}
              <code>responseSchema</code> for strict JSON output (matches OpenAI&apos;s{' '}
              <code>response_format: json_object</code> strictness).
            </li>
            <li>
              <code>judge_model</code>, any model in <code>model_prices</code> for that provider.
              The Evals UI picker reads from <code>/api/v1/models</code> so newly seeded models
              appear automatically.
            </li>
            <li><code>scale_min</code>, <code>scale_max</code>, score range (normalized to 0..1 on save)</li>
          </ul>
        </li>
      </ul>

      <h3>Run flow</h3>
      <ol>
        <li>Go to <a href="/evals">/evals</a> and click <strong>New evaluator</strong> to define the criterion.</li>
        <li>Click <strong>Run</strong> on an evaluator and select version, time window, and sample size.</li>
        <li>
          The server samples N responses for the given <code>prompt_version_id</code> from the{' '}
          <code>requests</code> table and asks the judge LLM to score each one (using your
          provider key).
        </li>
        <li>Per-sample scores are written to <code>eval_results</code> and aggregated into <code>eval_runs.avg_score</code>.</li>
        <li>The UI shows the score distribution and the 5 lowest-scoring samples as drilldowns.</li>
      </ol>

      <h3>Where samples come from</h3>
      <p>
        Unlike other evaluation tools, <strong>you don&apos;t need to build a separate dataset.</strong>{' '}
        Spanlens already logs every call, so it samples automatically from{' '}
        <em>production responses that used the given prompt version</em>.
      </p>
      <p>
        To use a <strong>Dataset</strong> as the sample source instead, see the{' '}
        <a href="/docs/features/datasets">Datasets</a> page. In dataset mode the runner does
        two things back to back:
      </p>
      <ol>
        <li>
          For each item, run the chosen prompt version against its <code>input</code> using{' '}
          <code>runProvider</code> + <code>runModel</code> (an active provider key of that
          provider must exist on the workspace). This produces a fresh response.
        </li>
        <li>Send the fresh response to the judge, which scores it against the criterion.</li>
      </ol>
      <p>
        That means dataset mode measures how the prompt actually performs on the curated inputs,
        not how friendly the static <code>expected_output</code> text is. The{' '}
        <code>expected_output</code> field is reference only in this release; a later release may
        feed it to the judge as a target for similarity checks.
      </p>
      <p>
        On the Eval Run dialog, switching the Sample source toggle to <strong>Dataset</strong>{' '}
        exposes a <strong>Plus Upload</strong> button next to the dataset picker. Picking a JSON
        or CSV file creates a fresh dataset with an auto generated name (for example{' '}
        <code>upload-2026-05-22-2245</code>), bulk inserts every parsed item, and pre selects it.
        Rename or delete the dataset from <a href="/datasets">/datasets</a> later.
      </p>

      <h2>How Evals differs from A/B</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>A/B (inside Prompts tab)</th>
              <th>Evals (this tab)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>When</td>
              <td>Live production traffic routing</td>
              <td>Offline scoring</td>
            </tr>
            <tr>
              <td>Measures</td>
              <td>Which version gets more traffic / fewer failures</td>
              <td>Response quality score</td>
            </tr>
            <tr>
              <td>Time to result</td>
              <td>Days (waiting for statistical significance)</td>
              <td>Minutes (50 samples ≈ 1–2 min)</td>
            </tr>
            <tr>
              <td>User impact</td>
              <td>Real users see the variation</td>
              <td>None</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The two tools are complementary. Use Evals to pre-validate whether a version is worth an
        A/B test, then use A/B to confirm in production.
      </p>

      <h2>Quality column in the Calls tab</h2>
      <p>
        The <strong>Quality</strong> column in Prompts → a specific prompt → Calls sub-tab shows
        the average <code>eval_results</code> score from evaluators run on this page. Versions that
        have never been evaluated show <code>,</code>.
      </p>
      <p>Color thresholds:</p>
      <ul>
        <li><strong>≥70</strong>, good (green)</li>
        <li><strong>40–69</strong>, warn (yellow)</li>
        <li><strong>&lt;40</strong>, bad (red)</li>
      </ul>

      <h2>LLM judge reliability</h2>
      <p>
        A judge score is only meaningful if it correlates with human judgment. If a team member
        scores responses manually via <a href="/docs/features/annotation">Annotation</a>, the
        Evals page shows a <strong>judge-human agreement card</strong> at the top of the run
        summary with the right statistic for the evaluator type.
      </p>
      <p>
        For numeric scores (judge returns a 0..1 or 1..5 scale) Spanlens computes{' '}
        <strong>Pearson r</strong>. For categorical labels (PASS / FAIL, A / B / C) it computes{' '}
        <strong>Cohen&apos;s kappa</strong> instead, which accounts for chance agreement and is
        the right measure when r would treat label distance as numeric. Both surface the same
        traffic-light bands so you can read them the same way.
      </p>
      <ul>
        <li><strong>r ≥ 0.7</strong> or <strong>κ ≥ 0.6</strong>, Strong (judge can be trusted)</li>
        <li><strong>0.4 ≤ r &lt; 0.7</strong> or <strong>0.4 ≤ κ &lt; 0.6</strong>, Moderate</li>
        <li><strong>r &lt; 0.4</strong> or <strong>κ &lt; 0.4</strong>, Revisit the criterion</li>
      </ul>

      <h2>Judge result caching</h2>
      <p>
        Re-running an evaluator on the same prompt + sample set is common during prompt tuning,
        and most of those re-runs ask the judge the exact same question twice. Spanlens caches
        judge verdicts keyed by{' '}
        <code>(evaluator_config_hash, response_hash)</code>, so identical (evaluator settings,
        model output) pairs reuse the prior verdict instead of paying for another LLM call.
      </p>
      <ul>
        <li>Cache hits skip the judge API call entirely. Latency drops, cost goes to zero on the hit.</li>
        <li>
          Editing the rubric, anchors, judge model, temperature, or prompt template changes the
          config hash and invalidates the cache for that evaluator. New verdicts are computed
          and stored.
        </li>
        <li>
          Every run reports a <code>cache_hits</code> counter so you can see how much was reused
          vs. paid for. Entries are pruned daily via <code>/cron/prune-judge-cache</code> after
          30 days of no-hit.
        </li>
      </ul>

      <h2>Prompt caching</h2>
      <p>
        Within a single run every sample is scored against the same criterion, rubric, and
        calibration anchors. Spanlens sends that static block as a cached prefix and the per-sample
        response as the only varying part, so the judge instructions are charged at full price once
        and reused at the reduced cache rate for the rest of the run.
      </p>
      <ul>
        <li>
          Anthropic judges use an ephemeral <code>cache_control</code> prefix (cache reads bill at
          roughly one tenth of the input price). The bigger the rubric and anchor set, the larger
          the saving.
        </li>
        <li>
          OpenAI and Gemini judges get the same benefit automatically once the static prefix is
          large enough, because the instructions are sent as a stable system prefix.
        </li>
        <li>
          Reported eval cost already reflects the cached and full-price token split, so the number
          you see is what your provider actually billed.
        </li>
      </ul>

      <h2>Cost</h2>
      <p>
        Judge calls are <strong>billed to your provider key</strong> (Spanlens does not cover
        them). Approximate cost with gpt-4o-mini: ~<code>$0.0005</code> per evaluation.
        50 samples ≈ <code>$0.025</code>.
      </p>
      <p>
        Pick the judge model to match the job. Pass/fail (<code>BOOLEAN</code>) and classification
        (<code>CATEGORICAL</code>) checks usually score just as well on a small, fast model like
        Haiku or gpt-4o-mini, which costs a fraction of a frontier model. Reserve the larger judges
        for nuanced 0–1 scoring where the extra reasoning earns its price.
      </p>
      <p>Guardrails:</p>
      <ul>
        <li><code>sample_size</code> DB CHECK constraint: 1..1000</li>
        <li>Estimated cost card shown in the Run dialog before starting</li>
      </ul>

      <h2>API</h2>
      <table>
        <thead>
          <tr>
            <th>Method + Path</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>POST /api/v1/evaluators</code></td>
            <td>Create an evaluator</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/evaluators?promptName=...</code></td>
            <td>List evaluators</td>
          </tr>
          <tr>
            <td><code>DELETE /api/v1/evaluators/:id</code></td>
            <td>Soft archive</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/eval-runs</code></td>
            <td>Start a run (returns 202 immediately; runs in background)</td>
          </tr>
          <tr>
            <td><code>POST /api/v1/eval-runs/estimate</code></td>
            <td>Estimate cost before running</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/eval-runs/:id</code></td>
            <td>Status and aggregated scores (poll while pending/running)</td>
          </tr>
          <tr>
            <td><code>GET /api/v1/eval-runs/:id/results</code></td>
            <td>Per-sample scores and reasoning</td>
          </tr>
        </tbody>
      </table>

      <p>
        These endpoints accept either a dashboard session (Supabase JWT) or a
        full-access Spanlens API key (<code>sl_live_*</code>), so you can drive
        evals from CI as well as the dashboard. Read endpoints also accept a
        public key (<code>sl_live_pub_*</code>); the write endpoints (create
        evaluator, start a run) require a full key and reject a public key with{' '}
        <code>PUBLIC_KEY_WRITE_FORBIDDEN</code>, since a run spends your
        provider key.
      </p>

      <h2>Example, create and run an evaluator</h2>
      <CodeBlock language="bash">{`# 1. Define the evaluator
curl https://server.spanlens.io/api/v1/evaluators \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "promptName": "support_reply",
    "name": "Helpfulness check",
    "type": "llm_judge",
    "config": {
      "criterion": "Does the response helpfully and clearly answer the customer question?",
      "judge_provider": "openai",
      "judge_model": "gpt-4o-mini",
      "scale_min": 0,
      "scale_max": 1
    }
  }'

# 2. Score v2 with 50 samples from the last 7 days
curl https://server.spanlens.io/api/v1/eval-runs \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "evaluatorId": "<evaluator-id>",
    "promptVersionId": "<v2-id>",
    "source": "production",
    "sampleSize": 50,
    "sampleFrom": "2026-05-06T00:00:00Z"
  }'

# 2b. Dataset mode also accepts runProvider + runModel.
#     The runner generates a response per item before scoring.
curl https://server.spanlens.io/api/v1/eval-runs \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "evaluatorId": "<evaluator-id>",
    "promptVersionId": "<v2-id>",
    "source": "dataset",
    "datasetId": "<dataset-id>",
    "sampleSize": 50,
    "runProvider": "openai",
    "runModel": "gpt-4o-mini"
  }'

# 3. Poll for results (status: pending → running → completed)
curl https://server.spanlens.io/api/v1/eval-runs/<run-id> \\
  -H "Authorization: Bearer $SPANLENS_JWT"`}</CodeBlock>

      <h2>Run from CI (prompt CI)</h2>
      <p>
        Gate a prompt change on its eval score. The SDK&apos;s{' '}
        <code>client.evals.run()</code> triggers a run with a full{' '}
        <code>sl_live_*</code> key, polls until it finishes, and returns the
        scored run so the job can fail the build when quality regresses. Unlike
        tracing (fire-and-forget), this call blocks and throws on failure.
      </p>
      <CodeBlock language="typescript">{`import { SpanlensClient } from '@spanlens/sdk'

// Use a full-access key (sl_live_*), not a public key.
const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

const run = await client.evals.run({
  evaluatorId: process.env.EVALUATOR_ID!,
  promptVersionId: process.env.PROMPT_VERSION_ID!,
  sampleSize: 50,
})

console.log(\`scored \${run.scored_count}/\${run.attempted_count}, avg \${run.avg_score}\`)

// Quality gate: fail the build if the average drops below the bar.
if (run.status !== 'completed' || (run.avg_score ?? 0) < 0.8) {
  console.error('Eval gate failed')
  process.exit(1)
}`}</CodeBlock>
      <p>
        Pass <code>{`{ wait: false }`}</code> to return immediately after the run
        is queued, or tune <code>pollIntervalMs</code> /{' '}
        <code>timeoutMs</code>. Use <code>client.evals.getResults(run.id)</code>{' '}
        to read the lowest-scoring samples for a CI log.
      </p>

      <h2>Confidence intervals</h2>
      <p>
        A score is only as trustworthy as its sample size: <code>0.82</code> from
        8 samples and <code>0.82</code> from 200 are not the same evidence, and
        &ldquo;version B scored 0.84 vs A&apos;s 0.81&rdquo; can be noise. Each
        completed run stores <code>score_stddev</code> (the sample standard
        deviation of the scores behind <code>avg_score</code>), and the dashboard
        renders a 95% confidence interval (<code>avg ± 1.96·σ/√n</code>) next to
        the average. It is populated for numeric and pass-rate (boolean)
        evaluators; categorical and text types have no mean, so it stays empty.
      </p>
      <p>
        In CI, gate on the interval instead of the point estimate so the build
        fails only on a <em>meaningful</em> regression, not sampling jitter:
      </p>
      <CodeBlock language="typescript">{`import { SpanlensClient, scoreConfidenceInterval } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const run = await client.evals.run({
  evaluatorId: process.env.EVALUATOR_ID!,
  promptVersionId: process.env.PROMPT_VERSION_ID!,
  sampleSize: 100,
})

const ci = scoreConfidenceInterval(run) // { mean, margin, low, high } | null
const GATE = 0.8

// Fail only when even the optimistic bound is below the bar — a wide
// interval (small / noisy sample) is told to collect more data instead.
if (run.status !== 'completed' || (ci?.high ?? run.avg_score ?? 0) < GATE) {
  console.error(\`gate failed: \${ci?.mean.toFixed(2)} ±\${ci?.margin.toFixed(2)}\`)
  process.exit(1)
}`}</CodeBlock>

      <h2>Tuning the judge: rubric &amp; calibration anchors</h2>
      <p>
        A bare criterion leaves the judge to invent its own scale, so scores
        drift run to run. Two optional fields on an LLM-judge evaluator make
        scoring consistent (set them under <em>Advanced</em> when creating the
        evaluator, or pass them in <code>config</code> to{' '}
        <code>POST /api/v1/evaluators</code>):
      </p>
      <ul>
        <li>
          <strong><code>rubric</code></strong> — free-form guidance injected into
          the prompt, e.g. <code>1.0 = fully correct and complete · 0.5 =
          partially correct · 0 = wrong</code>. Applies to every score type.
        </li>
        <li>
          <strong><code>anchors</code></strong> — up to 10 few-shot calibration
          examples, each an example <code>response</code> paired with the{' '}
          <code>score</code> it should get (and an optional{' '}
          <code>reasoning</code>). The judge anchors its scale to these. Numeric
          judges only.
        </li>
      </ul>
      <CodeBlock language="json">{`// POST /api/v1/evaluators  (config excerpt)
{
  "criterion": "Is the answer factually correct and complete?",
  "judge_provider": "openai",
  "judge_model": "gpt-4o-mini",
  "scale_min": 0,
  "scale_max": 1,
  "rubric": "1.0 = correct and complete · 0.5 = correct but missing detail · 0 = wrong",
  "anchors": [
    { "response": "Paris is the capital of France.", "score": 1, "reasoning": "correct and complete" },
    { "response": "I think it's somewhere in Europe.", "score": 0.3, "reasoning": "vague, no answer" }
  ]
}`}</CodeBlock>
      <p>
        Long responses are truncated to a character cap before judging, but{' '}
        <strong>middle-out</strong>: the start and the end are both kept (the
        actual answer often lives in the conclusion) with the middle elided.
      </p>

      <h2>Pairwise comparison (A vs B)</h2>
      <p>
        Absolute scores drift, and a 0.84-vs-0.81 gap is often noise. A pairwise
        run instead shows the judge BOTH versions&apos; responses to the same
        input and asks which one wins. Relative judgments are far more
        consistent, so a win-rate is a more trustworthy signal than two separate
        averages. Pick <strong>Pairwise (A vs B)</strong> when running an
        evaluator, choose a baseline (A) and a candidate (B), and a dataset.
      </p>
      <ul>
        <li>Each item is run through both versions, then judged head-to-head.</li>
        <li>
          <strong>Position bias is counterbalanced</strong> — the judge favours
          whichever response it sees first, so Spanlens alternates the A/B
          presentation order across the sample and un-swaps the verdict.
        </li>
        <li>
          The run reports <strong>B&apos;s win-rate</strong> as{' '}
          <code>avg_score</code> (1 = B wins, 0 = A wins, 0.5 = tie) plus a{' '}
          <code>b_wins</code> / <code>a_wins</code> / <code>ties</code> tally,
          and the 95% confidence interval applies to the win-rate.
        </li>
      </ul>
      <CodeBlock language="typescript">{`import { SpanlensClient, scoreConfidenceInterval } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
const run = await client.evals.run({
  evaluatorId: process.env.EVALUATOR_ID!,
  mode: 'pairwise',
  promptVersionId: BASELINE_VERSION_ID,   // A
  promptVersionBId: CANDIDATE_VERSION_ID, // B
  source: 'dataset',
  datasetId: process.env.DATASET_ID!,
  runProvider: 'openai',
  runModel: 'gpt-4o-mini',
  sampleSize: 100,
})

const ci = scoreConfidenceInterval(run) // CI on B's win-rate
// Ship B only if it beats A with the interval clearing 50%.
if ((ci?.low ?? run.avg_score ?? 0) > 0.5) {
  console.log(\`B wins \${run.b_wins}/\${run.scored_count} — promote it\`)
}`}</CodeBlock>

      <h2>Agent trajectory evaluation</h2>
      <p>
        Every other evaluator scores a single response. A{' '}
        <strong>trajectory</strong> evaluator scores the whole agent trace, the
        ordered sequence of spans (LLM calls, tool calls, intermediate steps),
        against a criterion. It reuses the tracing data you already send, so you
        can judge <em>how</em> the agent worked, not just its final answer.
      </p>
      <ul>
        <li>
          A trajectory evaluator binds to a <strong>trace name</strong> (the name
          your SDK passes to <code>createTrace()</code>), not a prompt. Create it
          under <em>Type → Agent trajectory</em> and give it the trace name + a
          criterion.
        </li>
        <li>
          Running it samples the most recent N traces with that name, serializes
          each one&apos;s steps in execution order, and the judge scores the
          trajectory 0..1. The run reports the average + the same 95% confidence
          interval.
        </li>
        <li>
          From the SDK, a trajectory run needs only the evaluator id (no prompt
          version): <code>client.evals.run({`{ evaluatorId, sampleSize: 50 }`})</code>.
        </li>
      </ul>
      <p>
        Write criteria about the <em>process</em>: &ldquo;did the agent call the
        search tool before answering&rdquo;, &ldquo;were there redundant or
        failed tool calls&rdquo;, &ldquo;did it follow the required steps in
        order&rdquo;.
      </p>

      <h2>Reproducibility &amp; reliability options</h2>
      <ul>
        <li>
          <strong><code>sampleStrategy</code></strong> (production source):{' '}
          <code>recent</code> (default) scores the latest N requests;{' '}
          <code>random</code> draws a representative sample (<code>ORDER BY rand()</code>)
          without recency bias.
        </li>
        <li>
          <strong><code>generationTemperature</code></strong> (dataset source): the
          temperature used to generate each response before judging. Defaults to{' '}
          <code>0</code> so a re-run produces the same answers; raise it to sample
          variability on purpose.
        </li>
        <li>
          <strong>Golden-set scoring.</strong> Dataset items with an{' '}
          <code>expected_output</code> now have it injected into the judge prompt as a
          reference, so the judge compares the response against the expected answer
          instead of scoring on the criterion alone.
        </li>
        <li>
          <strong>Retries.</strong> Judge and generation calls retry transient failures
          (429 / 5xx / network) with exponential backoff. Concurrency and retry counts
          are tunable via <code>EVAL_JUDGE_CONCURRENCY</code>,{' '}
          <code>EVAL_GENERATION_CONCURRENCY</code>, and <code>EVAL_MAX_RETRIES</code>.
        </li>
      </ul>

      <h2>Auto-run on a new version (golden regression suite)</h2>
      <p>
        Turn an evaluator into a regression gate: enable <strong>Auto-run on each
        new version</strong> on the evaluator (or pass{' '}
        <code>autoRunOnVersion</code> + <code>autoRunDatasetId</code> /{' '}
        <code>autoRunProvider</code> / <code>autoRunModel</code> to{' '}
        <code>POST /api/v1/evaluators</code>). Whenever a new version of that
        evaluator&apos;s prompt is created, Spanlens automatically runs the
        evaluator against the chosen dataset and scores it — no manual trigger.
      </p>
      <p>
        It is a <strong>dataset</strong> run, not production: a brand-new version
        has no traffic yet, so the run generates responses for the golden dataset
        with the configured model and scores them. Pair it with an{' '}
        <code>eval_score</code> <a href="/docs/features/alerts">alert</a> to be
        notified when a version regresses, and with{' '}
        <code>expected_output</code> on the dataset items for golden-set scoring.
        Auto-runs spend your provider key, so they are opt-in per evaluator.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Six evaluator types ship today.</strong> <code>llm_judge</code> (model
          scores 0–1), <code>regex</code>, <code>json_schema</code>,{' '}
          <code>exact_match</code>, <code>contains</code> (the four deterministic types run
          with no LLM cost), and <code>embedding</code> (cosine similarity via your
          provider key). Custom-code (JS) evaluators are planned for a later release.
        </li>
        <li>
          <strong>One evaluator run at a time.</strong> Concurrent runs on the same evaluator
          are not supported.
        </li>
        <li>
          <strong>Rows with empty <code>response_body</code> are skipped.</strong> Roughly 28% of
          rows may be skipped due to streaming parser failures, old data, or error responses.
          The UI shows this as &quot;47/50 scored&quot;.
        </li>
        <li>
          <strong>The judge itself can be inaccurate.</strong> That&apos;s why Annotation exists ,
          use it to validate the judge&apos;s reliability before relying on the scores.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/datasets">Datasets</a> (test input sets),{' '}
        <a href="/docs/features/experiments">Experiments</a> (offline side-by-side comparison),{' '}
        <a href="/docs/features/annotation">Annotation</a> (human scoring),{' '}
        <a href="/evals">/evals</a> dashboard.
      </p>
    </div>
  )
}
