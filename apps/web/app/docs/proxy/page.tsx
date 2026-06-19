import { CodeBlock } from '../_components/code-block'

export const metadata = {
  alternates: { canonical: '/docs/proxy' },
  title: 'Direct proxy · Spanlens Docs',
  description: 'Use Spanlens from any language, Python, Ruby, Go, curl. Just swap the base URL.',
}

export default function ProxyDocs() {
  return (
    <div>
      <h1>Direct proxy (any language)</h1>
      <p className="lead">
        If you&apos;re not using the TypeScript SDK, you can still use Spanlens by pointing any OpenAI /
        Anthropic / Gemini client at our proxy URL. Works with Python, Ruby, Go, Rust, Java, PHP, or raw HTTP.
      </p>

      <div className="my-6 rounded-lg border-l-4 border-accent bg-accent-bg p-4 text-sm">
        <p className="m-0 font-semibold text-accent">Use streaming for long requests</p>
        <p className="mt-1 mb-0 text-accent">
          The proxy runs on Vercel Pro with a <strong>300-second hard ceiling</strong>, and Spanlens
          gracefully closes streams at <strong>290 seconds</strong> to make room for the log to flush.
          Long requests (large <code>max_tokens</code>, slow models, JSON mode with big outputs) should
          use <code>stream: true</code>, first byte arrives in ~200 ms regardless of total duration.
          If a stream gets cut off at the deadline, the row is logged with{' '}
          <code>truncated: true</code> (visible as a badge in <a href="/requests">/requests</a>) so
          you can see when it happens and tune <code>max_tokens</code> accordingly. Non-streaming
          requests that exceed the upstream timeout return HTTP 504.
        </p>
      </div>

      <h2>How it works</h2>
      <p>
        Spanlens exposes a 1:1 compatible proxy at:
      </p>
      <CodeBlock>{`https://server.spanlens.io/proxy/openai/v1
https://server.spanlens.io/proxy/anthropic
https://server.spanlens.io/proxy/gemini/v1beta
https://server.spanlens.io/proxy/azure
https://server.spanlens.io/proxy/mistral/v1
https://server.spanlens.io/proxy/openrouter/v1`}</CodeBlock>
      <p>
        Send requests exactly as you would to the real provider, with two changes:
      </p>
      <ol>
        <li>
          <strong>Base URL</strong>, point your SDK at the Spanlens proxy
        </li>
        <li>
          <strong>API key</strong>, use your Spanlens API key (starts with{' '}
          <code>sl_live_</code>) instead of the provider&apos;s. The real provider key
          registered under your Spanlens key is decrypted server-side and forwarded, your
          client never sees it.
        </li>
      </ol>

      <h3 id="auth-transports">Authentication transports per SDK</h3>
      <p>
        Each provider&apos;s SDK puts the API key on the wire differently. Spanlens accepts
        whichever shape the SDK sends, you don&apos;t need to override anything when using
        the upstream client. If you&apos;re writing a hand-rolled client (curl, raw fetch, a
        language without an official SDK), pick whichever transport is convenient.
      </p>
      <table>
        <thead>
          <tr>
            <th>SDK / client</th>
            <th>How the key is sent</th>
            <th>Spanlens accepts?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenAI (any language)</td>
            <td><code>Authorization: Bearer sl_live_…</code></td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Anthropic (any language)</td>
            <td><code>x-api-key: sl_live_…</code></td>
            <td>✓</td>
          </tr>
          <tr>
            <td>@google/generative-ai (current)</td>
            <td><code>x-goog-api-key: sl_live_…</code></td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Azure OpenAI (any language)</td>
            <td><code>Authorization: Bearer sl_live_…</code></td>
            <td>✓</td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">
        Azure note: your Spanlens key still goes on <code>Authorization: Bearer …</code>. The
        real Azure <code>api-key</code> header is added by the proxy after looking up the
        encrypted key you registered in the dashboard.
      </p>
      <p className="text-sm text-muted-foreground">
        The <code>authApiKey</code> middleware tries them in order and the first non-empty
        one wins. Implementation: <code>apps/server/src/middleware/authApiKey.ts</code>.
      </p>

      <h2 id="python-openai">Python, OpenAI</h2>
      <CodeBlock language="python">{`from openai import OpenAI

client = OpenAI(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://server.spanlens.io/proxy/openai/v1",
)

res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hi"}],
)`}</CodeBlock>

      <h2 id="python-anthropic">Python, Anthropic</h2>
      <CodeBlock language="python">{`from anthropic import Anthropic

client = Anthropic(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://server.spanlens.io/proxy/anthropic",
)

msg = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hi"}],
)`}</CodeBlock>

      <h2 id="python-azure">Python, Azure OpenAI</h2>
      <p>
        Azure OpenAI uses Microsoft&apos;s <code>/openai/v1/*</code> endpoint (GA Aug 2025) so
        it is drop-in OpenAI-compatible, same request and response shapes, same streaming
        format. Register your Azure resource URL + API key under the Spanlens key in the
        dashboard once; the proxy then injects them at call time. Your client just talks to{' '}
        <code>/proxy/azure</code>.
      </p>
      <CodeBlock language="python">{`from openai import OpenAI

client = OpenAI(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://server.spanlens.io/proxy/azure",
)

# 'model' is your Azure deployment name, not the underlying model id.
res = client.chat.completions.create(
    model="my-gpt4o-mini-deployment",
    messages=[{"role": "user", "content": "Hi"}],
)`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Provider key registration step: dashboard → <a href="/projects">Projects &amp; Keys</a>
        {' '}→ expand a Spanlens key → <em>Add provider key</em> → Azure OpenAI → paste{' '}
        <code>https://&lt;your-resource&gt;.openai.azure.com</code> + API key 1 from Azure
        portal. The proxy stores the URL on the key row and injects the right{' '}
        <code>api-key</code> header on every request.
      </p>

      <h2 id="python-mistral">Python, Mistral</h2>
      <p>
        Mistral&apos;s API is OpenAI-compatible end-to-end (request shape, SSE
        chunk format, <code>usage</code> field), so the same{' '}
        <code>openai</code> Python package works with the base URL pointed at{' '}
        <code>/proxy/mistral/v1</code>. Useful when EU data residency matters
        (Mistral hosts in France) or when you want to A/B against OpenAI without
        rewriting your client.
      </p>
      <CodeBlock language="python">{`from openai import OpenAI

client = OpenAI(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://server.spanlens.io/proxy/mistral/v1",
)

res = client.chat.completions.create(
    model="mistral-small-latest",
    messages=[{"role": "user", "content": "Hi"}],
)`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Supported models include <code>mistral-large-latest</code>,{' '}
        <code>mistral-medium-latest</code>, <code>mistral-small-latest</code>,{' '}
        <code>pixtral-large-latest</code> / <code>pixtral-12b</code>{' '}
        (multimodal), <code>codestral-latest</code>, the <code>ministral-*</code>{' '}
        family, <code>open-mistral-nemo</code>, and <code>mistral-embed</code>{' '}
        for embeddings. Cost lands on every row.
      </p>

      <h2 id="python-openrouter">Python, OpenRouter</h2>
      <p>
        OpenRouter is a meta-provider: one API key, one base URL, 100+ models
        from 30+ providers (OpenAI, Anthropic, Mistral, Meta, DeepSeek, Qwen,
        Cohere, Perplexity, ...). The wire protocol is OpenAI-compatible, so
        the same <code>openai</code> client works once the base URL is pointed
        at <code>/proxy/openrouter/v1</code>. Switch models with a single
        string change instead of swapping clients.
      </p>
      <CodeBlock language="python">{`from openai import OpenAI

client = OpenAI(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://server.spanlens.io/proxy/openrouter/v1",
)

# Model id carries a vendor prefix
res = client.chat.completions.create(
    model="anthropic/claude-3.5-sonnet",
    messages=[{"role": "user", "content": "Hi"}],
)

# Same client, different model — no code changes
res2 = client.chat.completions.create(
    model="meta-llama/llama-3.1-70b-instruct",
    messages=[{"role": "user", "content": "Hi"}],
)`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Cost preference: when OpenRouter reports{' '}
        <code>usage.cost</code> on the response (authoritative, includes
        their margin/discount) Spanlens logs that figure verbatim. When it
        is absent, the proxy strips the vendor prefix (
        <code>anthropic/claude-3-5-sonnet</code> →{' '}
        <code>claude-3-5-sonnet</code>) and looks the model up in the same
        <code> model_prices</code> table the other providers use. Unknown
        model + no <code>usage.cost</code> → <code>cost_usd</code> lands
        NULL (visible in <a href="/requests">/requests</a> so you know to
        check OpenRouter&apos;s own dashboard for that row).
      </p>

      <h2 id="curl">curl, raw HTTP</h2>
      <CodeBlock language="bash">{`curl https://server.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hi"}]
  }'`}</CodeBlock>

      <h2 id="ruby">Ruby</h2>
      <CodeBlock language="ruby">{`require "openai"

client = OpenAI::Client.new(
  access_token: ENV["SPANLENS_API_KEY"],
  uri_base: "https://server.spanlens.io/proxy/openai",
)

res = client.chat(parameters: {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hi" }],
})`}</CodeBlock>

      <h2 id="go">Go</h2>
      <CodeBlock language="go">{`import "github.com/sashabaranov/go-openai"

config := openai.DefaultConfig(os.Getenv("SPANLENS_API_KEY"))
config.BaseURL = "https://server.spanlens.io/proxy/openai/v1"

client := openai.NewClientWithConfig(config)

res, _ := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
    Model: "gpt-4o-mini",
    Messages: []openai.ChatCompletionMessage{
        {Role: "user", Content: "Hi"},
    },
})`}</CodeBlock>

      <h2>Streaming</h2>
      <p>
        Server-Sent Events streaming works transparently. Spanlens tees the stream, one copy flows to
        you in real time, the other is parsed asynchronously to extract token usage. Latency overhead
        is negligible (10–50ms).
      </p>

      <h2>Passing project / metadata</h2>
      <p>
        Add an <code>X-Spanlens-Project</code> header to tag requests with a project scope:
      </p>
      <CodeBlock>{`-H "X-Spanlens-Project: my-backend-service"`}</CodeBlock>

      <p>
        Add an <code>X-Spanlens-Prompt-Version</code> header to link the request to a specific{' '}
        <a href="/docs/features/prompts">prompt version</a> so it appears in the A/B comparison
        table. Accepts <code>name@version</code>, <code>name@latest</code>, or a raw UUID:
      </p>
      <CodeBlock>{`-H "X-Spanlens-Prompt-Version: chatbot-system@3"
# or
-H "X-Spanlens-Prompt-Version: chatbot-system@latest"
# or
-H "X-Spanlens-Prompt-Version: ae1c3c1e-99eb-2b98-5f05-012345678901"`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Invalid or unknown values silently resolve to null, the proxy never fails because a
        prompt tag is stale. The request just isn&apos;t linked to a version.
      </p>

      <p>
        Add <code>X-Spanlens-User</code> and <code>X-Spanlens-Session</code> headers to tag the
        request with an end-user or session ID. The values are opaque strings of your choosing
        (Spanlens never interprets them):
      </p>
      <CodeBlock>{`-H "X-Spanlens-User: user_abc123"
-H "X-Spanlens-Session: sess_xyz789"`}</CodeBlock>
      <p>
        Tagged requests roll up at <a href="/users">/users</a> (per-end-user cost / token / latency
        analytics) and can be filtered at <a href="/requests">/requests</a> via{' '}
        <code>?userId=…</code> / <code>?sessionId=…</code>. See{' '}
        <a href="/docs/features/users">Users docs</a> for tagging strategy and SDK helpers.
      </p>

      <h3>Controlling body retention, <code>X-Spanlens-Log-Body</code></h3>
      <p>
        Spanlens stores the full request and response bodies by default (with API-key auto-masking
       , see below). For PII-sensitive workloads, opt out per call with the{' '}
        <code>X-Spanlens-Log-Body</code> header:
      </p>
      <CodeBlock>{`-H "X-Spanlens-Log-Body: full"   # default, store bodies (with key masking)
-H "X-Spanlens-Log-Body: meta"   # drop bodies; keep tokens/cost/latency/user/session
-H "X-Spanlens-Log-Body: none"   # same as meta + drop user_id/session_id`}</CodeBlock>
      <p>
        Unknown values fall back to <code>full</code> (the existing behavior) so a malformed
        header never silently turns logging off. SDK equivalent:{' '}
        <a href="/docs/sdk#with-log-body"><code>withLogBody()</code></a> /{' '}
        <code>observeOpenAI(&#123; logBody &#125;)</code>.
      </p>

      <h3>Server-side body sanitization</h3>
      <p>
        Even in <code>full</code> mode, the server scans <code>request_body</code>,{' '}
        <code>response_body</code>, and <code>error_message</code> for API key patterns before
        the row is written to ClickHouse. Anything matching one of the patterns below (≥12
        characters after the prefix) is replaced with <code>&lt;prefix&gt;***</code>:
      </p>
      <ul>
        <li>Spanlens: <code>sl_live_*</code></li>
        <li>Anthropic: <code>sk-ant-*</code></li>
        <li>OpenAI project keys: <code>sk-proj-*</code></li>
        <li>OpenAI legacy keys: <code>sk-*</code></li>
        <li>Google: <code>AIza*</code></li>
      </ul>
      <p>
        This is <strong>pattern-based, not ML-based</strong>, it catches keys that slip into
        prompts/tool output/error strings, but it does <em>not</em> redact natural-language PII
        (names, emails, card numbers). For those, use <code>X-Spanlens-Log-Body: meta</code>.
        See <a href="/docs/features/security">Security docs</a> for full details.
      </p>

      <h3>About prompt-cache breakdown</h3>
      <p>
        When Anthropic returns <code>cache_read_input_tokens</code> /{' '}
        <code>cache_creation_input_tokens</code> or OpenAI returns{' '}
        <code>prompt_tokens_details.cached_tokens</code>, Spanlens parses them out of the response
        automatically and stores the breakdown in <code>requests.cache_read_tokens</code> /{' '}
        <code>cache_write_tokens</code>. <em>No header from you is required.</em> Cost is billed at
        each provider&apos;s reduced cache rate (≈ 0.1× input on Anthropic, ≈ 0.5× input on OpenAI).
        See <a href="/docs/features/cost-tracking">cost tracking</a> for the full formula.
      </p>

      <h2>Rate limits and response headers</h2>
      <p>
        Spanlens applies a high per-organization per-minute ceiling on{' '}
        <code>/proxy/*</code> purely to stop a runaway loop, not to throttle normal
        production traffic. Going over it does <strong>not</strong> reject your request:
        the call passes through to your provider and the response carries{' '}
        <code>X-Spanlens-RateLimit-Overage: true</code> so you can spot the spike. Your
        plan&apos;s monthly request quota is the limit that actually gates usage.
      </p>
      <p>
        Every <code>/proxy/*</code> response carries the standard rate limit headers so a
        client can read the current window without guessing.
      </p>
      <ul>
        <li><code>X-RateLimit-Limit</code>, requests allowed in the current window for your plan.</li>
        <li><code>X-RateLimit-Remaining</code>, requests left in the current window.</li>
        <li>
          <code>X-RateLimit-Reset</code>, unix epoch second at which the window rolls over.
          Use this directly rather than parsing the server clock from <code>Date</code>,
          since clock skew costs you retries.
        </li>
        <li>
          <code>X-RateLimit-Window</code>, the window length in seconds. Currently always{' '}
          <code>60s</code>, exposed as a header so we can change it without breaking
          clients that read it.
        </li>
      </ul>

      <h3>Customer-configured rate limits</h3>
      <p>
        You can set your own limits on a Spanlens key, a project, or an individual
        end-user from the <a href="/projects">Projects</a> page. Unlike the platform
        ceiling above, exceeding one of your own limits <strong>does</strong> return a{' '}
        <code>429</code> to the caller, because you configured it precisely to throttle
        that traffic. The error body identifies which limit fired:
      </p>
      <CodeBlock>{`{
  "error": {
    "code": "RATE_LIMIT",
    "message": "Customer-configured rate limit exceeded (end_user): 60 requests per 60s.",
    "details": {
      "source": "customer_limit",
      "scope": "end_user",
      "limit": 60,
      "window_seconds": 60,
      "end_user_id": "user_123"
    }
  }
}`}</CodeBlock>
      <p>
        The response also carries <code>Retry-After</code> (the window length in seconds)
        and <code>X-Spanlens-RateLimit-Scope</code> (<code>api_key</code>,{' '}
        <code>project</code>, or <code>end_user</code>). A <code>customer_limit</code> 429
        never includes an upgrade link, which is how you tell it apart from a platform or
        plan limit. Per-end-user limits bucket on the{' '}
        <code>X-Spanlens-User</code> header, so send it (the SDK{' '}
        <a href="/docs/sdk">withUser()</a> helper does this) for those limits to apply.
      </p>

      <h2>Self-hosting</h2>
      <p>
        If you&apos;re running Spanlens on your own infra, replace the base URL:
      </p>
      <CodeBlock>{`https://your-spanlens-domain.com/proxy/openai/v1`}</CodeBlock>
      <p>
        See <a href="/docs/self-host">self-hosting</a> for Docker deployment.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Next: <a href="/docs/self-host">self-hosting</a> with Docker.
      </p>
    </div>
  )
}
