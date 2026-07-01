# Spanlens Python SDK

LLM observability for Python. Trace agent runs, capture token usage and cost,
and link calls back to your Spanlens dashboard with one line of code.

[![PyPI](https://img.shields.io/pypi/v/spanlens.svg)](https://pypi.org/project/spanlens/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/pypi/pyversions/spanlens.svg)](https://pypi.org/project/spanlens/)

> **Spanlens** is the open-source LLM observability platform. This is the
> official Python SDK. For the dashboard, signup, and proxy docs, head to
> [spanlens.io](https://spanlens.io).

---

## Install

```bash
pip install spanlens

# Or with provider integrations:
pip install "spanlens[openai]"
pip install "spanlens[anthropic]"
pip install "spanlens[gemini]"
pip install "spanlens[langchain]"
pip install "spanlens[all]"
```

## Fastest start: the `spanlens` CLI

Installing the package gives you a `spanlens` command. Run the wizard from your
project root and it detects your package manager, validates your key, writes
`.env`, and rewrites your `OpenAI(...)` / `Anthropic(...)` / `genai.configure(...)`
calls to route through Spanlens.

```bash
pip install spanlens
spanlens init
```

Useful flags:

```bash
spanlens init --dry-run                 # preview every change, write nothing
spanlens init --yes --api-key sl_live_  # non-interactive (CI / scripts)
spanlens init --server-url https://...  # self-hosted Spanlens
spanlens test                           # just validate the key + connectivity
```

The wizard re-parses every file it touches before saving, so it never leaves
you with code that will not import. Prefer to wire it up by hand? The two
manual modes below are all it does under the covers.

## Two ways to use it

| Mode | Best for | Setup |
| --- | --- | --- |
| **Proxy** | Single-call observability, drop-in for the OpenAI/Anthropic SDK | Replace `base_url` |
| **SDK tracing** | Multi-step agents, RAG, tool calls, manual spans | `SpanlensClient(...)` |

You can mix both. The proxy logs the raw request; the SDK groups multiple
requests into a single trace with parent / child spans.

---

## Mode 1. Proxy (zero-code)

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
and cost. View them in the dashboard under **Requests**.

### Async (FastAPI, Django async views, asyncio)

Mirror helpers return the async client:

```python
from spanlens.integrations.openai import create_async_openai
from spanlens.integrations.anthropic import create_async_anthropic

async def handler() -> str:
    client = create_async_openai()  # openai.AsyncOpenAI
    resp = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    return resp.choices[0].message.content
```

The SDK's background ingest pool is thread-safe; you can fan out `asyncio.gather`
of 50+ concurrent spans and trace/span POST ordering is preserved.

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

The same pattern works for Anthropic. See
[`spanlens.integrations.anthropic`](./spanlens/integrations/anthropic.py).

---

## Mode 2. SDK tracing (multi-step agents)

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

Boilerplate-free version of the LLM span. Auto-injects trace headers,
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

## Ollama (local LLMs)

`observe_ollama()` traces calls against a local Ollama instance. Use the OpenAI client pointed at Ollama's OpenAI-compatible endpoint, then wrap with the helper so the dashboard tags the span as `provider: "ollama"` instead of OpenAI:

```python
from openai import OpenAI
from spanlens import SpanlensClient, observe_ollama

client = SpanlensClient(api_key="sl_live_...")
ollama = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama",   # ignored by Ollama; required by the openai SDK
)

with client.start_trace("local_summarize") as trace:
    result = observe_ollama(trace, "llama3_summary", lambda h:
        ollama.chat.completions.create(
            model="llama3.1",
            messages=[{"role": "user", "content": "Summarize: ..."}],
            extra_headers=h,
        ),
    )
```

Cost is left as `None` because Ollama is self-hosted, so there is no per-token bill to compute.

---

## LangChain / LangGraph

`SpanlensCallbackHandler` plugs into LangChain's standard `BaseCallbackHandler`
contract, so it works for plain LangChain chains, LCEL pipelines, and
LangGraph compiled graphs without code changes. Every LLM / chain / tool /
retriever node becomes a span with the run-id tree mirroring the graph
topology.

```python
from spanlens import SpanlensClient
from spanlens.integrations.langchain import SpanlensCallbackHandler

client = SpanlensClient(api_key="sl_live_...")
handler = SpanlensCallbackHandler(client=client)

# LangChain / LCEL
result = chain.invoke({"input": "Hello"}, config={"callbacks": [handler]})

# LangGraph
graph = workflow.compile()
result = graph.invoke({"input": "Hello"}, config={"callbacks": [handler]})
```

Attach to an existing trace to nest the chain under a larger workflow:

```python
with client.start_trace("agent_run") as trace:
    handler = SpanlensCallbackHandler(client=client, trace=trace)
    chain.invoke({"input": "..."}, config={"callbacks": [handler]})
    # ... other steps in the same trace ...
```

The handler depends on `langchain-core` at runtime. Either install the
`spanlens[langchain]` extra above, or any LangChain extras you already use
will bring it in.

---

## FastAPI (auto-instrumentation)

One line traces every request. Each HTTP request becomes a Spanlens trace with
a root span, and LLM calls made inside the handler link to it automatically.

```python
import os
from fastapi import FastAPI, Request
from spanlens import SpanlensMiddleware
from spanlens.observe import observe_openai
from spanlens.integrations.openai import create_async_openai

app = FastAPI()
app.add_middleware(SpanlensMiddleware, api_key=os.environ["SPANLENS_API_KEY"])


@app.post("/chat")
async def chat(body: dict, request: Request):
    sl = request.state.spanlens          # {trace, span, headers, trace_id, span_id}
    openai = create_async_openai()
    reply = await observe_openai(
        sl["trace"],
        "answer",
        lambda headers: openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": body["q"]}],
            extra_headers=headers,
        ),
    )
    return {"reply": reply.choices[0].message.content}
```

* On a clean response the span/trace end `completed`; a 5xx or an unhandled
  exception ends them `error` and the exception is re-raised untouched.
* Sampling and tail-based error capture are inherited from the client, so
  sampled-out successful requests produce zero network overhead while errors
  are always captured. Pass `sample_rate=0.1`, or a shared `client=` to reuse
  one connection pool across your app.
* Health, metrics, and docs routes are skipped by default. Override with
  `skip_paths=[...]`.
* Query strings are **not** captured into trace metadata by default, because
  they often carry secrets or PII (OAuth `code`/`state`, reset tokens,
  signed-URL signatures). Opt in with `capture_query_string=True`.
* It is pure ASGI (it does not import FastAPI), so it also works with
  Starlette, Litestar, Quart, and any other ASGI app. `pip install
  spanlens[fastapi]` pulls FastAPI in if you do not already have it.

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

* `SPANLENS_API_KEY` is picked up by `create_openai()`, `create_anthropic()`,
  and `create_gemini()` when `api_key=` is omitted.

---

## Why the SDK is non-blocking

Every `trace.end()` / `span.end()` call returns immediately. Network I/O
runs on a background thread pool with a configurable timeout, so:

* Your hot path (the LLM call itself) is never slowed down.
* The Spanlens server being slow / down does not crash your app.
* Order is still preserved: a span POST always waits for its parent trace
  POST to finish, because the server's ownership check would otherwise 404
  and the span would be silently lost.

For short-lived scripts, call `client.close()` before exit (or use
`with SpanlensClient(...) as client:`) to drain the queue.

---

## Compatibility

* Python 3.9, 3.10, 3.11, 3.12, 3.13
* `openai` >= 1.0
* `anthropic` >= 0.18
* `google-generativeai` >= 0.5

---

## SDK versions & feature parity

> **On version numbers.** The Python (`spanlens`) and TypeScript (`@spanlens/sdk`) SDKs are versioned **completely independently**. A version number in one says nothing about the other, and the gap between them is not a signal of maturity or maintenance. Both are pre-1.0 and both are actively maintained; features land in each on its own release cadence.

The table below is the honest, file-level comparison of what each package ships today. Use it to check whether a capability you rely on exists in the SDK for your language before you build on it.

| Capability | Python (`spanlens`) | TypeScript (`@spanlens/sdk`) |
| --- | :---: | :---: |
| Core tracing (client / trace / span / `observe`) | ✓ | ✓ |
| Sampling (head-based, configurable rate) | ✓ | ✓ |
| OpenAI auto-instrument helper | ✓ `observe_openai` | ✓ `observeOpenAI` |
| Anthropic auto-instrument helper | ✓ `observe_anthropic` | ✓ `observeAnthropic` |
| Gemini auto-instrument helper | ✓ `observe_gemini` | ✓ `observeGemini` |
| Ollama auto-instrument helper (local LLMs) | ✓ `observe_ollama` | ✓ `observeOllama` |
| Proxy client factory (OpenAI) | ✓ `create_openai` | ✓ `createOpenAI` |
| Proxy client factory (Anthropic) | ✓ `create_anthropic` | ✓ `createAnthropic` |
| Proxy client factory (Gemini) | ✓ `create_gemini` | ✓ `createGemini` |
| Proxy client factory (Ollama) | ✗ (use a raw OpenAI client at `localhost:11434`) | ✓ `createOllama` (`@spanlens/sdk/ollama`) |
| LangChain integration | ✓ | ✓ |
| LangGraph integration | ✓ (via the LangChain handler) | ✓ (via the LangChain handler) |
| LlamaIndex integration | ✓ | ✓ |
| FastAPI / ASGI middleware (per-request auto-instrument) | ✓ `SpanlensMiddleware` | ✗ (not yet) |
| Vercel AI SDK integration | ✗ (Vercel AI is JS-only) | ✓ |
| Evals API (script-driven prompt CI) | ✗ (not yet) | ✓ `EvalsApi` |
| CLI (`init` wizard) | ✓ (bundled `spanlens` command) | ✓ (separate [`@spanlens/cli`](https://www.npmjs.com/package/@spanlens/cli) package) |

`partial` is not used above because every current capability is either fully present or absent in a given SDK. If you need a capability marked ✗ in your language, open an issue. Parity gaps are tracked and prioritized.

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

MIT. See [LICENSE](./LICENSE).

## Links

* [Spanlens dashboard](https://spanlens.io)
* [Proxy docs](https://spanlens.io/docs/proxy)
* [TypeScript SDK](https://www.npmjs.com/package/@spanlens/sdk)
* [GitHub](https://github.com/spanlens/Spanlens)
