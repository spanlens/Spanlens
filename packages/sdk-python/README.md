# Spanlens Python SDK

LLM observability for Python. Trace agent runs, capture token usage and cost,
and link calls back to your Spanlens dashboard with one line of code.

[![PyPI](https://img.shields.io/pypi/v/spanlens.svg)](https://pypi.org/project/spanlens/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/pypi/pyversions/spanlens.svg)](https://pypi.org/project/spanlens/)

> **Spanlens** is the open-source LLM observability platform. This is the
> official Python SDK — for the dashboard, signup, and proxy docs, head to
> [spanlens.io](https://spanlens.io).

---

## Install

```bash
pip install spanlens

# Or with provider integrations:
pip install "spanlens[openai]"
pip install "spanlens[anthropic]"
pip install "spanlens[gemini]"
pip install "spanlens[all]"
```

## Two ways to use it

| Mode | Best for | Setup |
| --- | --- | --- |
| **Proxy** | Single-call observability — drop-in for the OpenAI/Anthropic SDK | Replace `base_url` |
| **SDK tracing** | Multi-step agents, RAG, tool calls, manual spans | `SpanlensClient(...)` |

You can mix both. The proxy logs the raw request; the SDK groups multiple
requests into a single trace with parent / child spans.

---

## Mode 1 — Proxy (zero-code)

Get a Spanlens API key from your dashboard, then point your provider SDK at
the Spanlens proxy:

```python
import os
from spanlens.integrations.openai import create_openai

# Reads SPANLENS_API_KEY from the environment
client = create_openai()

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

Spanlens automatically logs the request, response, latency, token counts,
and cost — viewable in the dashboard under **Requests**.

### Tagging requests with a prompt version

```python
from spanlens.integrations.openai import create_openai, with_prompt_version

client = create_openai()
res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[...],
    **with_prompt_version("chatbot-system@3"),
)
```

The same pattern works for Anthropic — see
[`spanlens.integrations.anthropic`](./spanlens/integrations/anthropic.py).

---

## Mode 2 — SDK tracing (multi-step agents)

Use the SDK when one user request spans multiple LLM calls, retrieval, tool
use, etc. Spans appear nested under a single trace in the dashboard.

```python
from spanlens import SpanlensClient

client = SpanlensClient(api_key="sl_live_...")

with client.start_trace("rag_pipeline", metadata={"user_id": "u_42"}) as trace:
    with trace.span("retrieve", span_type="retrieval") as span:
        docs = vector_store.similarity_search(query, k=5)
        span.end(output={"doc_count": len(docs)})

    with trace.span("generate", span_type="llm") as span:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=build_prompt(query, docs),
            extra_headers=span.trace_headers(),  # links proxy log to this span
        )
        usage = response.usage
        span.end(
            output=response.choices[0].message.content,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            total_tokens=usage.total_tokens,
        )
```

When a span / trace context manager exits with an exception, the span is
automatically marked `error` with the exception message.

### Helper: `observe_openai`

Boilerplate-free version of the LLM span — auto-injects trace headers,
auto-parses `usage`, and auto-ends the span:

```python
from spanlens import observe_openai

result = observe_openai(trace, "answer", lambda headers:
    openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        extra_headers=headers,
    )
)
```

The same shape exists for Anthropic (`observe_anthropic`) and Gemini
(`observe_gemini`).

### Async support

`observe()` and `observe_*()` detect coroutines automatically. Pass an async
callable and `await` the result:

```python
async def go():
    result = await observe_openai(trace, "answer", lambda h:
        async_openai.chat.completions.create(..., extra_headers=h),
    )
```

---

## Configuration reference

```python
SpanlensClient(
    api_key="sl_live_...",        # required
    base_url=None,                 # default: https://spanlens-server.vercel.app
    timeout_ms=3000,               # ingest timeout per call
    silent=True,                   # swallow errors so observability never crashes user code
    on_error=None,                 # callback (err, context) for non-silent monitoring
)
```

Environment variables:

* `SPANLENS_API_KEY` — picked up by `create_openai()`, `create_anthropic()`,
  `create_gemini()` when `api_key=` is omitted.

---

## Why the SDK is non-blocking

Every `trace.end()` / `span.end()` call returns immediately. Network I/O
runs on a background thread pool with a configurable timeout, so:

* Your hot path (the LLM call itself) is never slowed down.
* The Spanlens server being slow / down does not crash your app.
* Order is still preserved: a span POST always waits for its parent trace
  POST to finish — the server's ownership check would otherwise 404 and the
  span would be silently lost.

For short-lived scripts, call `client.close()` before exit (or use
`with SpanlensClient(...) as client:`) to drain the queue.

---

## Compatibility

* Python 3.9, 3.10, 3.11, 3.12, 3.13
* `openai` >= 1.0
* `anthropic` >= 0.18
* `google-generativeai` >= 0.5

---

## Self-hosting

Point the SDK and proxy helpers at your own deployment:

```python
client = SpanlensClient(
    api_key="...",
    base_url="https://spanlens.mycompany.com",
)

openai = create_openai(base_url="https://spanlens.mycompany.com/proxy/openai/v1")
```

---

## License

MIT — see [LICENSE](./LICENSE).

## Links

* [Spanlens dashboard](https://spanlens.io)
* [Proxy docs](https://spanlens.io/docs/proxy)
* [TypeScript SDK](https://www.npmjs.com/package/@spanlens/sdk)
* [GitHub](https://github.com/sunes26/Spanlens)
