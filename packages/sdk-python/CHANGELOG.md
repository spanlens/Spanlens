# Changelog

## 0.8.1

### Changed

- Default API host is now `https://api.spanlens.io` (was the legacy `https://spanlens-server.vercel.app`, which continues to work). Affects `DEFAULT_BASE_URL` and the `observe_openai` / `observe_anthropic` / `observe_gemini` default proxy URLs. Set `SPANLENS_BASE_URL` or pass `base_url=` to override either way.

## 0.8.0

FastAPI / ASGI auto-instrumentation — one line traces every HTTP request.

### Added

- `SpanlensMiddleware` (and `install_spanlens_middleware(app, ...)`): add it with `app.add_middleware(SpanlensMiddleware, api_key=...)` (or `client=`) and every request opens a trace + a root span named `"<METHOD> <path>"`. Clean responses end `completed`; a 5xx or unhandled exception ends `error` and the exception is re-raised untouched. The trace is exposed to handlers as `request.state.spanlens` (`{trace, span, headers, trace_id, span_id}`) so nested `observe_*` LLM calls link automatically.
- Sampling and tail-based error capture come from the underlying client, so sampled-out successful requests do zero network I/O while errors are always recorded. Health / metrics / docs routes are skipped by default (`skip_paths=` to override).
- The middleware is pure ASGI (it does not import FastAPI), so it also works with Starlette, Litestar, Quart, and any ASGI app. New `spanlens[fastapi]` optional extra.

### Security

- Query strings are **not** captured into trace metadata by default (they routinely carry secrets/PII: OAuth `code`/`state`, reset tokens, signed-URL signatures). Opt in with `capture_query_string=True`.
- The exception re-raise path uses a `_safe_str` helper so a handler exception whose `__str__` itself raises can never replace the original exception on its way back up.

### Verified

- 8 tests (success trace + `request.state` injection, default-path skipping, error capture + re-raise, build-from-`api_key`, missing-credentials guard, query-string off-by-default + opt-in, and broken-`__str__` re-raise). `ruff` clean; `mypy --strict` clean on the new module.

## 0.7.0

Onboarding CLI release. `pip install spanlens` now also installs a `spanlens` console command that connects a Python project to Spanlens in one step, the same wizard the Node `@spanlens/cli` ships. No extra dependency: it uses only the standard library plus `httpx` (already a runtime dependency).

### Added

- `spanlens init` interactive wizard: detects the package manager (`poetry` / `uv` / `pipenv` / `pip`) and which provider libraries are declared, validates the pasted `sl_live_*` key against `/api/v1/me/key-info`, writes `SPANLENS_API_KEY` into `.env` (idempotent, comment-preserving), installs the right `spanlens[...]` extras, and rewrites client construction to route through the proxy.
- AST-based code patcher (`spanlens.cli.code_patcher`): rewrites `OpenAI(...)` / `AsyncOpenAI(...)` into `create_openai()` / `create_async_openai()`, `Anthropic(...)` / `AsyncAnthropic(...)` into `create_anthropic()` / `create_async_anthropic()`, and `genai.configure(...)` into `configure_gemini()`. It strips `api_key` / `base_url`, preserves every other argument, edits by byte offset so formatting and comments survive, and re-parses each file before writing so a patched file always imports.
- `spanlens test` for a quick key + connectivity check, and `spanlens --version`.
- Flags: `--dry-run`, `--yes` (non-interactive), `--api-key`, `--server-url` (self-hosting).
- `[project.scripts]` entry point so the command is available immediately after install. Output forces UTF-8 so the wizard renders on legacy Windows code pages.

### Fixed

- `configure_gemini()` now passes `transport="rest"` to `genai.configure(...)`. The default gRPC transport ignores an `https://` `api_endpoint`, so Gemini calls silently bypassed the proxy and were never logged. REST transport honours the proxy URL and sends the key as `x-goog-api-key`, which the proxy authenticates. Found during the CLI end-to-end smoke; OpenAI and Anthropic were already routing correctly.

### Verified

- 48 unit tests across env writing, project detection, install-target construction, the AST patcher (including Unicode-offset safety and validity of every emitted file), the key-info client (mocked with `respx`), and the end-to-end wizard in `--dry-run` / `--yes` modes.
- Production smoke: the full wizard ran against `www.spanlens.io`, validated a live key, and previewed then applied a real OpenAI patch.

### Docs

- The `/docs/cli` page now documents the Python CLI alongside the Node wizard, with install, walkthrough, before / after diffs for all three providers, and a flag reference.

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
