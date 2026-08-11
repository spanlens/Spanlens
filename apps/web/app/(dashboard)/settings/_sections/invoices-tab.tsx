'use client'
import { formatDate } from '@/lib/utils'
import { Section } from '@/components/ui/primitives'
import { useSubscription } from '@/lib/queries/use-billing'
import { TabHeader } from '../_shared/ui'

// ─── INVOICES tab ─────────────────────────────────────────────────────────────

export function InvoicesTab() {
  const { data: subscription } = useSubscription()

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Invoices"
        description="Invoices are issued and delivered by Paddle, our payment processor."
      />

      <Section title="Where to find your invoices" className="mb-5">
        <div className="px-6 py-5 space-y-4 text-[13px] text-text-muted leading-relaxed">
          <p>
            Every invoice lands in your inbox from <span className="font-mono text-text">noreply@paddle.com</span> as
            a PDF attachment, usually within minutes of each renewal or top-up charge.
          </p>
          <p>
            To browse past invoices, update your payment method, or cancel, use the self-service link that
            Paddle emailed when you first subscribed. Paddle&apos;s customer portal is the source of truth for
            billing history.
          </p>
          {subscription ? (
            <p className="font-mono text-[11.5px] text-text-faint">
              Current subscription · {subscription.plan} · renews {formatDate(subscription.current_period_end)}
            </p>
          ) : (
            <p className="font-mono text-[11.5px] text-text-faint">
              You&apos;re on the free plan, no invoices generated.
            </p>
          )}
        </div>
      </Section>
    </div>
  )
}
