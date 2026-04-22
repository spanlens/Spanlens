import Link from 'next/link'
import { Zap, BarChart3, GitBranch, DollarSign, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-blue-600" />
          <span className="font-bold text-lg">Spanlens</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
          <AuthNavButtons signupLabel="Get started free" />
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Open source · Self-hostable · No vendor lock-in
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-balance mb-6">
          LLM observability in{' '}
          <span className="text-blue-600">30 seconds</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 text-balance">
          One command installs the SDK, rewrites your OpenAI client, and routes every request
          through Spanlens — with full cost, latency, and agent tracing.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/signup">
            <Button size="lg" className="gap-2">
              Start for free <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/pricing">
            <Button size="lg" variant="outline">View pricing</Button>
          </Link>
        </div>

        {/* Code snippet — npx-first */}
        <div className="mt-16 rounded-xl border bg-gray-950 p-6 text-left max-w-xl mx-auto">
          <p className="text-xs text-gray-500 mb-3 font-mono">Run in your Next.js project</p>
          <pre className="text-sm font-mono text-green-400">{`npx @spanlens/cli init`}</pre>
          <p className="text-xs text-gray-600 mt-4 font-mono">
            Auto-installs <span className="text-gray-400">@spanlens/sdk</span>, updates{' '}
            <span className="text-gray-400">.env.local</span>, and rewrites your{' '}
            <span className="text-gray-400">new OpenAI(&hellip;)</span> calls to route through Spanlens.
          </p>
          <p className="text-xs text-gray-600 mt-2 font-mono">
            Prefer manual? <span className="text-gray-400">npm i @spanlens/sdk</span> + 2 lines of code.{' '}
            <Link href="/signup" className="underline hover:text-gray-400">See snippet</Link>
          </p>
        </div>
      </section>

      {/* 3-step onboarding preview */}
      <section className="border-t bg-gray-50 py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-4">Up in 30 seconds</h2>
          <p className="text-center text-muted-foreground mb-12">
            Sign up, paste your API key once, run <span className="font-mono text-sm bg-gray-100 px-1.5 py-0.5 rounded">npx @spanlens/cli init</span> — done.
          </p>
          <div className="grid grid-cols-3 gap-8">
            {STEPS.map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-lg mb-4">
                  {i + 1}
                </div>
                <step.icon className="h-7 w-7 text-blue-600 mb-3" />
                <h3 className="font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-12">Everything you need</h2>
          <div className="grid grid-cols-2 gap-6">
            {FEATURES.map((f, i) => (
              <div key={i} className="rounded-lg border p-6">
                <f.icon className="h-6 w-6 text-blue-600 mb-3" />
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-blue-600 py-16 text-center">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-white mb-4">
            Start observing your LLM calls today
          </h2>
          <p className="text-blue-100 mb-8">Free plan includes 10,000 requests/month.</p>
          <Link href="/signup">
            <Button size="lg" variant="secondary" className="gap-2">
              Get started free <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © 2026 Spanlens · Built for LLM developers
      </footer>
    </div>
  )
}

const STEPS = [
  {
    icon: DollarSign,
    title: 'Sign up + register provider keys',
    description: 'Paste your OpenAI / Anthropic / Gemini key. We encrypt at rest with AES-256-GCM.',
  },
  {
    icon: GitBranch,
    title: 'Run the wizard',
    description: 'npx @spanlens/cli init — installs the SDK, sets up env, rewrites your OpenAI client.',
  },
  {
    icon: BarChart3,
    title: 'Watch requests flow in',
    description: 'Every call tracked — cost, latency, tokens, model, full trace.',
  },
]

const FEATURES = [
  {
    icon: BarChart3,
    title: 'Cost tracking',
    description: 'Per-request cost breakdown across all providers and models.',
  },
  {
    icon: Zap,
    title: 'Latency monitoring',
    description: 'p50 / p95 latency per model so you can spot regressions instantly.',
  },
  {
    icon: GitBranch,
    title: 'Agent tracing',
    description: 'Visualize multi-step agent flows as Gantt/waterfall span trees.',
  },
  {
    icon: Check,
    title: 'Self-hostable',
    description: 'Run on your own infra with a single Docker command. Your data stays yours.',
  },
]
