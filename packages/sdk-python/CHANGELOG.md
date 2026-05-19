# Changelog

## 0.2.0

Async-first integration release. Verifies the SDK behaves correctly under
FastAPI / Django async views / asyncio.gather pipelines.

* **New:** `create_async_openai()` returning an `openai.AsyncOpenAI` client
  pre-configured for the Spanlens proxy. Drop-in for FastAPI handlers and
  any `await client.chat.completions.create(...)` flow.
* **New:** `create_async_anthropic()` returning an `anthropic.AsyncAnthropic`
  client pre-configured for the Spanlens proxy.
* **New:** test suite verifying `asyncio.gather` of 50 concurrent spans
  preserves trace POST → span POST → span PATCH ordering with no orphaned
  PATCH requests (the failure mode flagged by CLAUDE.md gotcha #10).
* **New:** end-to-end FastAPI integration test (ASGI transport + respx
  mocking) confirming the ASGI lifecycle is compatible with the SDK's
  background thread pool.
* No breaking changes — existing sync callers and `observe*()` async support
  are unchanged.

## 0.1.0

Initial release of the Spanlens Python SDK.

* `SpanlensClient`, `TraceHandle`, `SpanHandle` — core tracing primitives
* Context-manager support so `end()` is called automatically
* `observe()`, `observe_openai()`, `observe_anthropic()`, `observe_gemini()`
  — boilerplate-free helpers with auto-parsed usage
* `create_openai()`, `create_anthropic()`, `create_gemini()`,
  `configure_gemini()` — proxy-mode integrations
* Background ingest with timeout + ordering guarantees so observability
  never blocks user code or loses spans to race conditions
* Sync **and** async callables supported by every `observe*()` helper
