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
          <strong>API key</strong> — use your Spanlens API key (starts with <code>sl_live_</code>) instead
          of the provider&apos;s. The real provider key is pulled from your registered keys server-side.
        </li>
      </ol>

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
