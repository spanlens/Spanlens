import Link from 'next/link'
import { Zap, BarChart3, GitBranch, DollarSign, ArrowRight, Check } from 'lucide-react'
import { AuthNavButtons } from '@/components/layout/auth-nav-buttons'
import { Footer } from '@/components/layout/footer'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg">
      {/* Nav */}
      <nav className="border-b border-border px-6 h-[56px] flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-accent" strokeWidth={2.5} />
          <span className="font-semibold text-[16px] text-text tracking-[-0.3px]">Spanlens</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/pricing"
            className="text-[13px] text-text-muted hover:text-text transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/docs"
            className="text-[13px] text-text-muted hover:text-text transition-colors"
          >
            Docs
          </Link>
          <AuthNavButtons signupLabel="Get started free" />
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-elev px-3 py-1 text-[12px] text-text-muted mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-good inline-block" />
          Open source · Self-hostable · No vendor lock-in
        </div>
        <h1 className="text-[52px] font-bold tracking-[-1.5px] text-text text-balance mb-6 leading-[1.1]">
          LLM observability in{' '}
          <span className="text-accent">30 seconds</span>
        </h1>
        <p className="text-[18px] text-text-muted max-w-2xl mx-auto mb-10 text-balance leading-relaxed">
          One command installs the SDK, rewrites your OpenAI client, and routes every request
          through Spanlens — with full cost, latency, and agent tracing.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[8px] bg-text text-bg text-[14px] font-medium hover:opacity-90 transition-opacity"
          >
            Start for free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center px-5 py-2.5 rounded-[8px] border border-border bg-bg-elev text-[14px] font-medium text-text hover:border-border-strong transition-colors"
          >
            View pricing
          </Link>
        </div>

        {/* Code snippet */}
        <div className="mt-16 rounded-xl border border-border bg-[#1a1816] p-6 text-left max-w-xl mx-auto">
          <p className="font-mono text-[10.5px] text-[#7c7770] mb-3 uppercase tracking-[0.05em]">
            Run in your Next.js project
          </p>
          <pre className="font-mono text-[14px] text-good">npx @spanlens/cli init</pre>
          <p className="font-mono text-[10.5px] text-[#5c5752] mt-4 leading-relaxed">
            Auto-installs{' '}
            <span className="text-[#9c9690]">@spanlens/sdk</span>, updates{' '}
            <span className="text-[#9c9690]">.env.local</span>, and rewrites your{' '}
            <span className="text-[#9c9690]">new OpenAI(…)</span> calls to route through Spanlens.
          </p>
          <p className="font-mono text-[10.5px] text-[#5c5752] mt-2">
            Prefer manual?{' '}
            <span className="text-[#9c9690]">npm i @spanlens/sdk</span> + 2 lines of code.{' '}
            <Link href="/signup" className="text-accent hover:opacity-80 transition-opacity underline">
              See snippet
            </Link>
          </p>
        </div>
      </section>

      {/* 3-step section */}
      <section className="border-t border-border bg-bg-elev py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-[30px] font-bold text-text text-center mb-3 tracking-[-0.5px]">
            Up in 30 seconds
          </h2>
          <p className="text-center text-[14px] text-text-muted mb-12">
            Sign up, paste your API key once, run{' '}
            <code className="font-mono text-[13px] bg-bg border border-border px-1.5 py-0.5 rounded-[4px]">
              npx @spanlens/cli init
            </code>{' '}
            — done.
          </p>
          <div className="grid grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg font-bold text-[15px] mb-4">
                  {i + 1}
                </div>
                <s.icon className="h-6 w-6 text-accent mb-3" />
                <h3 className="font-semibold text-[15px] text-text mb-2">{s.title}</h3>
                <p className="text-[13px] text-text-muted leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-[30px] font-bold text-text text-center mb-12 tracking-[-0.5px]">
            Everything you need
          </h2>
          <div className="grid grid-cols-2 gap-5">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-bg-elev p-6 hover:border-border-strong transition-colors"
              >
                <f.icon className="h-5 w-5 text-accent mb-3" />
                <h3 className="font-semibold text-[15px] text-text mb-2">{f.title}</h3>
                <p className="text-[13px] text-text-muted leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-accent py-16 text-center">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-[28px] font-bold text-bg mb-4 tracking-[-0.5px]">
            Start observing your LLM calls today
          </h2>
          <p className="text-[14px] text-bg/70 mb-8">
            Free plan includes 10,000 requests/month. No credit card required.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-[8px] bg-bg text-accent text-[14px] font-semibold hover:opacity-90 transition-opacity"
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  )
}

const STEPS = [
  {
    icon: DollarSign,
    title: 'Sign up + register provider keys',
    description:
      'Paste your OpenAI / Anthropic / Gemini key. We encrypt at rest with AES-256-GCM.',
  },
  {
    icon: GitBranch,
    title: 'Run the wizard',
    description:
      'npx @spanlens/cli init — installs the SDK, sets up env, rewrites your OpenAI client.',
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
