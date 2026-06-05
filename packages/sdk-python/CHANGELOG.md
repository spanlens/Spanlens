# Changelog

## 0.6.0

LlamaIndex integration release. Drop `SpanlensCallbackHandler` onto any LlamaIndex query engine, agent, or workflow and every `CBEventType` (LLM, RETRIEVE, EMBEDDING, FUNCTION_CALL, QUERY) becomes a typed Spanlens span with parent / child linkage matching the framework's per-event UUIDs.

### Added

- `spanlens.integrations.llama_index.SpanlensCallbackHandler` — subclasses LlamaIndex's `BaseCallbackHandler` so `Settings.callback_manager.add_handler(handler)` is the entire integration. Maps each event type to a Spanlens `span_type`, extracts token usage from the `response.raw.usage` shape OpenAI / LiteLLM / Anthropic LLM backends share, summarises retrieved nodes (count + top scores) instead of dumping full text, and truncates large inputs / outputs at 16 KB by default.
- Optional dependency: `pip install "spanlens[llama-index]"` (pulls in `llama-index-core>=0.10.0`). Also rolled into the `[all]` extra.
- `llamaindex` / `llama-index` / `langgraph` keywords on the PyPI listing for discoverability.

### Verified

- 7 unit tests with `respx` mock the ingest HTTP layer and exercise event dispatch, parent linkage, exception handling, external-trace lifecycle, and retrieved-node summarisation. Run with `pytest tests/test_integrations_llama_index.py`.
- An integration smoke script (`scripts/test_llama_index_integration.py`) drives a synthetic query through the real `CallbackManager` + `CBEventType` + `EventPayload` from `llama-index-core 0.14.22` and asserts the on-wire shape (trace POST + span POSTs + PATCHes). Setting `SPANLENS_LIVE_URL` switches it to live mode against a real server.

### Docs

- New LlamaIndex docs page at `/docs/integrations/llamaindex` covering install, minimal setup, CBEventType → span_type mapping, trace-tree shape, long-lived trace lifecycle, proxy pairing for cost, and prompt-version linking.

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
