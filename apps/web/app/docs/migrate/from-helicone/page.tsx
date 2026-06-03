import { CodeBlock } from '../../_components/code-block'
import { LangTabs } from '../../_components/lang-tabs'

export const metadata = {
  title: 'Migrate from Helicone to Spanlens · 2026 Guide',
  description:
    'Move from Helicone to Spanlens in under 15 minutes. Base URL swap, properties to user / session mapping, and what to do about the AI Gateway features.',
  alternates: { canonical: '/docs/migrate/from-helicone' },
}

export default function MigrateFromHelicone() {
  return (
    <div>
      <h1>Migrate from Helicone · 2026</h1>
      <p className="lead">
        Helicone and Spanlens share the same fundamental shape: a proxy that you point your
        provider SDK at. The migration is mostly a base URL swap. The interesting question
        is what happens to the gateway features Helicone wraps around the proxy. This page
        covers both.
      </p>

      <h2>Why teams switch</h2>
      <ul>
        <li>
          <strong>Critical-path tracing built in.</strong> Spanlens identifies the longest
          chain in a multi-step agent so you know which span to optimize. Helicone has the
          waterfall view but no critical-path marker.
        </li>
        <li>
          <strong>Prompt versioning and A/B testing.</strong> Spanlens ships a statistical
          A/B comparison for prompt versions out of the box, including significance tests.
          Helicone tracks prompt versions but does not test them statistically.
        </li>
        <li>
          <strong>MIT-licensed self-host.</strong> Spanlens publishes a Docker image and a
          single SQL file (<code>supabase/init.sql</code>). Self-hosting Helicone is more
          involved.
        </li>
        <li>
          <strong>EU and KR-friendly data residency.</strong> Self-host to keep all bodies
          in your region.
        </li>
      </ul>

      <h2>Step 1. Install the Spanlens SDK (optional but recommended)</h2>
      <p>
        Helicone is proxy-only by default. Spanlens has the same proxy, plus a small SDK
        that adds tracing helpers and per-call headers. Both work; pick based on whether
        you want the extras.
      </p>
      <LangTabs
        ts={`pnpm add @spanlens/sdk
# or skip the SDK and stay with the raw OpenAI client (Step 2 covers that)`}
        py={`pip install spanlens
# or skip and use the raw openai package (Step 2 covers that)`}
      />

      <h2>Step 2. Swap the base URL</h2>
      <p>
        Helicone routes through <code>https://ai-gateway.helicone.ai</code> (or the older
        <code>https://oai.helicone.ai/v1</code>). Spanlens routes through{' '}
        <code>https://server.spanlens.io/proxy/&lt;provider&gt;</code>. The auth header
        stays the same shape; only the key value changes.
      </p>

      <h3>OpenAI</h3>
      <p className="text-sm text-muted-foreground">Before (Helicone):</p>
      <CodeBlock language="ts">{`import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: 'https://ai-gateway.helicone.ai',
  apiKey: process.env.HELICONE_API_KEY,
  // Some setups also pass:
  // defaultHeaders: { 'Helicone-Auth': 'Bearer ' + process.env.HELICONE_API_KEY },
})`}</CodeBlock>
      <p className="text-sm text-muted-foreground">After (Spanlens, raw OpenAI client):</p>
      <CodeBlock language="ts">{`import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: 'https://server.spanlens.io/proxy/openai/v1',
  apiKey: process.env.SPANLENS_API_KEY,
})`}</CodeBlock>
      <p className="text-sm text-muted-foreground">After (Spanlens, SDK helper):</p>
      <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI() // reads SPANLENS_API_KEY from env`}</CodeBlock>

      <h3>Anthropic, Gemini, Azure OpenAI</h3>
      <p>Different base path per provider. The dashboard shows the exact URL after you register a provider key.</p>
      <CodeBlock language="text">{`OpenAI    : https://server.spanlens.io/proxy/openai/v1
Anthropic : https://server.spanlens.io/proxy/anthropic
Gemini    : https://server.spanlens.io/proxy/gemini/v1beta
Azure     : https://server.spanlens.io/proxy/azure`}</CodeBlock>

      <h2>Step 3. Replace Helicone headers with Spanlens equivalents</h2>
      <p>
        Helicone uses <code>Helicone-*</code> headers for in-band metadata; Spanlens uses
        <code>x-spanlens-*</code>. Direct mapping:
      </p>
      <table>
        <thead>
          <tr>
            <th>Helicone header</th>
            <th>Spanlens equivalent</th>
            <th>SDK helper</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>Helicone-User-Id</code></td>
            <td><code>x-spanlens-user</code></td>
            <td><code>withUser(id)</code></td>
          </tr>
          <tr>
            <td><code>Helicone-Session-Id</code></td>
            <td><code>x-spanlens-session</code></td>
            <td><code>withSession(id)</code></td>
          </tr>
          <tr>
            <td><code>Helicone-Property-*</code> (custom)</td>
            <td>part of <code>x-spanlens-prompt-version</code> + future custom tags</td>
            <td>see notes below</td>
          </tr>
          <tr>
            <td><code>Helicone-Prompt-Id</code></td>
            <td><code>x-spanlens-prompt-version</code></td>
            <td><code>withPromptVersion(&apos;name@version&apos;)</code></td>
          </tr>
          <tr>
            <td><code>Helicone-Cache-Enabled</code></td>
            <td>not built-in; see <em>Gateway features</em> below</td>
            <td>n/a</td>
          </tr>
          <tr>
            <td><code>Helicone-RateLimit-Policy</code></td>
            <td>not built-in; see <em>Gateway features</em> below</td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">
        Spanlens projects also accept arbitrary key/value pairs on traces and spans through
        the <code>metadata</code> field on <code>createTrace()</code> /{' '}
        <code>span.end({`{ metadata }`})</code>. Use that for anything you tagged with{' '}
        <code>Helicone-Property-*</code>.
      </p>

      <h3>Setting headers with the SDK helpers</h3>
      <CodeBlock language="ts">{`import { createOpenAI, withUser, withSession, withPromptVersion } from '@spanlens/sdk/openai'

const openai = createOpenAI()

const res = await openai.chat.completions.create(
  { model: 'gpt-4o-mini', messages: [...] },
  {
    headers: {
      ...withUser(currentUser.id).headers,
      ...withSession(currentSession.id).headers,
      ...withPromptVersion('chatbot-system@3').headers,
    },
  },
)`}</CodeBlock>

      <h2>Step 4. Register your provider key in the dashboard</h2>
      <p>
        Helicone takes your OpenAI key directly in the client (you pass both keys: yours and
        Helicone&apos;s). Spanlens does the opposite: you only pass your Spanlens key; your
        real provider key is registered once in the dashboard and stays server-side.
      </p>
      <ol>
        <li>Open <a href="/projects">/projects</a></li>
        <li>Click <strong>+ Add provider key</strong> on the project card</li>
        <li>Paste your real <code>sk-...</code> key, label it, save</li>
        <li>Delete the provider key from your application&apos;s env file</li>
      </ol>
      <p className="text-sm text-muted-foreground">
        The key is encrypted with AES-256-GCM before storage; only the proxy can decrypt it
        in memory at request time. Detail in <a href="/docs/features/settings">Keys &amp;
        encryption</a>.
      </p>

      <h2>Gateway features, and what to do about them</h2>
      <p>
        Helicone bundles features Spanlens deliberately leaves to upstream tools. If you
        depend on these, plan ahead:
      </p>
      <table>
        <thead>
          <tr>
            <th>Helicone feature</th>
            <th>Spanlens equivalent</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Edge caching</td>
            <td>Cache at your app layer (Vercel KV, Redis). Spanlens logs cache_read_tokens / cache_write_tokens when the provider reports them (OpenAI prompt cache, Anthropic cache control).</td>
          </tr>
          <tr>
            <td>Rate limiting</td>
            <td>Use your edge/API gateway (Vercel, Cloudflare, Kong). Spanlens captures rate-limit response codes in <code>status_code</code> so dashboards still surface them.</td>
          </tr>
          <tr>
            <td>Retries on 5xx</td>
            <td>Most provider SDKs retry by default. The OpenAI SDK retries up to 2 times; Anthropic 2 times. Tune at the SDK level rather than the proxy.</td>
          </tr>
          <tr>
            <td>Provider fallback (gpt-4o → claude-haiku-4-5 on failure)</td>
            <td>Not built-in. Pattern: catch in your app code, swap clients (<code>createOpenAI()</code> ↔ <code>createAnthropic()</code>). Both share the same Spanlens key.</td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">
        This is a deliberate scope decision. Putting retry/cache/rate-limit inside the
        observability proxy makes the proxy a single point of failure for application
        behaviour. Spanlens prefers to be a sidecar you can disable without breaking your
        app.
      </p>

      <h2>Step 5. Dual-run during the cutover</h2>
      <p>
        Easiest cutover: change the base URL in one service, leave the rest pointing at
        Helicone, watch both dashboards for a day, then ramp.
      </p>
      <CodeBlock language="ts">{`// Read from env so you can flip per environment
const baseURL = process.env.LLM_PROXY === 'spanlens'
  ? 'https://server.spanlens.io/proxy/openai/v1'
  : 'https://ai-gateway.helicone.ai'

const apiKey = process.env.LLM_PROXY === 'spanlens'
  ? process.env.SPANLENS_API_KEY
  : process.env.HELICONE_API_KEY

const openai = new OpenAI({ baseURL, apiKey })`}</CodeBlock>

      <h2>Verify the cutover</h2>
      <ol>
        <li>Send one call from the migrated service.</li>
        <li>Open <a href="/requests">/requests</a>. The request appears within seconds, with model, tokens, cost, latency.</li>
        <li>
          Confirm a user-tagged request shows up in <a href="/users">/users</a> aggregated
          under the right <code>user_id</code>.
        </li>
        <li>
          Compare daily cost against Helicone for one billing day. They should match within
          1% (any larger gap is usually a model name that needs seeding in our price table).
        </li>
      </ol>

      <hr />
      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/proxy">Direct proxy reference</a> for headers and auth, or{' '}
        <a href="/docs/concepts/data-model">data model</a> for the full schema.
      </p>
    </div>
  )
}
