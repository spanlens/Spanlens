import { CodeBlock } from '../../_components/code-block'

export const metadata = {
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
          <code>type</code>, one of <code>llm_judge</code>, <code>regex</code>, or{' '}
          <code>json_schema</code>. The <code>regex</code> type checks the response body
          against a configured pattern and scores 1 on match (or 0 if you flag
          {' '}<code>must_not_match</code>). The <code>json_schema</code> type validates the
          response body against a JSON Schema document via Ajv and scores 1 on valid.
          Both code evaluators are free of LLM cost since no judge model is called.
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
        scores responses manually via <a href="/docs/features/annotation">Annotation</a>, a{' '}
        <strong>Pearson r correlation card</strong> appears automatically at the top of the Evals
        page.
      </p>
      <ul>
        <li><strong>r ≥ 0.7</strong>, Strong (judge can be trusted)</li>
        <li><strong>0.4 ≤ r &lt; 0.7</strong>, Moderate</li>
        <li><strong>r &lt; 0.4</strong>, Revisit the criterion</li>
      </ul>

      <h2>Cost</h2>
      <p>
        Judge calls are <strong>billed to your provider key</strong> (Spanlens does not cover
        them). Approximate cost with gpt-4o-mini: ~<code>$0.0005</code> per evaluation.
        50 samples ≈ <code>$0.025</code>.
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

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Three evaluator types ship today.</strong> <code>llm_judge</code> uses a
          model to score, <code>regex</code> checks the response against a pattern with
          configurable match expectation, and <code>json_schema</code> validates the
          response body against a JSON Schema document. Length and embedding similarity
          evaluators are planned for a later release.
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
