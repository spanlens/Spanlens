# P3-21: Blog post 1 (top priority)

**Target URL**: https://blog.spanlens.io/openai-proxy-logging-nodejs (or /posts/...)
**Slug**: `openai-proxy-logging-nodejs`
**Tags**: `openai`, `observability`, `nodejs`, `typescript`
**Hero/OG image**: code-on-screen mockup or simple branded card

---

# How to Log Every OpenAI API Call in Node.js (Without Changing Your Code)

You're shipping a Node app that talks to OpenAI. Costs are rising, latency feels flaky, and when something goes wrong you're checking three dashboards. Adding observability shouldn't take a week. With the proxy pattern, it takes one line of code.

This post walks through why the proxy approach beats SDK wrapping, how to set it up in Node/Next.js/Vercel without touching your business logic, and what you'll see once requests start flowing.

## Why proxy beats wrapping (for logging)

Two patterns dominate LLM observability tooling:

1. **SDK wrapper**: install a vendor SDK, swap your `OpenAI` import for theirs, configure callbacks. Works fine for new code; painful when you have 30 call sites across an old codebase.
2. **Proxy**: change the OpenAI `baseURL` to a logging endpoint. Your existing OpenAI client keeps working unchanged.

For logging specifically, the proxy wins because:

- Every call site, including ones inside dependencies you didn't write, is captured automatically
- Streaming responses pass through unchanged (no buffering, no chunking artifacts)
- You can roll back to direct OpenAI in 5 seconds by reverting the env var
- It works in every language that has an HTTP client — not just languages your vendor ships an SDK for

The trade-off: the proxy operator (you, if self-hosting, or your vendor) sees every request. If that's a non-starter (regulated data, strict data-residency), use the OpenTelemetry export path instead.

## Setting it up: one line

```ts
// Before
import OpenAI from 'openai'
const openai = new OpenAI()

// After
import OpenAI from 'openai'
const openai = new OpenAI({
  baseURL: 'https://api.spanlens.io/proxy/openai/v1',
  apiKey: process.env.SPANLENS_API_KEY, // your Spanlens key
})
```

Everything else stays the same:

```ts
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hello' }],
})
```

Streaming, tool use, vision, embeddings — all work without further changes. The proxy passes them through verbatim.

If you'd rather not paste a URL, the Spanlens drop-in does the same with one import swap:

```ts
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI() // baseURL + auth handled
```

## What you'll see

After the first request, open `/requests` in the dashboard. Each call shows:

- Model variant returned (the dated name, e.g. `gpt-4o-mini-2024-07-18`)
- Input + output token counts
- Cost in USD against the live price table
- Total latency and time-to-first-token for streams
- Full request body and full response body (filterable, exportable)

Filter by model, customer, or endpoint. Group by prompt version. Export to CSV or pipe to your warehouse.

## The two questions that come up next

**"What about latency overhead?"** Logging is async after the response is already streamed to your client. p99 overhead is under 3ms. If the logging endpoint fails, the original request still completes — observability never sits on the critical path.

**"What about my API key?"** Your OpenAI key is stored encrypted at rest with AES-256-GCM and never logged. It is decrypted only at proxy time and immediately discarded after the upstream call.

## Cleanup: when to graduate from proxy-only

The proxy gets you cost + latency + body capture in one line. As your app grows, you'll want:

- **Agent tracing** for multi-step LangChain/LangGraph workflows — add a callback handler on top
- **Prompt versioning** to A/B test rollouts — register prompts and use the resolved version ID
- **Per-customer cost** to bill or alert on outliers — tag requests with a customer header

All build on top of the proxy without changing it. Start with one line, layer the rest in when you need it.

## Try it

Spanlens is open source MIT and free for the first 50K requests/mo. Repo at https://github.com/spanlens/Spanlens, hosted at https://www.spanlens.io. Self-hostable with one `docker compose up`.

---

**Related reading**:
- [LLM observability — the guide](https://www.spanlens.io/llm-observability)
- [LLM cost tracking](https://www.spanlens.io/llm-cost-tracking)
- [Agent tracing](https://www.spanlens.io/agent-tracing)
- [Spanlens vs Langfuse](https://www.spanlens.io/compare/langfuse)
