import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Alerts · Spanlens Docs',
  description:
    'Threshold-based alert rules for budget, error rate, and p95 latency. Delivered via email (Resend), Slack, or Discord webhooks.',
}

export default function AlertsDocs() {
  return (
    <div>
      <h1>Alerts</h1>
      <p className="lead">
        Define simple threshold rules on your LLM traffic. When a rule fires, Spanlens sends a
        notification to your chosen channel — email, Slack, or Discord. Runs on a 15-minute cron,
        honors cooldowns, and logs every delivery so you can audit what fired when.
      </p>

      <h2>Why it matters</h2>
      <p>
        You don&apos;t want to manually check the dashboard every morning to see if last night&apos;s
        deploy caused a cost explosion. You want a Slack message at 3am if something&apos;s wrong,
        and quiet otherwise. Alerts give you that with three common rule types that cover 90% of
        what teams actually watch.
      </p>

      <h2>How it works</h2>

      <h3>Three rule types</h3>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>What it watches</th>
            <th>Example rule</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>budget</code></td>
            <td>Total spend over a rolling window</td>
            <td>&ldquo;Alert if cost &gt; $50 in the last 60 minutes&rdquo;</td>
          </tr>
          <tr>
            <td><code>error_rate</code></td>
            <td>Fraction of non-2xx responses</td>
            <td>&ldquo;Alert if error rate &gt; 5% in the last 30 minutes&rdquo;</td>
          </tr>
          <tr>
            <td><code>latency_p95</code></td>
            <td>95th percentile response time</td>
            <td>&ldquo;Alert if p95 &gt; 5000ms in the last 15 minutes&rdquo;</td>
          </tr>
        </tbody>
      </table>

      <h3>Evaluation loop</h3>
      <p>
        GitHub Actions fires <code>cron-evaluate-alerts</code> every 15 minutes. For each active
        rule, the evaluator:
      </p>
      <ol>
        <li>Computes the metric over the rule&apos;s window (from the <code>requests</code> table)</li>
        <li>Compares against the threshold</li>
        <li>
          If triggered AND the rule is outside its <code>cooldown_minutes</code> from the last fire,
          send notifications via <code>lib/notifiers.ts</code>
        </li>
        <li>Log each channel delivery into <code>alert_deliveries</code> (success or error)</li>
        <li>Update the rule&apos;s <code>last_triggered_at</code></li>
      </ol>
      <p>
        Cooldowns prevent alert storms. If you set <code>cooldown_minutes: 60</code>, a sustained
        error condition fires once, stays quiet for an hour, then fires again if still above
        threshold. Tune it to your noise tolerance.
      </p>

      <h3>Supported channels</h3>
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>How it sends</th>
            <th>Required config</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Email</strong></td>
            <td>Resend API</td>
            <td><code>RESEND_API_KEY</code> env + recipient email</td>
          </tr>
          <tr>
            <td><strong>Slack</strong></td>
            <td>Incoming webhook</td>
            <td>Webhook URL (channel-level or workspace-level)</td>
          </tr>
          <tr>
            <td><strong>Discord</strong></td>
            <td>Webhook</td>
            <td>Webhook URL</td>
          </tr>
        </tbody>
      </table>
      <p>
        Each channel renders a sensible default message: alert name, threshold, current value,
        window size, and (if set) a dashboard link.
      </p>

      <h2>Using it</h2>

      <h3>1. Add a notification channel</h3>
      <p>
        In <a href="/alerts">/alerts</a>, create a channel first. Channels are stored per-org and
        can be reused across multiple rules.
      </p>
      <CodeBlock language="bash">{`POST /api/v1/notification-channels
Content-Type: application/json

{
  "name": "#ops-alerts",
  "type": "slack",
  "config": {
    "webhookUrl": "https://hooks.slack.com/services/..."
  }
}`}</CodeBlock>

      <h3>2. Create an alert rule</h3>
      <CodeBlock language="bash">{`POST /api/v1/alerts
Content-Type: application/json

{
  "name": "Cost spike guard",
  "type": "budget",
  "threshold": 50,              // $50
  "windowMinutes": 60,
  "cooldownMinutes": 60,
  "channelIds": ["<channel-uuid>"]
}`}</CodeBlock>

      <h3>3. Verify it</h3>
      <p>
        The dashboard shows each rule&apos;s <code>last_triggered_at</code> + recent deliveries.
        You can also manually trigger evaluation via <code>POST /api/v1/alerts/evaluate</code> to
        confirm wiring before the next cron tick.
      </p>

      <h2>Architectural notes</h2>
      <ul>
        <li>
          <strong>Delivery is at-least-once.</strong> If Resend/Slack/Discord returns an error,
          we log it and retry on the next cron. At-most-once semantics would require per-channel
          idempotency keys — not worth the complexity for ops alerts.
        </li>
        <li>
          <strong>Cron runs on GitHub Actions, not Vercel Cron.</strong> Why: easier to audit,
          cheaper on Hobby/Pro plans, and decoupled from Vercel function timeouts.
        </li>
        <li>
          <strong>Rule evaluation is stateless.</strong> Each cron tick recomputes from the{' '}
          <code>requests</code> table. No separate aggregation store; Postgres handles the
          aggregations in a single query.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No PagerDuty / OpsGenie integration yet.</strong> Slack webhooks can be piped
          through those services if you need escalation — but we don&apos;t natively integrate.
        </li>
        <li>
          <strong>Fixed metric set.</strong> Only budget / error_rate / latency_p95 today. Custom
          SQL or anomaly-based rules are roadmap items.
        </li>
        <li>
          <strong>Quota-overage warning emails run on a separate cron</strong> (hourly). Org
          owners get automatic emails at 80% and 100% of the monthly request quota — no setup
          required. Content is context-aware: at 100% with overage billing enabled, the email
          tells the user that overage charges are now active (not that their requests are being
          rejected). Toggle in <a href="/settings">/settings</a>.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/anomalies">Anomalies</a> (unsupervised),{' '}
        <a href="/alerts">/alerts</a> dashboard. Cron:{' '}
        <code>.github/workflows/cron-evaluate-alerts.yml</code>.
      </p>
    </div>
  )
}
