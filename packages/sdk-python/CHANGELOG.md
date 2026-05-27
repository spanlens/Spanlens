# Changelog

## 0.5.1

PyPI metadata fixes + docs polish. No runtime API changes (already-shipped 0.5 features remain identical: `SpanlensCallbackHandler` for LangChain / LangGraph, `observe_ollama`, async helpers, sampling).

### Fixed

- `Repository` and `Issues` URLs in `pyproject.toml` pointed at the legacy `sunes26/Spanlens` GitHub org. PyPI sidebar links were 404. Updated to `spanlens/Spanlens`.

### Added

- New `[langchain]` optional dependency (`pip install "spanlens[langchain]"` now pulls in `langchain-core>=0.1.0`). Also rolled into the `[all]` extra. The `SpanlensCallbackHandler` already shipped in 0.5.0 but users had to install LangChain manually.
- `ollama` keyword for PyPI search discoverability.
- `Changelog` URL so the PyPI sidebar links straight to `CHANGELOG.md`.

### Docs

- New Ollama section in the README documenting `observe_ollama()` against a local Ollama via the OpenAI-compatible client.
- New LangChain / LangGraph section showing the `SpanlensCallbackHandler` plug-in pattern.
- Em dash removal across the README and the package description for a cleaner read on the PyPI page.

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
