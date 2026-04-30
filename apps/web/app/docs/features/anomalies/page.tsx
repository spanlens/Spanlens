import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Anomalies · Spanlens Docs',
  description:
    '3-sigma statistical anomaly detection on latency, cost, and error rate per (provider, model) bucket. No ML, no configuration.',
}

export default function AnomaliesDocs() {
  return (
    <div>
      <h1>Anomalies</h1>
      <p className="lead">
        Spanlens continuously watches your request stream for latency spikes, cost spikes, and error
        rate increases that fall outside normal variation. No thresholds to configure, no baselines
        to set — it uses textbook 3-sigma statistics against a rolling 7-day reference window,
        computed per <code>(provider, model)</code> bucket.
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
          sample standard deviation (σ) on the signal.
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

      <h3>Three signals tracked</h3>
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
          <tr>
            <td><strong>Error rate</strong></td>
            <td>
              Provider outages, quota exhaustion, auth misconfigurations, upstream changes that
              silently start returning 4xx/5xx. Measured as fraction of requests with
              status ≥ 400.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Each signal is computed against its own baseline — no coupling. Latency and cost baselines
        use success-only rows (failed requests are fast and would distort the latency baseline).
        Error-rate detection intentionally includes all rows.
      </p>

      <h3>On-demand detection + daily history</h3>
      <p>
        The &ldquo;right now&rdquo; view runs on-demand when you open the dashboard or hit the API,
        always using the current time — so the view is always fresh. A background cron job also runs
        once a day at 01:00 UTC to persist a snapshot into the 30-day history log.
      </p>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        Visit <a href="/anomalies">/anomalies</a>. Flagged buckets show:
      </p>
      <ul>
        <li>provider + model</li>
        <li>Signal (latency / cost / error rate)</li>
        <li>Current value (last hour mean)</li>
        <li>Baseline mean ± stddev</li>
        <li>Deviations (how many σ above normal)</li>
        <li>Sample counts (both windows)</li>
        <li>Acknowledged state (if you&apos;ve silenced it)</li>
      </ul>
      <p>
        No anomalies? The page tells you — that&apos;s the good state. Your infrastructure is
        behaving predictably.
      </p>

      <h3>Acknowledging an anomaly</h3>
      <p>
        If you&apos;ve investigated a flagged bucket and determined it&apos;s expected (a deliberate
        model switch, a batch job, a known provider incident), you can <strong>acknowledge</strong>{' '}
        it. Acknowledged anomalies are still shown but visually muted so you can focus on new ones.
      </p>
      <CodeBlock language="bash">{`# Acknowledge
POST /api/v1/anomalies/ack
Content-Type: application/json

{
  "provider": "openai",
  "model": "gpt-4o",
  "kind": "latency",
  "projectId": "proj_xxx"   // optional — omit for org-wide ack
}

# Un-acknowledge
DELETE /api/v1/anomalies/ack?provider=openai&model=gpt-4o&kind=latency`}</CodeBlock>
      <p>
        Requires <strong>admin</strong> or <strong>editor</strong> role.
        Acks are scoped per <code>(org, project, provider, model, kind)</code>
        — acknowledging a bucket org-wide doesn&apos;t silence it inside a specific project, and
        vice versa.
      </p>

      <h3>Live API</h3>
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
#     "referenceCount": 18420,
#     "acknowledgedAt": null       // ISO string if acked, null otherwise
#   }
# ]`}</CodeBlock>

      <p>Add <code>projectId=&lt;id&gt;</code> to scope detection to a single project.</p>

      <h3>30-day history</h3>
      <p>
        The history view shows past daily snapshots — useful for spotting recurring patterns
        (&ldquo;every Monday morning, latency spikes on gpt-4o&rdquo;).
      </p>
      <CodeBlock language="bash">{`GET /api/v1/anomalies/history?days=30

# → same shape as the live response, without acknowledgedAt.
# Results cover the last N days, excluding today
# (today is shown in the live view above).`}</CodeBlock>

      <h3>High-severity auto-notifications (≥5σ)</h3>
      <p>
        Anomalies that reach <strong>5σ or more</strong> are automatically delivered to your
        configured notification channels (Slack, email, Discord) by the daily snapshot job — no
        alert rule needed. Medium-severity anomalies (3–5σ) are dashboard-only; use{' '}
        <a href="/docs/features/alerts">threshold-based alert rules</a> for finer-grained routing.
      </p>
      <p>
        Configure channels in <a href="/settings/notifications">Settings → Notifications</a>.
      </p>

      <h3>Export</h3>
      <p>
        Download historical anomaly events as CSV or JSON for offline analysis:
      </p>
      <CodeBlock language="bash">{`GET /api/v1/exports/anomalies?format=csv&days=30

# format: csv (default) | json
# days: 1–365 (default 30)`}</CodeBlock>

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
            <td><code>projectId</code></td>
            <td>—</td>
            <td>Scope detection to a single project instead of the whole org</td>
          </tr>
        </tbody>
      </table>
      <p>
        The minimum reference sample count (30) is fixed and not adjustable — below that, the
        standard deviation estimate is too noisy to be meaningful.
      </p>

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
          <strong>History is daily-snapshot, not real-time.</strong> New anomalies appear in the
          live view immediately but take up to 24 hours to land in the 30-day history log (cron
          runs at 01:00 UTC).
        </li>
        <li>
          <strong>Sparse buckets are skipped.</strong> Any <code>(provider, model, kind)</code>{' '}
          combination with fewer than 30 requests in the reference window produces no signal — not
          enough data for a reliable baseline.
        </li>
        <li>
          <strong>No anomaly-level alert routing.</strong> You can&apos;t route &ldquo;only
          latency anomalies for gpt-4o&rdquo; to a specific channel. High-severity (≥5σ) goes to
          all active channels; for finer routing, create a threshold-based{' '}
          <a href="/docs/features/alerts">alert rule</a> instead.
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
