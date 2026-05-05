import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: 'Direct proxy · Spanlens Docs',
  description: 'Use Spanlens from any language — Python, Ruby, Go, curl. Just swap the base URL.',
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
        <p className="m-0 font-semibold text-accent">⚡ Use streaming for long requests</p>
        <p className="mt-1 mb-0 text-accent">
          The proxy runs on Node.js with a <strong>40-second max duration</strong>. Any request expected to take
          longer (large <code>max_tokens</code>, slow models, JSON mode with big outputs) should use{' '}
          <code>stream: true</code>. Streaming sidesteps the timeout entirely — first byte arrives in
          ~200ms regardless of total duration. If you need a single JSON object back, accumulate chunks
          server-side and return the merged string to your client (the &ldquo;internal streaming&rdquo;
          pattern).
        </p>
      </div>

      <h2>How it works</h2>
      <p>
        Spanlens exposes a 1:1 compatible proxy at:
      </p>
      <CodeBlock>{`https://spanlens-server.vercel.app/proxy/openai/v1
https://spanlens-server.vercel.app/proxy/anthropic
https://spanlens-server.vercel.app/proxy/gemini/v1beta`}</CodeBlock>
      <p>
        Send requests exactly as you would to the real provider, with two changes:
      </p>
      <ol>
        <li>
          <strong>Base URL</strong> — point your SDK at the Spanlens proxy
        </li>
        <li>
          <strong>API key</strong> — use your Spanlens API key (starts with{' '}
          <code>sl_live_</code>) instead of the provider&apos;s. The real provider key
          registered under your Spanlens key is decrypted server-side and forwarded — your
          client never sees it.
        </li>
      </ol>

      <h3 id="auth-transports">Authentication transports per SDK</h3>
      <p>
        Each provider&apos;s SDK puts the API key on the wire differently. Spanlens accepts
        whichever shape the SDK sends — you don&apos;t need to override anything when using
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
            <td>Google Generative AI (legacy / curl)</td>
            <td>URL <code>?key=sl_live_…</code></td>
            <td>✓ (fallback)</td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">
        The <code>authApiKey</code> middleware tries them in order and the first non-empty
        one wins. Implementation: <code>apps/server/src/middleware/authApiKey.ts</code>.
      </p>

      <h2 id="python-openai">Python — OpenAI</h2>
      <CodeBlock language="python">{`from openai import OpenAI

client = OpenAI(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://spanlens-server.vercel.app/proxy/openai/v1",
)

res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hi"}],
)`}</CodeBlock>

      <h2 id="python-anthropic">Python — Anthropic</h2>
      <CodeBlock language="python">{`from anthropic import Anthropic

client = Anthropic(
    api_key=os.environ["SPANLENS_API_KEY"],
    base_url="https://spanlens-server.vercel.app/proxy/anthropic",
)

msg = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hi"}],
)`}</CodeBlock>

      <h2 id="curl">curl — raw HTTP</h2>
      <CodeBlock language="bash">{`curl https://spanlens-server.vercel.app/proxy/openai/v1/chat/completions \\
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
  uri_base: "https://spanlens-server.vercel.app/proxy/openai",
)

res = client.chat(parameters: {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hi" }],
})`}</CodeBlock>

      <h2 id="go">Go</h2>
      <CodeBlock language="go">{`import "github.com/sashabaranov/go-openai"

config := openai.DefaultConfig(os.Getenv("SPANLENS_API_KEY"))
config.BaseURL = "https://spanlens-server.vercel.app/proxy/openai/v1"

client := openai.NewClientWithConfig(config)

res, _ := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
    Model: "gpt-4o-mini",
    Messages: []openai.ChatCompletionMessage{
        {Role: "user", Content: "Hi"},
    },
})`}</CodeBlock>

      <h2>Streaming</h2>
      <p>
        Server-Sent Events streaming works transparently. Spanlens tees the stream — one copy flows to
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
        Invalid or unknown values silently resolve to null — the proxy never fails because a
        prompt tag is stale. The request just isn&apos;t linked to a version.
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
