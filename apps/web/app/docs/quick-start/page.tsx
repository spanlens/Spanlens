import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: 'Quick start · Spanlens Docs',
  description: 'Get up and running with Spanlens in 30 seconds using the CLI wizard, or 2 lines of code manually.',
}

export default function QuickStart() {
  return (
    <div>
      <h1>Quick start</h1>
      <p className="lead">
        Two paths depending on your stack. Both take about 30 seconds and produce the same result —
        your LLM calls flow through Spanlens and show up in{' '}
        <a href="/requests">your dashboard</a>.
      </p>

      <h2>Prerequisites</h2>
      <ol>
        <li>A <a href="/signup">Spanlens account</a></li>
        <li>A Project + API key (created in <a href="/projects">/projects</a>)</li>
        <li>Your provider key(s) registered in <a href="/settings">/settings</a> — OpenAI, Anthropic, Gemini</li>
      </ol>

      <h2 id="wizard">Path A — CLI wizard (Next.js, recommended)</h2>
      <p>
        In your Next.js project root:
      </p>
      <CodeBlock language="bash">{`npx @spanlens/cli init`}</CodeBlock>

      <p>The wizard will:</p>
      <ol>
        <li>Detect your framework + package manager</li>
        <li>Ask for your Spanlens API key (one-time paste)</li>
        <li>Write <code>SPANLENS_API_KEY</code> to <code>.env.local</code></li>
        <li>Install <code>@spanlens/sdk</code> with your package manager</li>
        <li>Scan your codebase for <code>new OpenAI(&#123;...&#125;)</code> calls and rewrite each into <code>createOpenAI()</code></li>
      </ol>

      <p>Then just:</p>
      <ol>
        <li>Add <code>SPANLENS_API_KEY</code> to your production env (Vercel / Railway / Fly)</li>
        <li>Redeploy</li>
      </ol>

      <p className="text-sm text-muted-foreground">
        Preview the changes before applying: <code>npx @spanlens/cli init --dry-run</code>
      </p>

      <h2 id="manual">Path B — Manual (any TypeScript / JavaScript project)</h2>

      <h3>Step 1 — Install the SDK</h3>
      <CodeBlock language="bash">{`npm install @spanlens/sdk
# or
pnpm add @spanlens/sdk`}</CodeBlock>

      <h3>Step 2 — Add environment variable</h3>
      <p>
        Copy your Spanlens API key from <a href="/projects">the dashboard</a> and add it to your env file:
      </p>
      <CodeBlock language="env">{`# .env.local
SPANLENS_API_KEY=sl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>

      <h3>Step 3 — Use the pre-configured client helpers</h3>

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
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hi' }],
})`}</CodeBlock>

      <h4>Gemini</h4>
      <CodeBlock language="ts">{`import { createGemini } from '@spanlens/sdk/gemini'

const genAI = createGemini()
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
const result = await model.generateContent('Hi')`}</CodeBlock>

      <h2 id="verify">Verify it works</h2>
      <p>
        Run any LLM call through the configured client, then visit <a href="/requests">/requests</a>.
        A new row should appear within a few seconds with:
      </p>
      <ul>
        <li>The model actually used (OpenAI returns dated variants like <code>gpt-4o-mini-2024-07-18</code>)</li>
        <li>Prompt / completion / total tokens</li>
        <li>Cost in USD</li>
        <li>Latency in ms</li>
        <li>Full request + response bodies (up to 10KB)</li>
      </ul>

      <h2>Troubleshooting</h2>

      <h3>Request not showing up in /requests</h3>
      <ol>
        <li>Confirm <code>SPANLENS_API_KEY</code> is set in <em>both</em> <code>.env.local</code> AND your deployment env</li>
        <li>After adding env vars to Vercel, <strong>redeploy</strong> — new env values don&apos;t apply to existing deployments</li>
        <li>Check the Network tab — your request should hit <code>spanlens-server.vercel.app/proxy/*</code>, not <code>api.openai.com</code> directly</li>
      </ol>

      <h3>Getting &ldquo;401 Incorrect API key&rdquo;</h3>
      <p>
        You probably replaced <code>apiKey</code> but forgot to set <code>baseURL</code>. Use{' '}
        <code>createOpenAI()</code> — it sets both for you.
      </p>

      <h3>Getting mock data instead of real LLM responses</h3>
      <p>
        Some apps fall back to mock responses when <code>SPANLENS_API_KEY</code> is missing. Double-check
        the env var is actually present at runtime: <code>console.log(!!process.env.SPANLENS_API_KEY)</code>.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Next: see the <a href="/docs/sdk">SDK reference</a> for agent tracing and advanced usage, or{' '}
        <a href="/docs/proxy">direct proxy</a> for non-Node environments.
      </p>
    </div>
  )
}
