import { CodeBlock } from '../../_components/code-block'
import { AnomalyChart } from '../../_components/charts'

export const metadata = {
  alternates: { canonical: '/docs/features/anomalies' },
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
        to set, it uses textbook 3-sigma statistics against a rolling 7-day reference window,
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

      <AnomalyChart />

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
          For each bucket with <strong>≥ 10 reference samples</strong>, compute sample mean (μ) and
          sample standard deviation (σ) on the signal. Each anomaly is tagged with a{' '}
          <strong>confidence label</strong> based on how many samples the baseline is built from ,
          see <a href="#confidence">Confidence tiers</a> below.
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
        <strong>3σ</strong> corresponds to ~0.13% false-positive rate under a normal distribution ,
        generous enough to catch real spikes without flooding your inbox.
      </p>

      <h3 id="confidence">Confidence tiers</h3>
      <p>
        The baseline&apos;s reliability scales with the size of the reference window. New
        organisations (and rarely-used model buckets) need <em>some</em> directional signal in their
        first week, but a 12-sample standard deviation is much noisier than a 1,000-sample one. The
        confidence label tells you which regime you&apos;re in:
      </p>
      <table>
        <thead>
          <tr>
            <th>Confidence</th>
            <th>Reference samples</th>
            <th>How to read it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>low</strong></td>
            <td>10 – 29</td>
            <td>
              Directional only. The σ estimate is noisy, treat as an early warning, verify against
              the underlying requests before paging.
            </td>
          </tr>
          <tr>
            <td><strong>medium</strong></td>
            <td>30 – 99</td>
            <td>The classic 3σ threshold regime. False-positive rate is approximately as advertised.</td>
          </tr>
          <tr>
            <td><strong>high</strong></td>
            <td>100+</td>
            <td>
              Statistically robust. Use as the gate when wiring anomalies into a paging integration ,
              see <code>minSamples</code> below for the API parameter.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Below 10 reference samples the bucket is suppressed entirely (no detection, regardless of
        observation). Buckets ingested before this tier system was introduced are surfaced with
        confidence <code>null</code> for back-compat.
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
        Each signal is computed against its own baseline, no coupling. Latency and cost baselines
        use success-only rows (failed requests are fast and would distort the latency baseline).
        Error-rate detection intentionally includes all rows.
      </p>

      <h3>On-demand detection + daily history</h3>
      <p>
        The &ldquo;right now&rdquo; view runs on-demand when you open the dashboard or hit the API,
        always using the current time, so the view is always fresh. A background cron job also runs
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
        <li><strong>Confidence badge</strong>, <em>low</em> / <em>medium</em> / <em>high</em> based on reference-window size (see <a href="#confidence">Confidence tiers</a>)</li>
        <li><strong>Contributing factors</strong>, a <code>why ·</code> hint explaining the likely root cause</li>
        <li>Acknowledged state (if you&apos;ve silenced it)</li>
      </ul>
      <p>
        No anomalies? The page tells you, that&apos;s the good state. Your infrastructure is
        behaving predictably.
      </p>

      <h3>Understanding why, Contributing factors</h3>
      <p>
        When a bucket is flagged, Spanlens automatically fetches root-cause context so you don&apos;t
        have to dig through raw logs first. The <code>why ·</code> line appears beneath each anomaly
        entry, powered by a single additional DB scan per unique <code>(provider, model)</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th>What the hint shows</th>
            <th>How to interpret it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Latency</strong> or <strong>Cost</strong></td>
            <td>
              The token type that changed most between obs and reference windows ,
              e.g. <em>Prompt tokens ↑ 3,200 (was 890, +259%)</em>
            </td>
            <td>
              Prompt token spike → retrieval returning too many chunks, or context growth.
              Completion token spike → verbose outputs, runaway generation, or a model switch.
            </td>
          </tr>
          <tr>
            <td><strong>Error rate</strong></td>
            <td>
              Top HTTP status codes in the observation window, ranked by frequency ,
              e.g. <em>429: 45 req · 500: 8 req</em>
            </td>
            <td>
              429 → quota exhaustion or rate limiting.
              500/503 → provider outage.
              401/403 → auth misconfiguration or key rotation.
              400/422 → request format change or upstream API shift.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Contributing factors are fetched for the same time windows as the anomaly detection run.
        If the obs window has no data yet (e.g. you just deployed), the hint is omitted rather than
        showing misleading nulls.
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
  "projectId": "proj_xxx"   // optional, omit for org-wide ack
}

