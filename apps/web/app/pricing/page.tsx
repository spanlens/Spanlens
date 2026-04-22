import Link from 'next/link'
import { Check, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export const metadata = { title: 'Pricing' }

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    description: 'For personal projects and exploration',
    requests: '10,000 req/mo',
    features: [
      '10K requests / month',
      '1 project',
      '3 providers (OpenAI, Anthropic, Gemini)',
      '7-day log retention',
      'Community support',
    ],
    cta: 'Start free',
    href: '/signup',
    highlight: false,
  },
  {
    name: 'Starter',
    price: '$19',
    description: 'For solo developers shipping to production',
    requests: '100,000 req/mo',
    features: [
      '100K requests / month',
      'Up to 5 projects',
      'All providers',
      '30-day log retention',
      'Cost alerts & budgets',
      'Email support',
    ],
    cta: 'Start Starter',
    href: '/signup?plan=starter',
    highlight: true,
  },
  {
    name: 'Team',
    price: '$49',
    description: 'For teams that need more visibility',
    requests: '500,000 req/mo',
    features: [
      '500K requests / month',
      'Unlimited projects',
      'All providers',
      '90-day log retention',
      'Agent tracing (Gantt view)',
      'Slack / Discord alerts',
      'Priority support',
    ],
    cta: 'Start Team',
    href: '/signup?plan=team',
    highlight: false,
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-blue-600" />
          <span className="font-bold text-lg">Spanlens</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button variant="outline" size="sm">Sign in</Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started free</Button>
          </Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 py-24">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-4">Simple, honest pricing</h1>
          <p className="text-lg text-muted-foreground">
            Start free. Scale as you grow. Cancel anytime.
          </p>
        </div>

        {/* Common features — all plans */}
        <div className="max-w-3xl mx-auto mb-14 rounded-xl border bg-gray-50 px-6 py-5 text-sm">
          <p className="font-semibold text-gray-700 mb-2.5">Every plan includes</p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-1.5 gap-x-6 text-gray-600">
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              <code className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border">npx @spanlens/cli init</code>
              <span>1-command setup</span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              Self-hostable (Docker)
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              OpenAI / Anthropic / Gemini
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              Agent tracing (Gantt view)
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              PII + prompt-injection detection
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              Anomaly detection (3σ)
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <Card
              key={plan.name}
              className={plan.highlight ? 'border-blue-600 ring-2 ring-blue-600' : ''}
            >
              {plan.highlight && (
                <div className="text-center py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-t-lg -mt-px">
                  Most popular
                </div>
              )}
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="pt-2">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href={plan.href}>
                  <Button
                    className="w-full"
                    variant={plan.highlight ? 'default' : 'outline'}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-10">
          Need more?{' '}
          <a href="mailto:hi@spanlens.io" className="underline">
            Contact us for Enterprise pricing
          </a>
        </p>
      </section>
    </div>
  )
}
