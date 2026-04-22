import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Security (PII + prompt injection) · Spanlens Docs',
  description:
    'Automatic PII detection (SSN, credit card, email, phone, passport) and prompt-injection pattern scanning on every LLM request.',
}

export default function SecurityDocs() {
  return (
    <div>
      <h1>Security scan</h1>
      <p className="lead">
        Every LLM request body passes through Spanlens&apos; scan pipeline before it&apos;s logged.
        Two classes of concern are flagged automatically: <strong>PII leaks</strong> (users pasting
        social security numbers into a chatbot) and <strong>prompt injection</strong> (users trying
        to override your system prompt). Flagged requests show up in{' '}
        <a href="/security">/security</a> with masked samples and rule names.
      </p>

      <h2>Why it matters</h2>
      <p>
        PII in LLM calls is the #1 thing enterprise security teams ask about. If your chatbot
        receives a user&apos;s credit card number and that request body lands in OpenAI&apos;s
        training data (or your logs, or your support ticket queue), you have a GDPR/PCI incident
        on your hands. Catching it at the proxy layer — before it hits the provider — is the
        cheapest mitigation point.
      </p>
      <p>
        Prompt injection is the other side: malicious users trying to hijack your assistant with{' '}
        <em>&ldquo;ignore previous instructions and...&rdquo;</em>. Spanlens can&apos;t stop the
        attack, but it can surface patterns so you know which traffic source needs hardening.
      </p>

      <h2>How it works</h2>

      <h3>PII rules (6 patterns)</h3>
      <p>
        Regex-based, deliberately conservative (structural shape rather than keyword match) to
        minimize false positives on normal prose:
      </p>
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>Pattern</th>
            <th>Example match</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>ssn-kr</code></td>
            <td>Korean resident registration number (6-7 digits)</td>
            <td><code>900101-1234567</code></td>
          </tr>
          <tr>
            <td><code>ssn-us</code></td>
            <td>US SSN (3-2-4)</td>
            <td><code>123-45-6789</code></td>
          </tr>
          <tr>
            <td><code>credit-card</code></td>
            <td>13–19 digit card number (Luhn-passing)</td>
            <td><code>4532 0151 1283 0366</code></td>
          </tr>
          <tr>
            <td><code>email</code></td>
            <td>Email addresses</td>
            <td><code>jane@example.com</code></td>
          </tr>
          <tr>
            <td><code>phone</code></td>
            <td>E.164 + common international formats</td>
            <td><code>+1 (555) 123-4567</code></td>
          </tr>
          <tr>
            <td><code>passport</code></td>
            <td>Generic letter+digit passport (6–9 chars)</td>
            <td><code>M12345678</code></td>
          </tr>
        </tbody>
      </table>

      <h3>Prompt injection rules (5 patterns)</h3>
      <p>
        Well-known social-engineering phrases used to override system prompts. Case-insensitive,
        word-boundary matches only.
      </p>
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>What it catches</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>ignore-previous</code></td>
            <td>&ldquo;ignore/disregard/forget (all) previous/prior/above instructions/prompts/rules&rdquo;</td>
          </tr>
          <tr>
            <td><code>reveal-system-prompt</code></td>
            <td>&ldquo;what/show/reveal/print your system/initial/hidden prompt&rdquo;</td>
          </tr>
          <tr>
            <td><code>role-override</code></td>
            <td>&ldquo;you are now / from now on / act as / pretend to be...&rdquo;</td>
          </tr>
          <tr>
            <td><code>developer-mode</code></td>
            <td>&ldquo;developer mode / debug mode / jailbreak / DAN / do anything now&rdquo;</td>
          </tr>
          <tr>
            <td><code>token-smuggle</code></td>
            <td>Control tokens pasted as text: <code>&lt;|system|&gt;</code>, <code>&lt;|im_start|&gt;</code>, etc.</td>
          </tr>
        </tbody>
      </table>

      <h3>What gets stored</h3>
      <p>
        The scan runs on the serialized request body inside <code>logRequestAsync()</code>. For every
        match, a compact flag is appended to <code>requests.flags</code> (JSONB):
      </p>
      <CodeBlock language="json">{`{
  "type": "pii",
  "pattern": "ssn-us",
  "sample": "12*****89"
}`}</CodeBlock>
      <p>
        The <code>sample</code> is a <strong>masked 6-character excerpt</strong> around the match —
        just enough for you to audit what was flagged without storing raw PII back into the
        database. The original match is never persisted in readable form.
      </p>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        <a href="/security">/security</a> has two panes:
      </p>
      <ul>
        <li>
          <strong>Summary</strong> — counts per rule over the selected window (24h / 7d / 30d)
        </li>
        <li>
          <strong>Flagged</strong> — paginated list of flagged requests with masked samples, direct
          link to the full <a href="/requests">/requests</a> row for context
        </li>
      </ul>

      <h3>API</h3>
      <CodeBlock language="bash">{`GET /api/v1/security/summary?sinceHours=168
# → { pii: { email: 42, "ssn-us": 3, ... }, injection: { "ignore-previous": 12, ... } }

GET /api/v1/security/flagged?limit=50&offset=0&type=pii
# → paginated list of flagged requests`}</CodeBlock>

      <h3>Zero setup</h3>
      <p>
        There&apos;s nothing to configure. The scan runs on every request that flows through the
        Spanlens proxy. No CPU budget to tune, no rules to enable, no accuracy knobs.
      </p>

      <h2>What this is <em>not</em></h2>
      <p>
        Honest disclaimer: this is a <strong>detection</strong> layer, not a{' '}
        <strong>prevention</strong> layer.
      </p>
      <ul>
        <li>
          Flagged requests still reach the LLM provider. Spanlens doesn&apos;t block them — it
          reports them. Blocking would require a latency tradeoff and user-configurable policy,
          both of which we want to do carefully rather than ship half-baked.
        </li>
        <li>
          Regex is not ML. A sufficiently motivated attacker can always rephrase{' '}
          <em>&ldquo;ignore previous instructions&rdquo;</em> in a way that slips through. What
          we catch is the long tail of <strong>accidentally bad inputs</strong> and{' '}
          <strong>low-effort attacks</strong> — which covers 90%+ of real incidents.
        </li>
        <li>
          No hashing or tokenization is applied pre-storage. If your threat model requires
          encrypted request bodies at rest, self-host with additional disk encryption.
        </li>
      </ul>

      <h2>Limitations & roadmap</h2>
      <ul>
        <li>
          <strong>No custom rules.</strong> Rule set is hard-coded today. Custom regex + custom
          webhook alerts planned post-launch.
        </li>
        <li>
          <strong>No blocking mode.</strong> Currently detect-only. Policy engine to{' '}
          <code>block</code> / <code>rewrite</code> / <code>alert</code> on match is on the roadmap.
        </li>
        <li>
          <strong>English + Korean optimized.</strong> Patterns work on other languages but PII
          shapes (SSN-like structures in other countries) aren&apos;t yet covered. PRs welcome.
        </li>
        <li>
          <strong>No LLM-based secondary check.</strong> For high-stakes workloads you&apos;ll want
          a classifier on top. Integrations with Llama Guard / Prompt Guard are under consideration.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/anomalies">Anomalies</a> (statistical spike detection),{' '}
        <a href="/security">/security</a> dashboard. Source: <code>apps/server/src/lib/security-scan.ts</code>.
      </p>
    </div>
  )
}
