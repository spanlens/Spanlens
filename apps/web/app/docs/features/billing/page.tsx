import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Billing & quotas · Spanlens Docs',
  description:
    'How Spanlens charges you: plan quotas, overage billing, the hard cap, and what your invoice looks like.',
}

export default function BillingDocs() {
  return (
    <div>
      <h1>Billing &amp; quotas</h1>
      <p className="lead">
        Spanlens pricing is designed to be predictable. You pay a flat monthly fee for your plan,
        and if you go past your included request quota, you pay only for what you used — capped
        at a multiple of your plan so you can&apos;t get a surprise bill.
      </p>

      <h2>Plan quotas</h2>
      <p>Every plan has a fixed monthly request quota:</p>
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Monthly fee</th>
            <th>Included requests</th>
            <th>Log retention</th>
            <th>Projects</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Free</td>
            <td>$0</td>
            <td>10,000</td>
            <td>7 days</td>
            <td>1</td>
          </tr>
          <tr>
            <td>Starter</td>
            <td>$19</td>
            <td>100,000</td>
            <td>30 days</td>
            <td>5</td>
          </tr>
          <tr>
            <td>Team</td>
            <td>$49</td>
            <td>500,000</td>
            <td>90 days</td>
            <td>unlimited</td>
          </tr>
          <tr>
            <td>Enterprise</td>
            <td>custom</td>
            <td>unlimited</td>
            <td>1 year</td>
            <td>unlimited</td>
          </tr>
        </tbody>
      </table>
      <p>
        A <strong>request</strong> is one LLM call that flows through the{' '}
        <a href="/docs/features/requests">Spanlens proxy</a> — regardless of which provider
        (OpenAI, Anthropic, Gemini) or model. Streaming and non-streaming both count as one
        request each. Failed requests that reached our proxy also count (so a 500 from upstream
        still uses one).
      </p>
      <p>
        Counting is per UTC calendar month — your counter resets at 00:00 UTC on the 1st of
        every month. This is simpler than per-subscription-period billing and matches what the
        dashboard shows you.
      </p>

      <h2 id="quota-policy">What happens when you hit your quota</h2>
      <p>
        Spanlens uses a <strong>Pattern C</strong> quota policy: soft limit, authorized overage,
        hard cap. You stay in control.
      </p>

      <h3>Free plan — hard block at 10,000</h3>
      <p>
        The 10,001st request returns HTTP <code>429 Too Many Requests</code> with a JSON body:
      </p>
      <CodeBlock language="json">{`{
  "error": "Monthly request quota reached on the Free plan. Upgrade to continue.",
  "reason": "free_limit",
  "plan": "free",
  "used": 10000,
  "limit": 10000,
  "upgrade_url": "https://www.spanlens.io/billing"
}`}</CodeBlock>
      <p>Requests resume at the next UTC month rollover, or when you upgrade.</p>

      <h3>Paid plans — overage billing (default)</h3>
      <p>
        Starter and Team default to <em>allow overage</em>. When you pass your included quota,
        requests keep flowing and extra usage is billed on your next invoice. The response
        carries an <code>X-Overage-Active: true</code> header so your code can detect the state
        if it wants to.
      </p>
      <p>
        The dashboard shows a blue banner during overage with a running tally of how much extra
        will be billed.
      </p>

      <h3>Paid plans — with overage disabled</h3>
      <p>
        If you flip <strong>Allow overage charges</strong> off in{' '}
        <a href="/settings">/settings</a>, paid plans behave like Free — hard block at the
        quota, returning <code>429</code> with <code>reason: &quot;overage_disabled&quot;</code>.
        Choose this when you want cost certainty above all else.
      </p>

      <h3>Hard cap — safety ceiling</h3>
      <p>
        Even with overage enabled, we never let usage run unbounded. Your{' '}
        <strong>hard cap</strong> is:
      </p>
      <CodeBlock language="text">{`hard_cap = monthly_limit × overage_cap_multiplier
        = 100,000 × 5     (Starter, default)    = 500,000
        = 500,000 × 5     (Team, default)       = 2,500,000`}</CodeBlock>
      <p>
        Requests past the hard cap return <code>429</code> with{' '}
        <code>reason: &quot;hard_cap&quot;</code>. You can raise or lower the multiplier (1–100)
        in <a href="/settings">/settings</a> to match your risk tolerance — for example set it
        to <code>1</code> to never pay more than the base plan fee, or <code>10</code> to
        absorb a huge traffic spike.
      </p>

      <h2 id="overage-pricing">Overage pricing</h2>
      <p>
        Billed in <strong>1,000-request units</strong>. Any partial unit rounds up.
      </p>
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Overage rate</th>
            <th>Example: 135,000 requests on Starter</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Starter</td>
            <td>$0.10 per 1,000 requests</td>
            <td>
              35,000 over → ceil(35,000 / 1,000) = 35 units × $0.10 = <strong>$3.50</strong>{' '}
              on next invoice
            </td>
          </tr>
          <tr>
            <td>Team</td>
            <td>$0.08 per 1,000 requests</td>
            <td>
              100,000 over → 100 units × $0.08 = <strong>$8.00</strong> on next invoice
            </td>
          </tr>
          <tr>
            <td>Enterprise</td>
            <td>Negotiated</td>
            <td>Included or custom — contact sales</td>
          </tr>
        </tbody>
      </table>
      <p>
        Free plan has no overage rate — past 10K, it&apos;s a hard block. Upgrade to enable
        overage billing.
      </p>

      <h2 id="invoices">What your invoice looks like</h2>
      <p>
        Paddle generates one invoice per billing period. Overage from the prior period is
        bundled into the next invoice as an additional line item — you get <strong>one email
        per month</strong>, not one per charge:
      </p>
      <CodeBlock language="text">{`Invoice — May 1, 2026

  Spanlens Starter Subscription                     $19.00
  Starter - Overage unit (per 1,000 requests) × 35   $3.50
  ─────────────────────────────────────────────────────────
  Subtotal                                          $22.50
  Tax (automatically handled by Paddle)             $ 2.25
  ─────────────────────────────────────────────────────────
  Total                                             $24.75`}</CodeBlock>

      <h2 id="warnings">Warning emails</h2>
      <p>
        The organization owner receives automatic email warnings as usage grows:
      </p>
      <ul>
        <li>
          <strong>80%</strong> — heads-up that you&apos;re approaching the limit. Message varies
          based on whether overage is on (&ldquo;overage will absorb the overflow&rdquo;) or off
          (&ldquo;extra requests will 429&rdquo;).
        </li>
        <li>
          <strong>100%</strong> — with overage on: &ldquo;overage billing is now active, you&apos;ll
          be billed on the next invoice.&rdquo; With overage off: &ldquo;requests are being
          rejected.&rdquo;
        </li>
      </ul>
      <p>
        Each threshold fires at most once per calendar month per org — no spam. See{' '}
        <a href="/docs/features/alerts">Alerts</a> for the counting semantics.
      </p>

      <h2 id="faq">FAQ</h2>

      <h3>Can I change plans mid-month? Is it prorated?</h3>
      <p>
        Yes — Paddle handles plan changes with automatic proration. Upgrading mid-month gives
        you the new plan&apos;s higher quota immediately; the monthly fee difference is charged
        proportionally for the remainder of the period. Downgrading takes effect at the next
        period boundary.
      </p>

      <h3>What happens to overage if I downgrade?</h3>
      <p>
        Overage accrued on the old plan is billed on the final invoice at the old plan&apos;s
        rate. Requests on the new plan from that point forward use the new plan&apos;s quota
        and overage rate.
      </p>

      <h3>Can I cap my monthly bill at a specific dollar amount?</h3>
      <p>
        Yes, via the overage cap multiplier. Set it to <code>1</code> to never pay more than
        the base plan fee (overage disabled equivalent). Set it to <code>3</code> on Starter
        to cap at $19 + 300 × $0.10 = $49. Precise dollar limits will come in a future release.
      </p>

      <h3>Do I pay for retries / failed requests?</h3>
      <p>
        Yes — any request that reaches our proxy counts, regardless of the upstream response
        code. A 500 from OpenAI still uses one request. Rationale: the proxy did the work
        (auth, logging, forwarding, response buffering) and we have no way to distinguish
        &ldquo;legitimate retry&rdquo; from &ldquo;duplicate because you have a bug.&rdquo;
      </p>

      <h3>Do streaming requests count differently?</h3>
      <p>
        No — one stream = one request. Token cost is captured accurately via our stream parser
        (see <a href="/docs/features/cost-tracking">Cost tracking</a>), but the request counter
        increments by 1.
      </p>

      <h3>What if I self-host?</h3>
      <p>
        Self-hosted Spanlens has no billing — you pay your own infra costs. Plan quotas and
        overage logic only exist on the hosted service at{' '}
        <a href="https://www.spanlens.io">spanlens.io</a>. See{' '}
        <a href="/docs/self-host">self-hosting</a>.
      </p>

      <h3>Where&apos;s my invoice history?</h3>
      <p>
        Every invoice is emailed to your account email. You can also view + download from{' '}
        <a href="/billing">/billing</a> (powered by Paddle&apos;s customer portal).
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/settings">Overage settings</a>,{' '}
        <a href="/docs/features/cost-tracking">Per-request cost tracking</a>,{' '}
        <a href="/docs/features/alerts">Alerts &amp; quota emails</a>,{' '}
        <a href="/billing">/billing</a> dashboard.
      </p>
    </div>
  )
}
