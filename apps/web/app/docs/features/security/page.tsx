import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/features/security' },
  title: 'Security (PII + prompt injection) · Spanlens Docs',
  description:
    'Automatic PII detection and prompt-injection scanning on every LLM request and response, with optional blocking mode and real-time alert emails.',
}

export default function SecurityDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Security scan</h1>
      <p className="lead">
        Every LLM request and response body passes through Spanlens&apos; scan pipeline.
        Two classes of concern are flagged automatically: <strong>PII leaks</strong> (users pasting
        social security numbers into a chatbot) and <strong>prompt injection</strong> (users trying
        to override your system prompt). Flagged traffic shows up in{' '}
        <a href="/security">/security</a> with masked samples, and you can optionally{' '}
        <strong>block injections at the proxy</strong> or{' '}
        <strong>receive instant email alerts</strong>.
      </p>

      <h2>Why it matters</h2>
      <p>
        PII in LLM calls is the #1 thing enterprise security teams ask about. If your chatbot
        receives a user&apos;s credit card number and that request body lands in OpenAI&apos;s
        training data (or your logs, or your support ticket queue), you have a GDPR/PCI incident
        on your hands. Catching it at the proxy layer, before it hits the provider, is the
        cheapest mitigation point.
      </p>
      <p>
        Prompt injection is the other side: malicious users trying to hijack your assistant with{' '}
        <em>&ldquo;ignore previous instructions and...&rdquo;</em>. When blocking mode is on,
        Spanlens returns a 422 before the request ever reaches the LLM. When it&apos;s off, the
        flag is recorded so you can audit which traffic source needs hardening.
      </p>

      <h2>How it works</h2>

      <h3>PII rules (7 patterns)</h3>
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
            <td><code>iban</code></td>
            <td>IBAN, EU 27 + UK, CH, NO and 30+ countries. Compact and spaced forms. mod-97 validated.</td>
            <td><code>GB82WEST12345698765432</code></td>
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

      <h3>Prompt injection rules (8 patterns)</h3>
      <p>
        Well-known social-engineering phrases used to override system prompts. English rules use
        case-insensitive word-boundary matches; Korean rules use Unicode-aware substring matching.
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
          <tr>
            <td><code>ignore-previous-ko</code></td>
            <td>Korean equivalents of &ldquo;ignore/forget all previous instructions/commands/prompts&rdquo;</td>
          </tr>
          <tr>
            <td><code>reveal-system-ko</code></td>
            <td>Korean equivalents of &ldquo;tell/show me your system/initial/hidden prompt/instructions&rdquo;</td>
          </tr>
          <tr>
            <td><code>role-override-ko</code></td>
            <td>Korean equivalents of &ldquo;from now on you are ... / pretend to be / act as ...&rdquo;</td>
          </tr>
        </tbody>
      </table>

      <h3>What gets stored</h3>
      <p>
        The scan runs on both the request body and the LLM response body inside{' '}
        <code>logRequestAsync()</code>. For every match, a compact flag is stored in JSONB:
      </p>
      <CodeBlock language="json">{`{
  "type": "pii",
  "pattern": "ssn-us",
  "sample": "12*****89"
}`}</CodeBlock>
      <p>
        Request flags → <code>requests.flags</code>. Response flags → <code>requests.response_flags</code>.
        The <code>sample</code> is a <strong>masked 6-character excerpt</strong> around the match ,
        just enough for you to audit what was flagged without storing raw PII back into the
        database. The original match is never persisted in readable form.
      </p>

      <h2>Features</h2>

      <h3>Blocking mode (per-project)</h3>
      <p>
        When blocking is enabled for a project, any request that contains an{' '}
        <strong>injection-type</strong> flag is rejected at the proxy with a{' '}
        <code>422 Unprocessable Entity</code> before it ever reaches the LLM provider:
      </p>
      <CodeBlock language="json">{`{
  "error": "Request blocked by Spanlens security policy: prompt injection detected.",
  "code": "INJECTION_BLOCKED"
}`}</CodeBlock>
      <p>
        PII flags are <strong>never</strong> blocked, PII may be legitimate user data (e.g. a
        healthcare app). Only injection patterns trigger blocking. Toggle it in the{' '}
        <a href="/security">/security</a> dashboard under <em>Per-project blocking</em>.
      </p>

      <h3>Alert emails (org-wide)</h3>
      <p>
        Enable alert emails to receive an immediate notification whenever a request or response
        is flagged. The email is sent to the workspace owner and includes:
      </p>
      <ul>
        <li>Flag direction (Request / Response), type (pii / injection), pattern, and masked sample</li>
        <li>A link to the <a href="/security">/security</a> dashboard</li>
      </ul>
      <p>
        Alerts are <strong>rate-limited to once every 5 minutes per organization</strong> to
        prevent inbox flooding during high-volume attacks. Toggle in the Security dashboard under{' '}
        <em>Alert emails</em>.
      </p>

      <h3>Response scanning</h3>
      <p>
        Spanlens scans both directions: the request body (user input) and the LLM response body
        (model output). This catches cases where the model itself leaks PII it was given in
        context, for example, echoing a credit card number back in a summary. Response flags are
        stored separately in <code>requests.response_flags</code> and shown in the dashboard with
        a <em>↩</em> prefix to distinguish them from request flags.
      </p>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        <a href="/security">/security</a> has two panes plus a settings section:
      </p>
      <ul>
        <li>
          <strong>Settings</strong>, Alert email toggle (org-wide) + per-project blocking toggles
        </li>
        <li>
          <strong>Summary</strong>, Counts per rule over the selected window (24h / 7d / 30d)
        </li>
        <li>
          <strong>Flagged</strong>, Paginated list of flagged requests with masked samples and
          direction labels (request vs response), direct link to the full{' '}
          <a href="/requests">/requests</a> row for context
        </li>
      </ul>

      <h3>API</h3>
      <CodeBlock language="bash">{`# Flagged requests (paginated)
GET /api/v1/security/flagged?limit=50&offset=0

# Flag counts by type/pattern over a time window
GET /api/v1/security/summary?hours=24

# Org alert + per-project block settings
GET /api/v1/security/settings

# Toggle org-level alert emails
PATCH /api/v1/security/alert
{ "enabled": true }

# Toggle per-project injection blocking
PATCH /api/v1/security/projects/{projectId}/block
{ "enabled": true }`}</CodeBlock>

      <h2 id="stored-body-sanitization">Stored-body sanitization (defense in depth)</h2>
      <p>
        Separately from the request-time scan above, every body that lands in ClickHouse passes
        through a pattern-based key scrubber first. The goal is narrow: catch API keys that
        accidentally end up in prompts, tool output, or error messages, so a compromised
        Spanlens row never leaks a customer&apos;s upstream credentials.
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Prefix matched</th>
            <th>Replacement</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Spanlens</td>
            <td><code>sl_live_*</code></td>
            <td><code>sl_live_***</code></td>
          </tr>
          <tr>
            <td>Anthropic</td>
            <td><code>sk-ant-*</code></td>
            <td><code>sk-ant-***</code></td>
          </tr>
          <tr>
            <td>OpenAI project keys</td>
            <td><code>sk-proj-*</code></td>
            <td><code>sk-proj-***</code></td>
          </tr>
          <tr>
            <td>OpenAI (legacy)</td>
            <td><code>sk-*</code></td>
            <td><code>sk-***</code></td>
          </tr>
          <tr>
            <td>Google (Gemini)</td>
            <td><code>AIza*</code></td>
            <td><code>AIza***</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Each pattern requires at least 12 characters after the prefix so short identifiers that
        share the prefix don&apos;t produce false positives. The masker runs against{' '}
        <code>request_body</code>, <code>response_body</code>, and <code>error_message</code>.
        Source: <code>apps/server/src/lib/pii-mask.ts</code>.
      </p>

      <h2 id="body-retention">Body retention modes, <code>logBody</code></h2>
      <p>
        Pattern masking covers <em>structured</em> secrets. It does <strong>not</strong> redact
        natural-language PII (names, emails, addresses, medical information) that the regex
        rules above also can&apos;t reliably catch. For PII-heavy workloads, the right answer
        is to not store the body at all:
      </p>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Bodies stored</th>
            <th>Tokens / cost / latency / model</th>
            <th>user_id / session_id</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>full</code> (default)</td>
            <td>Yes (with key masking above)</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td><code>meta</code></td>
            <td>No</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td><code>none</code></td>
            <td>No</td>
            <td>Yes</td>
            <td>No (null)</td>
          </tr>
        </tbody>
      </table>
      <p>
        Set per-call via the SDK helper{' '}
        <a href="/docs/sdk#with-log-body"><code>withLogBody(mode)</code></a> or the{' '}
        <code>x-spanlens-log-body</code> header. The server falls back to{' '}
        <code>full</code> on any unrecognized value, so a malformed header never silently
        disables logging.
      </p>
      <p className="text-sm text-muted-foreground">
        Spanlens does NOT ship automatic natural-language PII redaction. Pattern matching on
        free text produces too many false positives/negatives to be the default, we&apos;d
        rather give you a clean opt-out and let your prompts that need full bodies keep them.
        Enterprise customers needing in-place redaction (medical / financial), reach out.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No custom rules.</strong> Rule set is hard-coded today. Custom regex + custom
          webhook alerts are planned post-launch.
        </li>
        <li>
          <strong>Blocking covers injection only, not PII.</strong> PII is detect-and-alert only.
          A policy engine for rewriting or blocking PII is on the roadmap.
        </li>
        <li>
          <strong>National ID coverage is limited.</strong> Only US SSN and Korean RRN are
          currently recognized as national identifiers. Other country-specific ID formats
          (IBAN, UK NI, German Personalausweis, etc.) aren&apos;t yet covered. PRs welcome.
        </li>
        <li>
          <strong>No LLM-based secondary check.</strong> For high-stakes workloads you&apos;ll
          want a classifier on top. Integrations with Llama Guard / Prompt Guard are under
          consideration.
        </li>
        <li>
          <strong>Regex is not ML.</strong> A sufficiently motivated attacker can rephrase
          injection phrases to slip through. What we catch is the long tail of accidentally bad
          inputs and low-effort attacks, which covers 90%+ of real incidents.
        </li>
        <li>
          <strong>Natural-language PII is not auto-redacted.</strong> The{' '}
          <a href="#stored-body-sanitization">key scrubber</a> only catches structured patterns
          like API keys. Names, emails, card numbers in free-form prompts pass through. Use{' '}
          <a href="#body-retention"><code>logBody: &apos;meta&apos;</code></a> to skip body
          storage entirely for those workloads.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/anomalies">Anomalies</a> (statistical spike detection),{' '}
        <a href="/security">/security</a> dashboard. Source:{' '}
        <code>apps/server/src/lib/security-scan.ts</code>,{' '}
        <code>apps/server/src/api/security.ts</code>.
      </p>
    </div>
  )
}
