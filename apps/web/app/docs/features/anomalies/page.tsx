import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Anomalies · Spanlens Docs',
  description:
    '3-sigma statistical anomaly detection on latency and cost per (provider, model) bucket. No ML, no configuration.',
}

export default function AnomaliesDocs() {
  return (
    <div>
      <h1>Anomalies</h1>
      <p className="lead">
        Spanlens continuously watches your request stream for latency and cost spikes that fall
        outside normal variation. No thresholds to configure, no baselines to set — it uses
        textbook 3-sigma statistics against a rolling 7-day reference window, computed per
        <code>(provider, model)</code> bucket.
      </p>

      <h2>Why it matters</h2>
      <p>
        Alerts with hand-set thresholds are either too loud (&ldquo;fires every day at 9am when
        traffic ramps&rdquo;) or too quiet (&ldquo;threshold was set last October, now misses real
        problems&rdquo;). The root cause is the same: your workload&apos;s idea of &ldquo;normal&rdquo;
        changes, but static thresholds don&apos;t.
      </p>
      <p>
        Anomaly detection sidesteps this by letting <em>your own data</em> define normal. Every
        bucket learns its baseline from itself.
      </p>

      <h2>How it works</h2>

      <h3>The math (simple)</h3>
      <ol>
        <li>
          Pick an <strong>observation window</strong> (default: the last <code>1 hour</code>) and a{' '}
          <strong>reference window</strong> (default: the preceding <code>7 days</code>, excluding
          the observation window).
        </li>
        <li>
          Group requests in both windows by <code>(provider, model)</code>.
        </li>
        <li>
          For each bucket with <strong>≥ 30 reference samples</strong>, compute sample mean (μ) and
          sample standard deviation (σ) on latency and cost.
        </li>
        <li>
          Flag buckets where the observation-window mean sits <strong>3σ or more</strong> above
          baseline. (Configurable threshold per API call.)
        </li>
      </ol>
      <CodeBlock language="text">{`deviations = (currentValue - baselineMean) / baselineStdDev

if deviations >= sigmaThreshold:
  flag as anomaly`}</CodeBlock>
      <p>
        <strong>3σ</strong> corresponds to ~0.13% false-positive rate under a normal distribution —
        generous enough to catch real spikes without flooding your inbox.
      </p>

      <h3>Why per-bucket matters</h3>
      <p>
        gpt-4o and gpt-4o-mini have totally different latency profiles (by 5-10×), as do different
        Anthropic and Gemini models. Computing one global baseline would hide real anomalies. Each
        model learns its own normal.
      </p>

      <h3>Two signals tracked</h3>
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th>What it catches</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Latency</strong></td>
            <td>
              Provider slowdowns (OpenAI having a bad day), network issues, unusually long prompts
              in your workload, regional outages
            </td>
          </tr>
          <tr>
            <td><strong>Cost</strong></td>
            <td>
              Prompt bloat (retrieval returning too many docs), runaway completions, someone
              accidentally switching to a more expensive model in code
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Both are computed against their own baselines — no coupling.
      </p>

      <h3>On-demand, not scheduled</h3>
      <p>
        Detection runs when you open the dashboard or hit the API, using the current time as{' '}
        &ldquo;now.&rdquo; No background cron, no pre-computed snapshots — the query is cheap
        enough (single roll-up over recent rows) that on-demand is the simpler design. This also
        means the view is always fresh.
      </p>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        Visit <a href="/anomalies">/anomalies</a>. Flagged buckets show:
      </p>
      <ul>
        <li>provider + model</li>
        <li>Signal (latency / cost)</li>
        <li>Current value (last hour mean)</li>
        <li>Baseline mean ± stddev</li>
        <li>Deviations (how many σ above normal)</li>
        <li>Sample counts (both windows)</li>
      </ul>
      <p>
        No anomalies? The page tells you — that&apos;s the good state. Your infrastructure is
        behaving predictably.
      </p>

      <h3>API</h3>
      <CodeBlock language="bash">{`GET /api/v1/anomalies?observationHours=1&referenceHours=168&sigma=3

# → array of flagged buckets:
# [
#   {
#     "provider": "openai",
#     "model": "gpt-4o",
#     "kind": "latency",
#     "currentValue": 8200,        // ms
#     "baselineMean": 1100,
#     "baselineStdDev": 180,
#     "deviations": 39.4,
#     "sampleCount": 42,
#     "referenceCount": 18420
#   }
# ]`}</CodeBlock>

      <h3>Tuning</h3>
      <p>Query parameters let you adjust sensitivity:</p>
      <table>
        <thead>
          <tr><th>Param</th><th>Default</th><th>When to change</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>observationHours</code></td>
            <td>1</td>
            <td>Bigger (6, 24) if you have low traffic — avoids small-sample noise</td>
          </tr>
          <tr>
            <td><code>referenceHours</code></td>
            <td>168 (7d)</td>
            <td>Shorter if your workload changed recently and old data is unrepresentative</td>
          </tr>
          <tr>
            <td><code>sigma</code></td>
            <td>3</td>
            <td>Lower to 2 for more sensitive detection (more false positives); higher for quieter</td>
          </tr>
          <tr>
            <td><code>minSamples</code></td>
            <td>30</td>
            <td>Don&apos;t usually touch — below this, stats are meaningless</td>
          </tr>
        </tbody>
      </table>

      <h2>Design choices</h2>
      <ul>
        <li>
          <strong>Sample stddev (n−1 denominator).</strong> Bessel&apos;s correction — unbiased
          estimator for a finite sample.
        </li>
        <li>
          <strong>No seasonal decomposition.</strong> A 7-day rolling baseline already captures
          weekly rhythm implicitly. More sophisticated (STL, Prophet, LSTM) models are overkill
          at current scale and harder to explain.
        </li>
        <li>
          <strong>One-sided detection.</strong> Only &ldquo;spike above baseline&rdquo; triggers —
          drops in latency or cost are good news, not incidents.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No in-app alert routing yet.</strong> You see anomalies in the dashboard, but
          they don&apos;t auto-trigger Slack/email. If you want push notifications, combine with{' '}
          <a href="/docs/features/alerts">Alerts</a> using threshold rules.
        </li>
        <li>
          <strong>Latency / cost detection uses success-only rows.</strong> Failed requests
          usually return fast and would distort the latency baseline; we filter them out for
          those signals. Error-rate detection includes ALL rows since that&apos;s the point.
        </li>
        <li>
          <strong>History is daily-snapshot, not real-time.</strong> The 30-day history view is
          populated by a cron job that runs once a day at 04:00 UTC. New anomalies appear in
          the &ldquo;Right now&rdquo; tab immediately but take up to 24 hours to land in
          history.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/alerts">Alerts</a> (threshold + notification), <a href="/docs/features/cost-tracking">Cost tracking</a>,{' '}
        <a href="/anomalies">/anomalies</a> dashboard.
      </p>
    </div>
  )
}
