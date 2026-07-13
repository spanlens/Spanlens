import { CodeBlock } from '../_components/code-block'
import { QuickStartFlowDiagram } from '../_components/diagrams'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/quick-start' },
  title: 'Quick start · Spanlens Docs',
  description:
    'Get up and running with Spanlens in 30 seconds. Migrate existing OpenAI, Anthropic, or Gemini code with one command, or set up manually in four steps.',
}

export default function QuickStart() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Quick start</h1>
      <p className="lead">
        Two ways to get your LLM calls flowing through Spanlens and showing up in{' '}
        <a href="/requests">your dashboard</a>. If your code already calls OpenAI, Anthropic, or
        Gemini directly, the CLI wires everything up in one command. Otherwise the manual path
        takes four steps.
      </p>

      <h2 id="path-b">One command setup for existing code (CLI)</h2>
      <p>
        If your codebase already has direct calls like{' '}
        <code>new OpenAI(&#123; apiKey: ... &#125;)</code>, the CLI rewrites them in place in one
        pass. Run it from your app root:
      </p>
      <CodeBlock language="bash">{`npx @spanlens/cli@latest init`}</CodeBlock>
      <p>
        Before you run it, set up three things at <a href="/projects">/projects</a>: a project, a
        Spanlens key (<em>+ New Spanlens key</em>, the <code>sl_live_…</code> value is shown once,
        so save it), and at least one provider key registered under that Spanlens key. The wizard
        prompts you to paste the Spanlens key and automates the rest.
      </p>

      <p>Here is exactly what it does to your project:</p>
      <ol>
        <li>Detects your framework (Next.js for now)</li>
        <li>Validates your Spanlens key against the API and lists which providers you have keys registered for</li>
        <li>
          Writes <code>SPANLENS_API_KEY</code> to <code>.env.local</code> (asks before overwriting an existing value)
        </li>
        <li>Installs <code>@spanlens/sdk</code> with your package manager</li>
        <li>
          Patches every <code>new OpenAI(...)</code> / <code>new Anthropic(...)</code> /{' '}
          <code>new GoogleGenerativeAI(...)</code> call to the matching{' '}
          <code>createXxx()</code> helper, only for providers you have keys for
        </li>
        <li>Runs <code>tsc --noEmit</code> to verify the patch compiles</li>
      </ol>
      <p className="text-sm text-muted-foreground">
        Want to see the changes before anything is written? Run{' '}
        <code>npx @spanlens/cli init --dry-run</code>. Self-hosting? Add{' '}
        <code>--server-url https://spanlens.yourcompany.com</code> to point the wizard at your own
        instance instead of spanlens.io.
      </p>

      <p>Then deploy:</p>
      <ol>
        <li>Add <code>SPANLENS_API_KEY</code> to your production env (Vercel / Railway / Fly)</li>
        <li>Redeploy, because new env values don&apos;t apply to existing deployments</li>
      </ol>

      <h3>When does the CLI need to run again?</h3>
      <p>
        Almost never. Once a file is patched it stays patched. Rotating, adding, or deactivating
        provider keys in the dashboard doesn&apos;t require a re-run. The only time you re-run is
        when:
      </p>
      <ul>
        <li>
          You add a <em>new provider type</em> (e.g. you had OpenAI before, now you&apos;re
          adding Anthropic) <strong>and</strong> your codebase still has direct{' '}
          <code>new Anthropic(...)</code> calls. Otherwise just write the helper directly
          using the snippet from the manual path below.
        </li>
      </ul>

      <h2 id="path-a">Manual setup in four steps</h2>
      <p>
        Starting from scratch, or your code doesn&apos;t call a provider directly yet? Four steps,
        never run the CLI.
      </p>

      <h3>Step 1: Create your keys at /projects</h3>
      <ol>
        <li><a className="underline" href="/signup">Sign up</a> and create a project at <a className="underline" href="/projects">/projects</a>.</li>
        <li>Click <em>+ New Spanlens key</em> on the project card. You&apos;ll get a <code>sl_live_…</code> value shown once, so save it now.</li>
        <li>Click <em>+ Add provider key</em> next to the Spanlens key and paste your real OpenAI / Anthropic / Gemini key.</li>
      </ol>
      <p>
        One Spanlens key covers every provider key you register under it. You don&apos;t need
        separate keys per provider.
      </p>

      <h3>Step 2: Add the env variable</h3>
      <p>
        Put the <code>sl_live_…</code> value you saved in Step 1 into your env file:
      </p>
      <CodeBlock language="env">{`# .env.local
SPANLENS_API_KEY=sl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>

      <h3>Step 3: Install the SDK</h3>
      <CodeBlock language="bash">{`pnpm add @spanlens/sdk
# or: npm install @spanlens/sdk
# or: yarn add @spanlens/sdk`}</CodeBlock>

      <h3>Step 4: Use the helper for each provider you registered</h3>
      <p>
        Each helper is a drop-in replacement for the provider&apos;s normal client: same methods,
        same return types. <code>SPANLENS_API_KEY</code> is read automatically.
      </p>

      <h4>OpenAI</h4>
      <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI()

const res = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
})`}</CodeBlock>

      <h4>Anthropic</h4>
      <CodeBlock language="ts">{`import { createAnthropic } from '@spanlens/sdk/anthropic'

