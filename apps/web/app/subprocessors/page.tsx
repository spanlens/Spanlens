import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

export const metadata = {
  title: 'Subprocessors · Spanlens',
  description:
    'The complete list of subprocessors Spanlens engages to operate the service, including data hosting locations and the purpose of each engagement.',
}

const EFFECTIVE_DATE = '2026-05-18'

export default function SubprocessorsPage() {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <MarketingNav />

      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 prose prose-stone
        prose-headings:scroll-mt-20
        prose-a:text-accent prose-a:no-underline hover:prose-a:opacity-80">
        <h1>Subprocessors</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Effective date:</strong> {EFFECTIVE_DATE}
        </p>

        <p>
          This page lists the third-party companies (&ldquo;subprocessors&rdquo;) that
          Spanlens engages to operate the service. Each subprocessor processes Customer
          Personal Data only on documented instructions from Spanlens and under contractual
          confidentiality and security obligations consistent with{' '}
          <Link href="/dpa">our Data Processing Addendum</Link>.
        </p>

        <p>
          Customers who have signed our DPA receive at least <strong>30 days&apos; advance
          email notice</strong> before we engage a new subprocessor or change the role of
          an existing one. To subscribe to subprocessor change notifications, email{' '}
          <a href="mailto:support@spanlens.io?subject=Subprocessor%20notifications">
            support@spanlens.io
          </a>{' '}
          from your account address with subject &ldquo;Subprocessor notifications&rdquo;.
        </p>

        <h2 id="infrastructure">Infrastructure subprocessors</h2>
        <p>
          These providers store or transmit Customer Personal Data as part of normal service
          operation.
        </p>

        <table>
          <thead>
            <tr>
              <th>Subprocessor</th>
              <th>Purpose</th>
              <th>Data categories</th>
              <th>Processing location</th>
              <th>Transfer mechanism</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Vercel Inc.</strong>
                <br />
                <span className="text-xs text-muted-foreground">
                  (San Francisco, CA, USA)
                </span>
              </td>
              <td>
                Compute and hosting for the API server (proxy + REST API) and the marketing /
                dashboard web app. Edge cache for static assets.
              </td>
              <td>
                All Customer Personal Data in transit; serverless function memory only (no
                persistent storage beyond logs).
              </td>
              <td>
                Functions: <code>iad1</code> (Washington D.C., US East).
                <br />
                Edge cache: global anycast (no body persistence).
              </td>
              <td>
                EU Standard Contractual Clauses (Module 2), Vercel DPA.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Supabase Inc.</strong>
                <br />
                <span className="text-xs text-muted-foreground">
                  (San Francisco, CA, USA)
                </span>
              </td>
              <td>
                PostgreSQL database (auth, organizations, projects, encrypted provider keys,
                subscription state). Authentication (sign-in, sessions).
              </td>
              <td>
                Account profile, organization membership, encrypted (AES-256-GCM) provider
                keys, billing state, authentication tokens.
              </td>
              <td>
                <code>ap-northeast-2</code> Seoul (AWS Asia Pacific).
              </td>
              <td>
                EU SCCs; Korea has EU adequacy decision (2021/1772).
              </td>
            </tr>
            <tr>
              <td>
                <strong>ClickHouse, Inc.</strong>
                <br />
                <span className="text-xs text-muted-foreground">
                  (Portola Valley, CA, USA)
                </span>
              </td>
              <td>
                Columnar database for the LLM <code>requests</code> table (high-volume
                proxy log storage), accessed via ClickHouse Cloud.
              </td>
              <td>
                Request / response bodies (truncated to 10 KB), token counts, latency,
                cost, model identifiers, security flags.
              </td>
              <td>
                ClickHouse Cloud (US region).
              </td>
              <td>
                EU SCCs, ClickHouse DPA.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Upstash, Inc.</strong>
                <br />
                <span className="text-xs text-muted-foreground">
                  (San Francisco, CA, USA)
                </span>
              </td>
              <td>
                Redis-compatible store for rate-limit counters (sliding window).
              </td>
              <td>
                Hashed organization identifiers and API key hashes only; no request bodies
                or PII. TTL 60 seconds.
              </td>
              <td>
                <code>IAD1</code> (US East).
              </td>
              <td>
                EU SCCs.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Paddle.com Market Ltd.</strong>
                <br />
                <span className="text-xs text-muted-foreground">(Dublin, Ireland)</span>
              </td>
              <td>
                Merchant of Record for all paid subscriptions: invoicing, payment
                processing, tax (VAT / GST / sales tax) collection and remittance, refunds,
                chargeback handling.
              </td>
              <td>
                Customer name, billing address, card / IBAN (held by Paddle, not by
                Spanlens), Paddle customer and subscription identifiers.
              </td>
              <td>
                Ireland (EU).
              </td>
              <td>
                Intra-EU transfer (no SCCs required between EU controller and EU processor).
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="communications">Communications subprocessors</h2>
        <p>
          These providers deliver transactional emails and (optionally) error monitoring
          data.
        </p>

        <table>
          <thead>
            <tr>
              <th>Subprocessor</th>
              <th>Purpose</th>
              <th>Data categories</th>
              <th>Processing location</th>
              <th>Transfer mechanism</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Resend, Inc.</strong>
                <br />
                <span className="text-xs text-muted-foreground">
                  (San Francisco, CA, USA)
                </span>
              </td>
              <td>
                Transactional email delivery (workspace invitations, quota warnings, leak
                alerts, billing notifications).
              </td>
              <td>
                Recipient email address, subject, message body.
              </td>
              <td>USA.</td>
              <td>EU SCCs.</td>
            </tr>
            <tr>
              <td>
                <strong>Functional Software, Inc. (Sentry)</strong>
                <br />
                <span className="text-xs text-muted-foreground">
                  (San Francisco, CA, USA)
                </span>
              </td>
              <td>
                Application error monitoring (stack traces and breadcrumb logs from server
                and dashboard runtime errors).
              </td>
              <td>
                Stack traces with secrets and authorization headers redacted by
                pre-transmission filters (<code>beforeSend</code>).
              </td>
              <td>USA (Sentry US tenant).</td>
              <td>EU SCCs.</td>
            </tr>
          </tbody>
        </table>

        <h2 id="upstream-providers">Upstream LLM providers</h2>
        <p>
          Spanlens is a proxy. When you send a request to the Spanlens proxy targeting an
          upstream LLM provider, we forward that request, including any prompt content
          you submit, to the provider you chose, using API credentials you supplied.
        </p>
        <p>
          The upstream providers are <strong>independent controllers</strong> with respect
          to the requests you route through them, governed by their own terms and privacy
          policies. They are not Spanlens subprocessors in the GDPR Art. 28 sense; we
          enumerate them here for transparency.
        </p>

        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>When data flows there</th>
              <th>Provider terms</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>OpenAI, L.L.C.</strong>
              </td>
              <td>
                When you target an OpenAI endpoint (e.g.{' '}
                <code>/proxy/openai/v1/chat/completions</code>).
              </td>
              <td>
                <a
                  href="https://openai.com/policies/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy policy
                </a>{' '}
                /{' '}
                <a
                  href="https://openai.com/policies/business-terms"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Business terms
                </a>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Anthropic, PBC</strong>
              </td>
              <td>
                When you target an Anthropic endpoint (e.g.{' '}
                <code>/proxy/anthropic/v1/messages</code>).
              </td>
              <td>
                <a
                  href="https://www.anthropic.com/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy policy
                </a>{' '}
                /{' '}
                <a
                  href="https://www.anthropic.com/legal/commercial-terms"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Commercial terms
                </a>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Google LLC</strong>
              </td>
              <td>
                When you target a Gemini endpoint (e.g.{' '}
                <code>/proxy/gemini/v1beta/...</code>).
              </td>
              <td>
                <a
                  href="https://ai.google.dev/gemini-api/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Gemini API terms
                </a>{' '}
                /{' '}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy policy
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="affiliates">Spanlens affiliates and contractors</h2>
        <p>
          Spanlens (Oceancode) is a sole proprietorship registered in the Republic of Korea.
          We do <strong>not</strong> currently engage affiliate entities or external
          contractors who process Customer Personal Data. If this changes, the affiliate
          / contractor will be added to this page with at least 30 days&apos; advance
          notice as described above.
        </p>

        <h2 id="history">Change history</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{EFFECTIVE_DATE}</td>
              <td>
                Initial dedicated subprocessors page extracted from the Privacy Policy.
                Added ClickHouse, Inc. and Upstash, Inc. (newly engaged 2026-05); split
                Sentry and Resend into the Communications section; clarified that LLM
                upstream providers are independent controllers rather than processors.
              </td>
            </tr>
          </tbody>
        </table>

        <hr />
        <p className="text-sm text-muted-foreground">
          Questions about subprocessors should be directed to{' '}
          <a href="mailto:support@spanlens.io">support@spanlens.io</a>. See also our{' '}
          <Link href="/privacy">Privacy Policy</Link> and{' '}
          <Link href="/dpa">Data Processing Addendum</Link>.
        </p>
      </main>

      <Footer />
    </div>
  )
}
