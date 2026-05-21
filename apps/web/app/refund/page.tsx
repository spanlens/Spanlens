import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'

export const metadata = {
  title: 'Refund Policy · Spanlens',
  description:
    'Spanlens refund policy, 14-day money-back guarantee, EU statutory withdrawal rights, and how to request a refund.',
}

const EFFECTIVE_DATE = '2026-05-17'

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <MarketingNav />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-12 prose prose-stone
        prose-headings:scroll-mt-20
        prose-a:text-accent prose-a:no-underline hover:prose-a:opacity-80">
        <h1>Refund Policy</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Effective date:</strong> {EFFECTIVE_DATE}
        </p>

        <p>
          This Refund Policy applies to paid subscriptions to Spanlens, operated by{' '}
          <strong>Oceancode</strong>. Payments are processed by{' '}
          <strong>Paddle.com Market Ltd.</strong>, which acts as the Merchant of Record.
          For full terms of service, see our <Link href="/terms">Terms of Service</Link>.
        </p>

        <h2 id="money-back">14-day money-back guarantee</h2>
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
              <li>Pro plan: under 10,000 requests</li>
              <li>Team plan: under 100,000 requests</li>
            </ul>
          </li>
        </ol>
        <p>
          Refunds meeting both conditions are issued to the original payment method via Paddle
          within 5–10 business days.
        </p>

        <h2 id="not-available">When refunds are not available</h2>
        <p>
          Refunds are <strong>not available</strong> for:
        </p>
        <ul>
          <li>Subscriptions past the 14-day window (including renewals)</li>
          <li>Accounts whose usage exceeds the 10% threshold at the time of request</li>
          <li>Enterprise plans or custom contracts (governed separately)</li>
          <li>Overage charges that have already been invoiced</li>
        </ul>

        <h2 id="eu-rights">EU statutory withdrawal right</h2>
        <p>
          If you are resident in the <strong>European Union or European Economic Area</strong>,
          you have a statutory right to withdraw from this contract within 14 calendar days of
          purchase without giving any reason, regardless of usage (EU Consumer Rights Directive
          2011/83/EU). If you have started using the service during the withdrawal period, we
          may deduct a proportionate amount for actual usage before issuing the refund.
        </p>
        <p>
          To exercise this right, email{' '}
          <a href="mailto:support@spanlens.io">support@spanlens.io</a> within 14 days of your
          initial charge. The 10% usage condition above does <strong>not</strong> apply to EU
          statutory withdrawal requests.
        </p>

        <h2 id="cancellation">Cancellation</h2>
        <p>
          You may cancel your subscription at any time from the{' '}
          <Link href="/billing">Billing page</Link> in your dashboard. Cancellation stops future
          renewals but does not by itself trigger a refund, your plan remains active through the
          end of the current billing period.
        </p>

        <h2 id="how-to-request">How to request a refund</h2>
        <p>
          Email <a href="mailto:support@spanlens.io">support@spanlens.io</a> from the address
          associated with your account. Please include your organization name and the date of the
          charge. We aim to respond within 2 business days.
        </p>

        <hr />
        <p className="text-sm text-muted-foreground">
          Last updated: {EFFECTIVE_DATE}.{' '}
          Questions? <a href="mailto:support@spanlens.io">support@spanlens.io</a>
        </p>
      </main>

      <Footer />
    </div>
  )
}
