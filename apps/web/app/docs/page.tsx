import { openGraphFor } from '@/lib/page-metadata'
import Link from 'next/link'
import { ArrowRight, Zap, Code, Globe, Server, Activity, Terminal } from 'lucide-react'
import { QuickTabs } from './_components/quick-tabs'

export const metadata = {
  title: 'Spanlens Docs · Open Source LLM Observability',
  description:
    'Integrate drop-in LLM observability for OpenAI, Anthropic, and Gemini in 30 seconds. SDK reference, proxy API, OpenTelemetry, and self-hosting guides.',
  alternates: { canonical: '/docs' },
  openGraph: openGraphFor('/docs'),
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

const CURL_SNIPPET = `curl https://api.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hi"}]
  }'`

export default function DocsIndex() {
  return (
    <div className="not-prose">
      <h1 className="font-display track-h2 mb-4 text-[38px] leading-[1.1] text-text">Spanlens Docs</h1>
      <p className="mb-9 max-w-[660px] text-[16px] leading-[1.7] text-text-muted">
        LLM observability in 60 seconds. Record every OpenAI, Anthropic, and Gemini call with cost,
        latency, full request/response, agent traces, PII detection, and cheaper-model suggestions.
      </p>

      <p className="eyebrow mb-2">Drop this into your app</p>
      <QuickTabs
        tabs={[
          { key: 'ts', label: 'TypeScript', language: 'ts', code: TS_SNIPPET },
          { key: 'py', label: 'Python', language: 'python', code: PY_SNIPPET },
          { key: 'curl', label: 'cURL', language: 'bash', code: CURL_SNIPPET },
        ]}
      />
      <p className="-mt-2 mb-12 text-[14.5px] leading-[1.75] text-text-muted">
        Already have OpenAI / Anthropic / Gemini calls in your code?{' '}
        <code className="rounded border border-border bg-bg-sunk px-1 py-0.5 text-xs">npx @spanlens/cli init</code>{' '}
        rewrites them in one pass. See the{' '}
        <Link href="/docs/quick-start" className="text-accent hover:underline">
          Quick start
        </Link>{' '}
        for both paths.
      </p>

      <h2 className="font-display track-quote mb-4 text-[20px] text-text">What&apos;s in the docs</h2>
      {/* First card carries the accent tint: the entry point is the one route
          a first-time reader should take, so it is the only one weighted. */}
      <div className="mb-12 grid grid-cols-1 gap-4 md:grid-cols-2">
        {SECTIONS.map((s, i) => (
          <Link
            key={s.href}
            href={s.href}
            className={
              'group rounded-lg border p-5 transition-colors ' +
              (i === 0
                ? 'border-accent-border bg-accent-bg'
                : 'border-border bg-bg-elev hover:border-border-strong')
            }
          >
            <div className="mb-2 flex items-center gap-2">
              <s.icon className="h-4 w-4 text-accent" />
              <h3 className={'text-[15px] font-semibold ' + (i === 0 ? 'text-accent' : 'text-text')}>
                {s.title}
              </h3>
              <ArrowRight className="ml-auto h-4 w-4 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
            </div>
            <p className="text-[12.5px] leading-relaxed text-text-muted">{s.description}</p>
          </Link>
        ))}
      </div>

      <h2 className="font-display track-quote mb-4 text-[20px] text-text">Frequently asked</h2>
      <div className="space-y-3 text-sm">
        <details className="rounded-lg border border-border bg-bg-elev p-5">
          <summary className="cursor-pointer list-none text-[14px] font-medium text-text">
            Does Spanlens add latency to my requests?
          </summary>
          <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
            Typical overhead is 10–50ms per call, a thin pass-through proxy. Your requests flow to OpenAI / Anthropic / Gemini and responses stream back. Logging is fire-and-forget via Vercel&apos;s{' '}
            <code className="text-xs bg-bg-sunk rounded px-1">waitUntil</code>, so it never blocks the response.
          </p>
        </details>

        <details className="rounded-lg border border-border bg-bg-elev p-5">
          <summary className="cursor-pointer list-none text-[14px] font-medium text-text">
            Is my provider key safe?
          </summary>
          <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
            Yes. Provider keys are AES-256-GCM encrypted at rest in your Supabase. They&apos;re only decrypted in memory when forwarding a request, never logged. For extra control,{' '}
            <Link href="/docs/self-host" className="text-accent hover:underline">self-host</Link>.
          </p>
        </details>

        <details className="rounded-lg border border-border bg-bg-elev p-5">
          <summary className="cursor-pointer list-none text-[14px] font-medium text-text">
            Can I run Spanlens alongside my existing Langfuse / Helicone setup?
          </summary>
          <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
            Yes. Spanlens is a drop-in replacement at the baseURL level. Keep both running side-by-side during migration, then turn the other off.{' '}
            <Link href="/docs/why" className="text-accent hover:underline">Why Spanlens vs Helicone / Langfuse →</Link>
          </p>
        </details>
      </div>

      <p className="mt-10 text-[13px] leading-relaxed text-text-muted">
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
    icon: Terminal,
    title: '@spanlens/cli',
    href: '/docs/cli',
    description: 'One-command setup: AST-rewrites every OpenAI / Anthropic / Gemini call to use Spanlens. Dry-run safe.',
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
