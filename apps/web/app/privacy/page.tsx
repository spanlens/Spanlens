import Link from 'next/link'
import { Zap } from 'lucide-react'
import { Footer } from '@/components/layout/footer'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'

export const metadata = {
  title: 'Privacy Policy · Spanlens',
  description:
    'How Spanlens collects, uses, and protects your data. Covers PIPA (Korea) and GDPR (EU) disclosures and your rights as a data subject.',
}

const EFFECTIVE_DATE = '2026-04-22'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <nav className="border-b px-6 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-blue-600" />
          <span className="font-bold text-lg">Spanlens</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
          <AuthNavButtons signupLabel="Get started free" />
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto px-6 py-12 prose prose-gray
        prose-headings:scroll-mt-20
        prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline">
        <h1>Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Effective date:</strong> {EFFECTIVE_DATE}
        </p>

        <p>
          This Privacy Policy describes how <strong>Oceancode</strong> (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;), operator of Spanlens, collects, uses, and protects your personal
          data. It is drafted to meet the requirements of the Personal Information Protection
          Act of the Republic of Korea (&ldquo;PIPA&rdquo;) and the EU General Data Protection
          Regulation (&ldquo;GDPR&rdquo;).
        </p>

        <h2 id="controller">1. Data controller</h2>
        <ul>
          <li><strong>Trade name:</strong> Oceancode (오션코드)</li>
          <li><strong>Representative:</strong> Jeon Haesung (전해성)</li>
          <li><strong>Business Registration Number:</strong> 676-71-00622</li>
          <li><strong>E-commerce Registration Number:</strong> 2025-경기광주-2133</li>
          <li><strong>Jurisdiction:</strong> Republic of Korea</li>
          <li>
            <strong>Privacy Officer (개인정보보호책임자):</strong> Jeon Haesung —{' '}
            <a href="mailto:support@spanlens.io">support@spanlens.io</a>
          </li>
        </ul>

        <h2 id="what-we-collect">2. What data we collect</h2>

        <h3>Account information</h3>
        <ul>
          <li>Email address (required)</li>
          <li>Display name / avatar URL (when you sign in via Google OAuth)</li>
          <li>Organization name</li>
          <li>Authentication tokens (managed by our identity provider, Supabase)</li>
        </ul>

        <h3>Service telemetry (LLM requests routed through our proxy)</h3>
        <ul>
          <li>
            Request and response bodies, <strong>truncated to a 10 KB preview</strong> — these
            may contain whatever you or your end users submitted to the LLM, including prompts,
            file contents, user messages, and retrieved context.
          </li>
          <li>
            Model identifier, provider, token counts, latency, HTTP status, and computed USD
            cost for each request.
          </li>
          <li>
            Agent trace identifiers and span metadata when you use{' '}
            <code>observe()</code> or pass <code>x-trace-id</code> / <code>x-span-id</code> headers.
          </li>
          <li>
            Prompt version tag when you use <code>withPromptVersion()</code> or the
            <code>X-Spanlens-Prompt-Version</code> header.
          </li>
          <li>
            Security flags (PII patterns, prompt-injection patterns) detected in the request
            body, stored as <strong>masked samples</strong> of 6 characters — never the raw
            matched text.
          </li>
          <li>
            <strong>Authorization headers are stripped</strong> from stored request bodies so
            your provider API keys never appear in logs.
          </li>
        </ul>

        <h3>Your third-party LLM provider keys</h3>
        <p>
          If you register keys for OpenAI / Anthropic / Gemini, we store them{' '}
          <strong>encrypted at rest using AES-256-GCM</strong> with a master key held outside
          the database. Keys are only decrypted in ephemeral process memory when your proxy
          request needs them, and are never displayed back to you after creation.
        </p>

        <h3>Billing metadata</h3>
        <p>
          Payment processing is handled by Paddle.com Market Ltd. We do not store your credit
          card number. We retain the Paddle customer and subscription identifiers, your plan
          tier, and the current billing period from Paddle&apos;s webhooks.
        </p>

        <h3>Technical logs</h3>
        <ul>
          <li>IP address (briefly, in network-layer logs)</li>
          <li>User agent</li>
          <li>Session cookies set by our authentication provider</li>
          <li>Timestamps of login and usage</li>
        </ul>

        <h2 id="how-we-use">3. How we use your data</h2>
        <ul>
          <li>Provide, maintain, and improve the Spanlens service</li>
          <li>Authenticate your account and protect it from unauthorized access</li>
          <li>Route LLM requests to the upstream provider you targeted</li>
          <li>Display your request history, traces, costs, and anomalies in the dashboard</li>
          <li>Send transactional emails (invoices, quota warnings, security alerts)</li>
          <li>Process payments and prevent fraud (via Paddle)</li>
          <li>Comply with legal obligations (tax records, dispute evidence)</li>
        </ul>

        <h2 id="legal-basis">4. Legal basis (GDPR)</h2>
        <p>For EU users, we process data on the following legal bases (GDPR Art. 6):</p>
        <ul>
          <li>
            <strong>Performance of a contract</strong> (Art. 6(1)(b)) — most service operation
            falls here, because we process data to fulfill our service obligations to you.
          </li>
          <li>
            <strong>Legitimate interests</strong> (Art. 6(1)(f)) — security monitoring, fraud
            prevention, and service improvement.
          </li>
          <li>
            <strong>Legal obligation</strong> (Art. 6(1)(c)) — tax record retention and legal
            requests from Korean authorities.
          </li>
          <li>
            <strong>Consent</strong> (Art. 6(1)(a)) — used for optional features; you may
            withdraw consent at any time.
          </li>
        </ul>

        <h2 id="third-parties">5. Third parties we share data with (sub-processors)</h2>
        <p>
          We engage the following processors to operate Spanlens. Each processes your data only
          as needed to provide their service, under contractual confidentiality obligations:
        </p>
        <table>
          <thead>
            <tr>
              <th>Sub-processor</th>
              <th>Purpose</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Supabase Inc.</td>
              <td>Database, authentication, storage</td>
              <td>USA (AWS)</td>
            </tr>
            <tr>
              <td>Vercel Inc.</td>
              <td>Web and API hosting, Edge runtime</td>
              <td>USA / EU (Vercel Edge Network)</td>
            </tr>
            <tr>
              <td>Paddle.com Market Ltd.</td>
              <td>Payment processing, Merchant of Record, invoicing</td>
              <td>United Kingdom</td>
            </tr>
            <tr>
              <td>Resend, Inc.</td>
              <td>Transactional and alert emails</td>
              <td>USA</td>
            </tr>
            <tr>
              <td>OpenAI, L.L.C.</td>
              <td>LLM request forwarding (when you target OpenAI endpoints)</td>
              <td>USA</td>
            </tr>
            <tr>
              <td>Anthropic, PBC</td>
              <td>LLM request forwarding (Anthropic endpoints)</td>
              <td>USA</td>
            </tr>
            <tr>
              <td>Google LLC</td>
              <td>LLM request forwarding (Gemini endpoints)</td>
              <td>USA / EU (Google Cloud)</td>
            </tr>
            <tr>
              <td>GitHub, Inc.</td>
              <td>Code hosting, container registry (for self-host users)</td>
              <td>USA</td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>We do not sell your data</strong> and we do not share it with advertising
          networks or data brokers.
        </p>

        <h2 id="international-transfers">6. International data transfers</h2>
        <p>
          Because several of our sub-processors are located outside the Republic of Korea and
          the EEA, your data may be transferred internationally. For transfers outside the EEA,
          we rely on the European Commission&apos;s Standard Contractual Clauses or equivalent
          safeguards offered by each sub-processor. PIPA-required cross-border disclosure
          (recipient, purpose, data items, retention, transfer method) is satisfied by the
          table above.
        </p>

        <h2 id="retention">7. How long we keep your data</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Retention period</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account profile (email, name)</td>
              <td>Until you delete your account, then <strong>15 days</strong></td>
            </tr>
            <tr>
              <td>LLM request logs</td>
              <td>Per your plan: 7 days (Free) / 30 days (Starter) / 90 days (Team) / 365 days (Enterprise)</td>
            </tr>
            <tr>
              <td>Encrypted provider keys</td>
              <td>Until you revoke them, then purged within 15 days</td>
            </tr>
            <tr>
              <td>Billing and payment records</td>
              <td>5 years from the transaction (Korean tax law requirement)</td>
            </tr>
            <tr>
              <td>Records of consumer complaints and dispute resolution</td>
              <td>3 years (Korean e-commerce law)</td>
            </tr>
            <tr>
              <td>Server logs (IP, user agent)</td>
              <td>30 days</td>
            </tr>
          </tbody>
        </table>

        <h2 id="your-rights">8. Your rights</h2>

        <h3>Under Korean PIPA</h3>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you (열람 요구)</li>
          <li>Correct inaccuracies (정정·삭제 요구)</li>
          <li>Request deletion or processing suspension (삭제·처리정지 요구)</li>
          <li>Withdraw previously given consent at any time</li>
          <li>File a complaint with the Personal Information Protection Commission (개인정보보호위원회, <a href="https://www.pipc.go.kr" target="_blank" rel="noopener noreferrer">pipc.go.kr</a>) or relevant authority.</li>
        </ul>

        <h3>Under GDPR (EU users)</h3>
        <p>You additionally have the rights of:</p>
        <ul>
          <li>Access (Art. 15)</li>
          <li>Rectification (Art. 16)</li>
          <li>Erasure / &ldquo;right to be forgotten&rdquo; (Art. 17)</li>
          <li>Restriction of processing (Art. 18)</li>
          <li>Data portability — export in machine-readable format (Art. 20)</li>
          <li>Objection to processing based on legitimate interests (Art. 21)</li>
          <li>Lodging a complaint with your national Data Protection Authority</li>
        </ul>
        <p>
          To exercise any of these rights, email{' '}
          <a href="mailto:support@spanlens.io">support@spanlens.io</a> from the address
          associated with your account. We respond within <strong>30 days</strong> (may extend
          to 60 days for complex requests, with notice).
        </p>

        <h2 id="children">9. Children&apos;s privacy</h2>
        <p>
          Spanlens is not directed at children under 14. Korean law prohibits processing
          personal data of children under 14 without explicit guardian consent. We do not
          knowingly collect such data. If you believe a child has provided data to us, contact
          us and we will delete it.
        </p>

        <h2 id="cookies">10. Cookies</h2>
        <p>
          We set <strong>functional cookies</strong> required to maintain your authenticated
          session. These include the <code>sb-access-token</code> and <code>sb-refresh-token</code>
          cookies managed by Supabase. We do <strong>not</strong> use advertising cookies,
          tracking pixels, or third-party analytics cookies. No consent banner is required for
          our current cookie usage under the ePrivacy Directive&apos;s &ldquo;strictly
          necessary&rdquo; exception.
        </p>
        <p>
          If we add analytics in the future, we will update this policy and offer an opt-in
          consent mechanism.
        </p>

        <h2 id="security">11. Security measures</h2>
        <ul>
          <li>Provider API keys encrypted at rest with AES-256-GCM (authenticated encryption)</li>
          <li>HTTPS/TLS 1.2+ enforced on all transport</li>
          <li>Row-Level Security policies on our Postgres database, enforced by Supabase</li>
          <li>Separate service-role and anon keys; service-role is scoped to server-side operations only</li>
          <li>Authorization headers stripped from stored request bodies</li>
          <li>Encryption master key held outside the database, in infrastructure-level secret management</li>
          <li>Access logging and periodic audit of administrator actions</li>
          <li>Principle of least privilege for team access</li>
        </ul>

        <h2 id="breach">12. Data breach notification</h2>
        <p>
          If we become aware of a personal data breach that is likely to result in a risk to
          your rights and freedoms, we will notify the Personal Information Protection
          Commission (Korea) and, where GDPR applies, the relevant supervisory authority within
          <strong> 72 hours</strong>, and notify affected users without undue delay.
        </p>

        <h2 id="changes">13. Changes to this policy</h2>
        <p>
          We may revise this Privacy Policy from time to time. Material changes will be
          notified to registered users by email at least <strong>14 days</strong> before
          taking effect. The effective date at the top of this page will always reflect the
          current version.
        </p>

        <h2 id="contact">14. Contact us</h2>
        <p>
          For any privacy-related inquiry, contact our Privacy Officer at{' '}
          <a href="mailto:support@spanlens.io">support@spanlens.io</a>.
        </p>

        <hr />
        <p className="text-sm text-muted-foreground">
          Last updated: {EFFECTIVE_DATE}. Previous versions are available on request.
        </p>
      </main>

      <Footer />
    </div>
  )
}
