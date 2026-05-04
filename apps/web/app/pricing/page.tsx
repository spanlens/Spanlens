import Link from 'next/link'
import { Check } from 'lucide-react'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'
import { Footer } from '@/components/layout/footer'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Pricing · Spanlens' }

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    description: 'For personal projects and exploration',
    features: [
      '10K requests / month',
      '1 workspace',
      '1 member',
      '7-day log retention',
      'All core features included',
      'CSV + JSON export',
      'Community support',
    ],
    overage: null,
    cta: 'Start free',
    href: '/signup',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$29',
    description: 'For solo developers shipping to production',
    features: [
      '100K requests / month',
      '3 workspaces',
      'Up to 5 members',
      '30-day log retention',
      '5 alerts',
      'Email notifications',
      'CSV + JSON export',
      'Email support',
    ],
    overage: '$8 / 100K extra requests',
    cta: 'Start Pro',
    href: '/signup?plan=starter',
    highlight: true,
  },
  {
    name: 'Team',
    price: '$99',
    description: 'For teams that need full visibility',
    features: [
      '500K requests / month',
      'Unlimited workspaces',
      'Unlimited members',
      '90-day log retention',
      'Unlimited alerts',
      'Email + Slack notifications',
      'Webhooks',
      'CSV + JSON export',
      'Priority support',
    ],
    overage: '$6 / 100K extra requests',
    cta: 'Start Team',
    href: '/signup?plan=team',
    highlight: false,
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-bg">
      {/* Nav */}
      <nav className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 h-[56px]">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/icon.png" alt="Spanlens" width={22} height={22} className="shrink-0 rounded-[5px]" />
            <span className="font-semibold text-[16px] text-text tracking-[-0.3px]">Spanlens</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/docs" className="text-[13px] text-text-muted hover:text-text transition-colors">
              Docs
            </Link>
            <AuthNavButtons signupLabel="Get started free" />
          </div>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-10">
          <h1 className="text-[36px] font-semibold tracking-[-0.6px] text-text mb-3">Simple, honest pricing</h1>
          <p className="text-[16px] text-text-muted">
            Start free. Scale as you grow. Cancel anytime.
          </p>
        </div>

        {/* Common features */}
        <div className="max-w-3xl mx-auto mb-14 rounded-xl border border-border bg-bg-elev px-6 py-5 text-sm">
          <p className="font-semibold text-text mb-2.5">Every plan includes</p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-1.5 gap-x-6 text-text-muted">
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              <code className="font-mono text-xs bg-bg px-1.5 py-0.5 rounded border border-border">npx @spanlens/cli init</code>
              <span>1-command setup</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              Self-hostable (Docker)
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              OpenAI / Anthropic / Gemini
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              Agent tracing (Gantt view)
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              PII + prompt-injection detection
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-good shrink-0" />
              Anomaly detection (3σ)
            </li>
          </ul>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'rounded-xl border flex flex-col overflow-hidden',
                plan.highlight ? 'border-accent' : 'border-border',
              )}
            >
              {plan.highlight && (
                <div className="text-center py-1.5 bg-accent text-bg text-[11px] font-semibold tracking-wide uppercase">
                  Most popular
                </div>
              )}
              <div className={cn('flex-1 p-6', plan.highlight ? 'bg-accent-bg' : 'bg-bg-elev')}>
                <h2 className="text-[18px] font-semibold text-text mb-1">{plan.name}</h2>
                <p className="text-[13px] text-text-muted mb-4">{plan.description}</p>
                <div className="mb-1">
                  <span className="font-mono text-[32px] font-medium tracking-[-0.5px] text-text">{plan.price}</span>
                  <span className="font-mono text-[12px] text-text-muted">/mo</span>
                </div>
                {plan.overage ? (
                  <p className="font-mono text-[11px] text-text-faint mb-5">+ {plan.overage}</p>
                ) : (
                  <div className="mb-5" />
                )}
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-[13px] text-text-muted">
                      <Check className="h-3.5 w-3.5 text-good shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={cn(
                    'block w-full h-9 rounded-[6px] text-[13px] font-medium text-center leading-9 transition-opacity hover:opacity-90',
                    plan.highlight
                      ? 'bg-accent text-bg'
                      : 'border border-border bg-bg text-text',
                  )}
                >
                  {plan.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-[13px] text-text-muted mt-10">
          Need more?{' '}
          <a href="mailto:hi@spanlens.io" className="text-accent hover:opacity-80 transition-opacity">
            Contact us for Enterprise pricing
          </a>
        </p>

        {/* Overage policy */}
        <div className="mt-16 rounded-xl border border-border bg-bg-elev p-6 max-w-3xl mx-auto">
          <h3 className="font-semibold text-[15px] text-text mb-3">What happens if I go over my quota?</h3>
          <p className="text-[13px] text-text-muted mb-4">
            Paid plans default to <strong className="text-text">overage billing</strong> so you&apos;re never
            surprise-blocked mid-month:
          </p>
          <ul className="text-[13px] text-text-muted space-y-2 mb-4">
            <li>
              <strong className="text-text">Soft limit</strong> — your plan&apos;s included quota (100K on Pro,
              500K on Team). Extra requests pass through and accumulate.
            </li>
            <li>
              <strong className="text-text">Overage billing</strong> — Pro $8 / Team $6 per 100K extra
              requests, charged immediately at the end of your billing period (not deferred to next month).
            </li>
            <li>
              <strong className="text-text">Hard cap</strong> — default 5× the soft limit. Past this,
              requests return 429 even with overage enabled. Adjustable 1–100× in settings.
            </li>
            <li>
              <strong className="text-text">Cost certainty mode</strong> — flip overage off in settings to
              hard-block at your quota instead.
            </li>
            <li>
              <strong className="text-text">Free plan</strong> — always a hard block at 10K. Upgrade to Pro
              for overage.
            </li>
          </ul>
          <Link
            href="/docs/features/billing"
            className="text-[13px] text-accent hover:opacity-80 transition-opacity inline-flex items-center gap-1"
          >
            Full billing &amp; quota docs →
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  )
}
