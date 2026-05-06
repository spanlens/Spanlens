import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: 'Quick start · Spanlens Docs',
  description:
    'Get up and running with Spanlens in 30 seconds. Two paths: start from scratch (no CLI) or migrate existing OpenAI / Anthropic / Gemini code with one command.',
}

export default function QuickStart() {
  return (
    <div>
      <h1>Quick start</h1>
      <p className="lead">
        Two paths depending on your starting point. Both end with your LLM calls flowing
        through Spanlens and showing up in <a href="/requests">your dashboard</a>.
      </p>

      <h2>Prerequisites</h2>
      <ol>
        <li>A <a href="/signup">Spanlens account</a></li>
        <li>
          A project at <a href="/projects">/projects</a>
        </li>
        <li>
          A <strong>Spanlens key</strong> (<code>sl_live_…</code>) — click{' '}
          <em>+ New Spanlens key</em> on the project card
        </li>
        <li>
          One or more <strong>provider keys</strong> registered under that Spanlens key —
          click <em>+ Add provider key</em> next to it (OpenAI, Anthropic, and/or Gemini)
        </li>
      </ol>
      <p className="text-sm text-muted-foreground">
        One Spanlens key covers every provider key you register under it. You don&apos;t
        need separate keys per provider.
      </p>

      <h2 id="path-a">Path A — Starting from scratch (no CLI)</h2>
      <p>
        If your code doesn&apos;t already call OpenAI / Anthropic / Gemini directly, this
        is the simpler path. Three steps, never run the CLI.
      </p>

      <h3>Step 1 — Install the SDK</h3>
      <CodeBlock language="bash">{`pnpm add @spanlens/sdk
# or: npm install @spanlens/sdk
# or: yarn add @spanlens/sdk`}</CodeBlock>

      <h3>Step 2 — Add the env variable</h3>
      <p>
        Copy the <code>sl_live_…</code> value shown when you issued the Spanlens key
        (it&apos;s only displayed once) and put it in your env file:
      </p>
      <CodeBlock language="env">{`# .env.local
SPANLENS_API_KEY=sl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>

      <h3>Step 3 — Use the helper for each provider you registered</h3>
      <p>
        Each helper is a drop-in replacement for the provider&apos;s normal client — same
        methods, same return types. <code>SPANLENS_API_KEY</code> is read automatically.
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
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
const result = await model.generateContent('Hi')`}</CodeBlock>

      <h3>Adding new providers later — no CLI needed</h3>
      <p>
        Once Steps 1 and 2 are done, adding a second or third provider is just:
      </p>
      <ol>
        <li>Dashboard: <em>+ Add provider key</em> for the new provider</li>
        <li>Code: import + instantiate the matching helper (one of the snippets above)</li>
      </ol>
      <p>
        The dashboard shows you the exact snippet right after you save the provider key,
        so you can copy-paste straight into your project. Your{' '}
        <code>SPANLENS_API_KEY</code> already covers the new provider.
      </p>

      <h2 id="path-b">Path B — Migrating existing OpenAI / Anthropic / Gemini code (CLI)</h2>
      <p>
        If your codebase already has direct calls like{' '}
        <code>new OpenAI(&#123; apiKey: ... &#125;)</code>, the CLI rewrites them in place
        in one pass.
      </p>
      <CodeBlock language="bash">{`npx @spanlens/cli@latest init`}</CodeBlock>

      <p>The wizard:</p>
      <ol>
        <li>Detects your framework (Next.js for now)</li>
        <li>Validates your Spanlens key against the API and lists which providers you have keys registered for</li>
        <li>
          Writes <code>SPANLENS_API_KEY</code> to <code>.env.local</code> (asks before
          overwriting an existing value)
        </li>
        <li>Installs <code>@spanlens/sdk</code> with your package manager</li>
        <li>
          Patches every <code>new OpenAI(...)</code> / <code>new Anthropic(...)</code> /{' '}
          <code>new GoogleGenerativeAI(...)</code> call to the matching{' '}
          <code>createXxx()</code> helper — only for providers you have keys for
        </li>
        <li>Runs <code>tsc --noEmit</code> to verify the patch compiles</li>
      </ol>

      <p>Then deploy:</p>
      <ol>
        <li>Add <code>SPANLENS_API_KEY</code> to your production env (Vercel / Railway / Fly)</li>
        <li>Redeploy — new env values don&apos;t apply to existing deployments</li>
      </ol>

      <p className="text-sm text-muted-foreground">
        Preview the changes before applying:{' '}
        <code>npx @spanlens/cli init --dry-run</code>
      </p>

      <h3>When does the CLI need to run again?</h3>
      <p>
        Almost never. Once a file is patched it stays patched — rotating, adding, or
        deactivating provider keys in the dashboard doesn&apos;t require a re-run. The
        only time you re-run is when:
      </p>
      <ul>
        <li>
          You add a <em>new provider type</em> (e.g. you had OpenAI before, now you&apos;re
          adding Anthropic) <strong>and</strong> your codebase still has direct{' '}
          <code>new Anthropic(...)</code> calls. Otherwise just write the helper directly
          using the snippet from Path A.
        </li>
      </ul>

      <h2 id="verify">Verify it works</h2>
      <p>
        Make any LLM call from your app, then visit <a href="/requests">/requests</a>. A
        new row should appear within a few seconds with:
      </p>
      <ul>
        <li>
          The model actually used (OpenAI returns dated variants like{' '}
          <code>gpt-4o-mini-2024-07-18</code>)
        </li>
        <li>Prompt / completion / total tokens</li>
        <li>Cost in USD</li>
        <li>Latency in milliseconds</li>
        <li>Full request + response bodies (up to 10 KB)</li>
      </ul>

      <h2>What about /traces?</h2>
      <p>
        The proxy setup above populates <a href="/requests">/requests</a> only —{' '}
        <a href="/traces">/traces</a> will be empty. That&apos;s expected.
      </p>
      <p>
        Traces require explicit instrumentation: wrap your async functions with{' '}
        <code>observe()</code> from the SDK so Spanlens can group related LLM calls into a
        tree. Without that wrapper, each call is logged as an independent request with no
        parent trace.
      </p>
      <p>
        See the <a href="/docs/sdk">SDK reference</a> to add tracing in a few lines — or
        jump straight to <a href="/docs/features/traces">how traces work</a> if you want to
        understand the model first.
      </p>

      <h2>Troubleshooting</h2>

      <h3>Request not showing up in /requests</h3>
      <ol>
        <li>
          Confirm <code>SPANLENS_API_KEY</code> is set in <em>both</em>{' '}
          <code>.env.local</code> AND your deployment environment
        </li>
        <li>After adding env vars in Vercel, <strong>redeploy</strong> — new values don&apos;t apply retroactively</li>
        <li>
          Check the Network tab — your request should hit{' '}
          <code>server.spanlens.io/proxy/*</code>, not{' '}
          <code>api.openai.com</code> directly
        </li>
      </ol>

      <h3>400 &ldquo;No active provider key registered for this Spanlens key&rdquo;</h3>
      <p>
        You called a provider you haven&apos;t registered yet. Open{' '}
        <a href="/projects">/projects</a>, find the Spanlens key, and click{' '}
        <em>+ Add provider key</em> — pick the matching provider (OpenAI / Anthropic /
        Gemini) and paste your AI key.
      </p>

      <h3>401 &ldquo;Incorrect API key&rdquo;</h3>
      <p>
        Either <code>SPANLENS_API_KEY</code> is missing in the runtime, or you&apos;re
        still constructing the upstream client directly (<code>new OpenAI(...)</code>) and
        passing the wrong <code>baseURL</code>. The simplest fix is to use the SDK helper
        — <code>createOpenAI()</code> sets both <code>apiKey</code> and{' '}
        <code>baseURL</code> for you.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/sdk">SDK reference</a> for agent tracing and advanced usage,
        or <a href="/docs/proxy">direct proxy</a> for non-Node environments.
      </p>
    </div>
  )
}
