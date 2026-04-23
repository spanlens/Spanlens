import Link from 'next/link'
import { Zap } from 'lucide-react'
import { Footer } from '@/components/layout/footer'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'

export const metadata = {
  title: 'Terms of Service · Spanlens',
  description:
    'The agreement governing your use of Spanlens. Covers accounts, billing, the 14-day refund policy, acceptable use, and liability.',
}

const EFFECTIVE_DATE = '2026-04-22'

export default function TermsPage() {
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
        <h1>Terms of Service</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Effective date:</strong> {EFFECTIVE_DATE}
        </p>

        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of Spanlens, an LLM
          observability service operated by <strong>Oceancode</strong> (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;). By creating an account or sending traffic through the Spanlens
          proxy, you agree to these Terms.
        </p>

        <h2 id="business-info">1. Business information</h2>
        <p>
          Spanlens is a service provided by Oceancode, a sole proprietorship registered in the
          Republic of Korea.
        </p>
        <ul>
          <li><strong>Trade name:</strong> Oceancode (오션코드)</li>
          <li><strong>Representative:</strong> Jeon Haesung (전해성)</li>
          <li><strong>Business Registration Number:</strong> 676-71-00622</li>
          <li><strong>E-commerce Registration Number (통신판매업신고번호):</strong> 2025-경기광주-2133</li>
          <li><strong>Contact:</strong> support@spanlens.io</li>
        </ul>

        <h2 id="the-service">2. The service</h2>
        <p>
          Spanlens provides an HTTP proxy + dashboard for observing Large Language Model (LLM)
          requests sent to third-party providers (OpenAI, Anthropic, Google Gemini). We log
          request and response metadata, calculate costs, and offer analytics features such as
          request history, agent tracing, anomaly detection, prompt version comparison, and
          security scanning.
        </p>

        <h2 id="account">3. Your account</h2>
        <ul>
          <li>You must provide an accurate email address and keep it current.</li>
          <li>You are responsible for maintaining the confidentiality of your credentials and API keys.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
          <li>You must be at least 14 years old to use the service (minimum age under Korean law).</li>
          <li>One account per person; one organization per sole proprietorship / legal entity unless we agree otherwise in writing.</li>
        </ul>

        <h2 id="plans-billing">4. Plans, pricing, and billing</h2>
        <p>
          Current plan pricing and included quotas are listed at{' '}
          <Link href="/pricing">/pricing</Link>. Overage behavior, hard caps, and invoice
          format are documented at <Link href="/docs/features/billing">/docs/features/billing</Link>.
        </p>
        <ul>
          <li>
            Paid plans are billed monthly in advance by <strong>Paddle.com Market Ltd.</strong>,
            which acts as the Merchant of Record for the transaction. Taxes (VAT, GST, sales
            tax) are calculated and remitted by Paddle based on your location.
          </li>
          <li>
            Usage-based overage charges (if enabled on your organization) are added to the next
            invoice at the rate published on the pricing page at the time the overage accrues.
          </li>
          <li>
            We may change plan prices with at least <strong>30 days&apos; notice</strong> by email.
            Existing billing periods are honored at the old price.
          </li>
        </ul>

        <h2 id="refunds">5. Refund policy</h2>
        <p>
          We offer a <strong>14-day money-back guarantee</strong> on new paid subscriptions
          subject to all of the following:
        </p>
        <ol>
          <li>
            The refund request is made within <strong>14 days</strong> of the initial charge
            for that subscription.
          </li>
          <li>
            Usage at the time of the request is <strong>under 10% of the plan&apos;s included
            monthly quota</strong>:
            <ul>
              <li>Starter plan: under 10,000 requests</li>
              <li>Team plan: under 50,000 requests</li>
            </ul>
          </li>
        </ol>
        <p>
          Refunds meeting both conditions are issued to the original payment method via Paddle
          within 5–10 business days.
        </p>
        <p>
          Refunds are <strong>not available</strong> for:
        </p>
        <ul>
          <li>Subscriptions past the 14-day window (including renewals)</li>
          <li>Accounts whose usage exceeds the 10% threshold at the time of request</li>
          <li>Enterprise plans or custom contracts (governed separately)</li>
          <li>Overage charges that have already been invoiced</li>
        </ul>
        <p>
          You may <strong>cancel your subscription at any time</strong> — cancellation stops
          future renewals but does not by itself trigger a refund. Your plan remains active
          through the end of the current billing period.
        </p>
        <p>
          To request a refund, email <a href="mailto:support@spanlens.io">support@spanlens.io</a>{' '}
          from the address associated with your account.
        </p>

        <h2 id="acceptable-use">6. Acceptable use</h2>
        <p>You agree <strong>not</strong> to use Spanlens to:</p>
        <ul>
          <li>Violate any applicable law, including export controls and sanctions regimes.</li>
          <li>Infringe the intellectual property or privacy rights of others.</li>
          <li>Generate or disseminate malware, phishing content, CSAM, or targeted harassment.</li>
          <li>
            Probe, scan, or stress-test our systems or networks beyond your allocated quota
            except with our prior written consent.
          </li>
          <li>
            Resell or sublicense the service to third parties without an explicit reseller
            agreement.
          </li>
          <li>
            Circumvent plan quotas, the hard-cap mechanism, or any other technical limit built
            into the service.
          </li>
        </ul>
        <p>
          We may suspend or terminate accounts that violate these rules, with or without prior
          notice depending on severity.
        </p>

        <h2 id="provider-relationships">7. Third-party LLM providers</h2>
        <p>
          Spanlens forwards your LLM requests to OpenAI, Anthropic, or Google Gemini based on
          the endpoint you target. <strong>Those services are operated by third parties under
          their own terms.</strong> You are responsible for:
        </p>
        <ul>
          <li>Accepting and complying with those providers&apos; terms of service.</li>
          <li>Keeping your own provider API keys secure and authorized for the use cases you put through our proxy.</li>
          <li>Any charges those providers bill you directly (Spanlens does not bill you for provider API usage — that&apos;s your account with OpenAI/Anthropic/Google).</li>
        </ul>

        <h2 id="ip">8. Intellectual property</h2>
        <p>
          <strong>Your content remains yours.</strong> Requests, responses, prompts, and any
          other data you transmit through Spanlens are owned by you. You grant us a limited,
          worldwide, royalty-free license to process, store, and display that data solely for
          the purpose of providing the service to you and your organization.
        </p>
        <p>
          <strong>Our service remains ours.</strong> The Spanlens software, dashboard, SDK
          (<code>@spanlens/sdk</code>), CLI (<code>@spanlens/cli</code>), proxy infrastructure,
          documentation, brand assets, and related materials are owned by Oceancode. The SDK
          and CLI are distributed under the MIT license; the server and dashboard are
          source-available under the terms stated in our GitHub repository.
        </p>

        <h2 id="availability">9. Service availability</h2>
        <p>
          We provide the service on a <strong>best-effort basis.</strong> We do not guarantee
          uninterrupted availability except where expressly committed in an Enterprise service
          level agreement. Planned maintenance is announced in advance when feasible.
        </p>
        <p>
          In the event of an extended outage that materially prevents service use for more than
          24 consecutive hours, paid customers may request a pro-rata credit on the next
          invoice by emailing support.
        </p>

        <h2 id="liability">10. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Oceancode&apos;s total aggregate liability
          arising out of or relating to the service — whether in contract, tort, or any other
          theory — is limited to the <strong>amount you paid to Spanlens in the 12 months
          preceding the event giving rise to liability</strong>.
        </p>
        <p>
          We are not liable for indirect, incidental, consequential, or punitive damages; for
          lost profits, lost revenue, or lost data arising out of your use of the service; or
          for actions of third-party LLM providers.
        </p>

        <h2 id="termination">11. Termination</h2>
        <p>
          You may terminate your account at any time through the dashboard settings or by
          emailing support. We may terminate or suspend your account for material breach of
          these Terms, non-payment, or fraud, with reasonable notice where possible.
        </p>
        <p>
          Upon termination, we delete your account-level data within the retention windows
          described in our <Link href="/privacy">Privacy Policy</Link>. Outstanding invoices
          remain payable.
        </p>

        <h2 id="changes">12. Changes to these Terms</h2>
        <p>
          We may revise these Terms from time to time. Material changes will be notified to
          registered users by email at least <strong>30 days</strong> before taking effect.
          Continued use of the service after the effective date constitutes acceptance. You may
          terminate your account before the effective date if you do not accept the changes.
        </p>

        <h2 id="governing-law">13. Governing law and jurisdiction</h2>
        <p>
          These Terms are governed by the laws of the Republic of Korea, without regard to
          conflict-of-laws principles. Any dispute arising out of or relating to these Terms or
          the service shall be subject to the exclusive jurisdiction of the Seoul Central
          District Court (서울중앙지방법원), unless otherwise required by applicable consumer
          protection law in your country of residence.
        </p>

        <h2 id="contact">14. Contact</h2>
        <p>
          Questions about these Terms should be directed to{' '}
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