# Un-acknowledge
DELETE /api/v1/anomalies/ack?provider=openai&model=gpt-4o&kind=latency`}</CodeBlock>
      <p>
        Requires <strong>admin</strong> or <strong>editor</strong> role.
        Acks are scoped per <code>(org, project, provider, model, kind)</code>
       , acknowledging a bucket org-wide doesn&apos;t silence it inside a specific project, and
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
#     "confidence": "high",        // low | medium | high, reliability of the baseline
#     "acknowledgedAt": null,      // ISO string if acked, null otherwise
#     "factors": {                 // root-cause contributing factors
#       "obsPromptTokensMean": 3200,
#       "refPromptTokensMean": 890,
#       "obsCompletionTokensMean": 410,
#       "refCompletionTokensMean": 390,
#       "obsTotalTokensMean": 3610,
#       "refTotalTokensMean": 1280,
#       "obsStatusDistribution": [] // e.g. [{code:429,count:5},{code:500,count:2}]
#     }
#   }
# ]`}</CodeBlock>

      <p>Add <code>projectId=&lt;id&gt;</code> to scope detection to a single project.</p>

      <h3>30-day history</h3>
      <p>
        The history view shows past daily snapshots, useful for spotting recurring patterns
        (&ldquo;every Monday morning, latency spikes on gpt-4o&rdquo;).
      </p>
      <CodeBlock language="bash">{`GET /api/v1/anomalies/history?days=30

# → same shape as the live response, without acknowledgedAt.
# Results cover the last N days, excluding today
# (today is shown in the live view above).`}</CodeBlock>

      <h3>High-severity auto-notifications (≥5σ)</h3>
      <p>
        Anomalies that reach <strong>5σ or more</strong> are automatically delivered to your
        configured notification channels (Slack, email, Discord) by the daily snapshot job, no
        alert rule needed. Medium-severity anomalies (3–5σ) are dashboard-only; use{' '}
        <a href="/docs/features/alerts">threshold-based alert rules</a> for finer-grained routing.
      </p>
      <p>
        Configure channels in <a href="/settings?tab=notifications">Settings → Notifications</a>.
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
            <td>Bigger (6, 24) if you have low traffic, avoids small-sample noise</td>
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
            <td>,</td>
            <td>Scope detection to a single project instead of the whole org</td>
          </tr>
          <tr>
            <td><code>minSamples</code></td>
            <td>10</td>
            <td>
              Raise to <code>30</code> or <code>100</code> to suppress low/medium-confidence findings
              when wiring into paging or noisy channels.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Below <code>minSamples</code> the bucket is suppressed entirely (no row, no notification).
        The default <code>10</code> surfaces directional signal for new orgs in their first week;
        the dashboard tags each finding with a <a href="#confidence">confidence badge</a> so you can
        scan past low-confidence rows visually.
      </p>

      <h2>Design choices</h2>
      <ul>
        <li>
          <strong>Sample stddev (n−1 denominator).</strong> Bessel&apos;s correction, unbiased
          estimator for a finite sample.
        </li>
        <li>
          <strong>No seasonal decomposition.</strong> A 7-day rolling baseline already captures
          weekly rhythm implicitly. More sophisticated (STL, Prophet, LSTM) models are overkill
          at current scale and harder to explain.
        </li>
        <li>
          <strong>One-sided detection.</strong> Only &ldquo;spike above baseline&rdquo; triggers ,
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
          combination with fewer than <code>minSamples</code> requests (default 10) in the reference
          window produces no signal, not enough data for any baseline. Buckets between 10 and 29
          samples surface with <strong>low confidence</strong> so you can decide whether to act.
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
