import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Evals · Spanlens Docs',
  description:
    'How Spanlens models evals: LLM-as-judge scoring, human annotation, judge-to-human correlation as a first-class metric, and drift detection across prompt versions.',
  alternates: { canonical: '/docs/concepts/evals' },
}

export default function EvalsConcept() {
  return (
    <div>
      <h1>Evals</h1>
      <p className="lead">
        Evals score LLM responses on a 0 to 1 scale per prompt version, so you can
        tell whether v8 is actually better than v7 instead of just cheaper. Spanlens
        supports LLM-as-judge automated scoring, human annotation, and the
        correlation between the two as a first-class drift signal.
      </p>

      <h2>The three score sources</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Entity</th>
            <th>Update cadence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>LLM-as-judge</td>
            <td>
              <code>evals</code>
            </td>
            <td>Async on ingest; caches by content hash so re-running is free.</td>
          </tr>
          <tr>
            <td>Human annotation</td>
            <td>
              <code>annotations</code>
            </td>
            <td>Manual via <a href="/annotation">/annotation</a>.</td>
          </tr>
          <tr>
            <td>Programmatic (custom)</td>
            <td>
              <code>evals</code> with <code>source=&apos;custom&apos;</code>
            </td>
            <td>Push via the SDK from your own scripts or CI.</td>
          </tr>
        </tbody>
      </table>

      <h2>LLM-as-judge in practice</h2>
      <p>
        The default judge is a frontier model (configurable per project) scoring on a
        rubric you write in plain English. Scores are stored with the judge model
        name and the exact rubric used, so when you change the rubric, old scores do
        not silently shift meaning. The judge result is cached by a hash of
        (response, rubric, judge_model), so re-running an eval on the same data is
        instant and free.
      </p>
      <CodeBlock language="ts">{`import { SpanlensClient } from '@spanlens/sdk'

const client = new SpanlensClient()

await client.evals.run({
  prompt_version_id: 'pv_xxx',
  rubric:
    'Score 1.0 if the response correctly cites the source document, 0.5 if cited but inaccurate, 0.0 otherwise.',
  judge_model: 'claude-3-5-sonnet',
  sample_size: 200, // pulls 200 recent responses for this prompt version
})`}</CodeBlock>

      <h2>Judge-to-human correlation</h2>
      <p>
        Spanlens computes the Pearson correlation between LLM judge scores and human
        annotation scores per prompt version. The number lives in the eval detail
        view next to the average score. When correlation drops below your threshold
        (default 0.7), Spanlens flags it as judge drift and suggests re-grounding the
        judge rubric against fresh human labels.
      </p>
      <p>
        This metric is the difference between &quot;our eval score is 0.85&quot; and
        &quot;our eval score is 0.85 and a human would agree 85% of the time.&quot;
        Without correlation, judge scores can drift with no signal that they have.
      </p>

      <h2>Experiments and the eval feedback loop</h2>
      <p>
        Evals integrate with{' '}
        <a href="/docs/features/experiments">experiments</a> so you can replay a
        fixed dataset across prompt versions and judge each output on the same
        rubric. The experiment table shows quality, cost, and latency side by side,
        which lets you make the &quot;cheaper but as good?&quot; decision on
        evidence rather than vibes.
      </p>

      <h2>Eval-driven anomaly detection</h2>
      <p>
        Anomalies (see <a href="/docs/features/anomalies">/docs/features/anomalies</a>)
        fire when eval scores deviate more than 3σ from the rolling 7-day baseline.
        A score collapse usually means a prompt regression, a model variant change,
        or a content drift in your input distribution. The anomaly contains
        contributing factors so you can jump straight to the prompt version or
        customer responsible.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <a href="/docs/features/evals">Evals feature page</a>, dashboard surface.
        </li>
        <li>
          <a href="/docs/features/experiments">Experiments</a>, replay datasets
          across prompt versions and models.
        </li>
        <li>
          <a href="/docs/features/annotation">Annotation</a>, build human-labeled
          golden sets from real traffic.
        </li>
        <li>
          <a href="/docs/concepts/prompt-management">Prompt management</a>, how
          versions relate to eval scores.
        </li>
      </ul>
    </div>
  )
}
