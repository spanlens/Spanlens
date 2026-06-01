import Link from 'next/link'
import { ArrowRight, Zap, Code, Globe, Server, Activity } from 'lucide-react'
import { QuickTabs } from './_components/quick-tabs'

export const metadata = {
  title: 'Spanlens Docs',
  description:
    'Integrate drop-in LLM observability for OpenAI, Anthropic, and Gemini in 30 seconds. SDK reference, proxy API, OpenTelemetry, and self-hosting guides.',
  alternates: { canonical: '/docs' },
}

const TS_SNIPPET = `import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI() // reads SPANLENS_API_KEY from env

const res = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
})`

const PY_SNIPPET = `from spanlens.integrations.openai import create_openai

client = create_openai()  # reads SPANLENS_API_KEY from env

res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hi"}],
)`

const CURL_SNIPPET = `curl https://server.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hi"}]
  }'`

export default function DocsIndex() {
  return (
    <div className="not-prose">
      <h1 className="text-4xl font-bold tracking-tight mb-3">Spanlens Docs</h1>
      <p className="text-lg text-muted-foreground mb-8">
        LLM observability in 60 seconds. Record every OpenAI, Anthropic, and Gemini call with cost,
        latency, full request/response, agent traces, PII detection, and cheaper-model suggestions.
      </p>

      <p className="text-xs text-muted-foreground mb-2 font-mono uppercase tracking-wide">
        Drop this into your app
      </p>
      <QuickTabs
        tabs={[
          { key: 'ts', label: 'TypeScript', language: 'ts', code: TS_SNIPPET },
          { key: 'py', label: 'Python', language: 'python', code: PY_SNIPPET },
          { key: 'curl', label: 'cURL', language: 'bash', code: CURL_SNIPPET },
        ]}
      />
      <p className="text-sm text-muted-foreground -mt-2 mb-10">
        Already have OpenAI / Anthropic / Gemini calls in your code?{' '}
        <code className="text-xs bg-bg-elev rounded px-1 py-0.5 border border-border">npx @spanlens/cli init</code>{' '}
        rewrites them in one pass. See the{' '}
        <Link href="/docs/quick-start" className="text-accent hover:underline">
          Quick start
        </Link>{' '}
        for both paths.
      </p>

      <h2 className="text-xl font-semibold mb-4">What&apos;s in the docs</h2>
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

      <h2 className="text-xl font-semibold mb-4">Frequently asked</h2>
      <div className="space-y-4 text-sm">
        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">
            Does Spanlens add latency to my requests?
          </summary>
          <p className="mt-2 text-muted-foreground">
            Typical overhead is 10–50ms per call, a thin pass-through proxy. Your requests flow to OpenAI / Anthropic / Gemini and responses stream back. Logging is fire-and-forget via Vercel&apos;s{' '}
            <code className="text-xs bg-bg-elev rounded px-1">waitUntil</code>, so it never blocks the response.
          </p>
        </details>

        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">Is my provider key safe?</summary>
          <p className="mt-2 text-muted-foreground">
            Yes. Provider keys are AES-256-GCM encrypted at rest in your Supabase. They&apos;re only decrypted in memory when forwarding a request, never logged. For extra control,{' '}
            <Link href="/docs/self-host" className="text-accent hover:underline">self-host</Link>.
          </p>
        </details>

        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">
            Can I run Spanlens alongside my existing Langfuse / Helicone setup?
          </summary>
          <p className="mt-2 text-muted-foreground">
            Yes. Spanlens is a drop-in replacement at the baseURL level. Keep both running side-by-side during migration, then turn the other off.{' '}
            <Link href="/docs/why" className="text-accent hover:underline">Why Spanlens vs Helicone / Langfuse →</Link>
          </p>
        </details>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        Looking for{' '}
        <Link href="/privacy" className="text-accent hover:underline">Privacy</Link>,{' '}
        <Link href="/terms" className="text-accent hover:underline">Terms</Link>,{' '}
        <Link href="/dpa" className="text-accent hover:underline">DPA</Link>, or{' '}
        <Link href="/subprocessors" className="text-accent hover:underline">Subprocessors</Link>? All four
        live in the footer of every page. For a countersigned DPA or a security questionnaire, email{' '}
        <a href="mailto:support@spanlens.io" className="text-accent hover:underline">support@spanlens.io</a>.
      </p>
    </div>
  )
}

const SECTIONS = [
  {
    icon: Zap,
    title: 'Quick start',
    href: '/docs/quick-start',
    description: '30-second wizard setup or manual integration in two lines of code.',
  },
  {
    icon: Code,
    title: '@spanlens/sdk',
    href: '/docs/sdk',
    description: 'TypeScript and Python SDK reference: createOpenAI, observe, span helpers, trace API.',
  },
  {
    icon: Globe,
    title: 'Direct proxy (any language)',
    href: '/docs/proxy',
    description: 'Use Python, Ruby, Go, or raw HTTP. Just swap the base URL.',
  },
  {
    icon: Activity,
    title: 'OpenTelemetry (OTLP)',
    href: '/docs/otel',
    description: 'Already using an OTel SDK? Point it at Spanlens. Python, Go, Java, Node.js all work.',
  },
  {
    icon: Server,
    title: 'Self-hosting',
    href: '/docs/self-host',
    description: 'Run Spanlens on your own infra with one Docker command. Your data stays yours.',
  },
]