const anthropic = createAnthropic()

const msg = await anthropic.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }],
})`}</CodeBlock>

      <h4>Gemini</h4>
      <CodeBlock language="ts">{`import { createGemini } from '@spanlens/sdk/gemini'

const genAI = createGemini()
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
const result = await model.generateContent('Hi')`}</CodeBlock>

      <QuickStartFlowDiagram />

      <h3 id="frameworks">Using LangChain, LangGraph, Vercel AI SDK, or LlamaIndex?</h3>
      <p>
        Skip the per-provider helpers above and use a single callback handler instead. It captures
        LLM, chain, tool, and retriever spans automatically (including the full LangGraph node
        topology). See{' '}
        <a className="underline" href="/docs/sdk#framework-integrations">framework integrations</a>{' '}
        for the per-framework snippet.
      </p>

      <h3>Adding new providers later (no CLI needed)</h3>
      <p>
        Once Steps 2 and 3 are done (env variable set, SDK installed), adding a second or third
        provider is just:
      </p>
      <ol>
        <li>Dashboard: <em>+ Add provider key</em> for the new provider</li>
        <li>Code: import + instantiate the matching helper (one of the snippets above)</li>
      </ol>
      <p>
        The dashboard shows you the exact snippet right after you save the provider key, so you can
        copy-paste straight into your project. Your <code>SPANLENS_API_KEY</code> already covers the
        new provider.
      </p>

      <h2 id="verify">Verify it works</h2>
      <p>
        Make any LLM call from your app, then visit <a href="/requests">/requests</a>. A new row
        should appear within a few seconds with model, tokens, cost, latency, and the full request /
        response bodies.
      </p>

      <figure className="not-prose my-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/docs/verify-requests.png"
          alt="Spanlens requests dashboard listing logged LLM calls with model, latency, tokens, and cost"
          width={1536}
          height={758}
          className="w-full h-auto rounded-lg border border-border shadow-sm"
          loading="lazy"
        />
        <figcaption className="mt-2 text-xs text-muted-foreground text-center">
          Your <code>/requests</code> page after the first call. Filter by model / status, click any row for the full body + traces.
        </figcaption>
      </figure>

      <h2 id="tracing">What about /traces?</h2>
      <p>
        The proxy setup above populates <a href="/requests">/requests</a> only, so{' '}
        <a href="/traces">/traces</a> will be empty. That&apos;s expected.
      </p>
      <p>
        Traces require explicit instrumentation: wrap your async functions with{' '}
        <code>observe()</code> from the SDK so Spanlens can group related LLM calls into a tree.
        Without that wrapper, each call is logged as an independent request with no parent trace.
      </p>
      <p>
        See the <a href="/docs/sdk">SDK reference</a> to add tracing in a few lines, or jump
        straight to <a href="/docs/features/traces">how traces work</a> if you want to understand
        the model first.
      </p>

      <h2>Troubleshooting</h2>

      <h3>Request not showing up in /requests</h3>
      <ol>
        <li>
          Confirm <code>SPANLENS_API_KEY</code> is set in <em>both</em>{' '}
          <code>.env.local</code> AND your deployment environment
        </li>
        <li>After adding env vars in Vercel, <strong>redeploy</strong>, because new values don&apos;t apply retroactively</li>
        <li>
          Check the Network tab. Your request should hit{' '}
          <code>api.spanlens.io/proxy/*</code>, not <code>api.openai.com</code> directly
        </li>
      </ol>

      <h3>400 &ldquo;No active provider key registered for this Spanlens key&rdquo;</h3>
      <p>
        You called a provider you haven&apos;t registered yet. Open{' '}
        <a href="/projects">/projects</a>, find the Spanlens key, and click{' '}
        <em>+ Add provider key</em>. Pick the matching provider (OpenAI / Anthropic / Gemini) and
        paste your AI key.
      </p>

      <h3>401 &ldquo;Incorrect API key&rdquo;</h3>
      <p>
        Either <code>SPANLENS_API_KEY</code> is missing in the runtime, or you&apos;re still
        constructing the upstream client directly (<code>new OpenAI(...)</code>) and passing the
        wrong <code>baseURL</code>. The simplest fix is to use the SDK helper:{' '}
        <code>createOpenAI()</code> sets both <code>apiKey</code> and <code>baseURL</code> for you.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/sdk">SDK reference</a> for agent tracing and advanced usage, or{' '}
        <a href="/docs/proxy">direct proxy</a> for non-Node environments.
      </p>
    </div>
  )
}
