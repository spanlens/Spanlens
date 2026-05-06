import Link from 'next/link'
import { ArrowRight, Zap, Code, Globe, Server, Activity } from 'lucide-react'
import { CodeBlock } from './_components/code-block'

export const metadata = {
  title: 'Spanlens Docs',
  description: 'LLM observability in 30 seconds. Everything you need to integrate Spanlens into your app.',
}

export default function DocsIndex() {
  return (
    <div className="not-prose">
      <h1 className="text-4xl font-bold tracking-tight mb-3">Spanlens Docs</h1>
      <p className="text-lg text-muted-foreground mb-10">
        LLM observability — cost tracking, agent tracing, PII + prompt-injection detection, and model recommendations for OpenAI / Anthropic / Gemini calls.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-xl border border-border bg-bg-elev p-5 hover:border-border-strong hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-2 mb-2">
              <s.icon className="h-5 w-5 text-accent" />
              <h3 className="font-semibold group-hover:text-accent">{s.title}</h3>
              <ArrowRight className="h-4 w-4 text-border group-hover:text-accent group-hover:translate-x-0.5 transition-all ml-auto" />
            </div>
            <p className="text-sm text-muted-foreground">{s.description}</p>
          </Link>
        ))}
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-2 font-mono">Get started in 30 seconds</p>
        <CodeBlock language="bash">{`npx @spanlens/cli init`}</CodeBlock>
      </div>

      <h2 className="text-2xl font-bold mt-12 mb-4">Common questions</h2>
      <div className="space-y-4 text-sm">
        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">
            Does Spanlens add latency to my requests?
          </summary>
          <p className="mt-2 text-muted-foreground">
            Typical overhead is 10–50ms per call — a thin pass-through proxy. Your requests flow to OpenAI / Anthropic / Gemini; responses stream back. Logging is fire-and-forget via Vercel&apos;s{' '}
            <code className="text-xs bg-bg-elev rounded px-1">waitUntil</code>, so it never blocks the response.
          </p>
        </details>

        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">Is my provider key safe?</summary>
          <p className="mt-2 text-muted-foreground">
            Yes. Provider keys are AES-256-GCM encrypted at rest in your Supabase. They&apos;re only decrypted in memory when forwarding a request, never logged. For extra control, self-host.
          </p>
        </details>

        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">
            Can I use Spanlens with my existing Langfuse / Helicone setup?
          </summary>
          <p className="mt-2 text-muted-foreground">
            Yes — Spanlens is a drop-in replacement at the baseURL level. You can keep both running side-by-side during migration.
          </p>
        </details>

        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">
            What providers are supported?
          </summary>
          <p className="mt-2 text-muted-foreground">
            OpenAI, Anthropic, and Google Gemini — including streaming responses. We match the upstream API 1:1, so any SDK that talks to those providers works.
          </p>
        </details>
      </div>
    </div>
  )
}

const SECTIONS = [
  {
    icon: Zap,
    title: 'Quick start',
    href: '/docs/quick-start',
    description: '30-second wizard setup or manual integration in 2 lines of code.',
  },
  {
    icon: Code,
    title: '@spanlens/sdk',
    href: '/docs/sdk',
    description: 'TypeScript SDK reference — createOpenAI, observe, span helpers, trace API.',
  },
  {
    icon: Globe,
    title: 'Direct proxy (any language)',
    href: '/docs/proxy',
    description: 'Use Python, Ruby, Go, or raw HTTP — just swap the base URL.',
  },
  {
    icon: Activity,
    title: 'OpenTelemetry (OTLP)',
    href: '/docs/otel',
    description: 'Already using an OTel SDK? Point it at Spanlens — Python, Go, Java, Node.js all work.',
  },
  {
    icon: Server,
    title: 'Self-hosting',
    href: '/docs/self-host',
    description: 'Run Spanlens on your own infra with one Docker command. Your data stays yours.',
  },
]
