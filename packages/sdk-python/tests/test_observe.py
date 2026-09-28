"""Tests for ``observe()`` and the provider-specific observe helpers."""

from __future__ import annotations

import re

import httpx
import pytest
import respx

from spanlens import (
    SpanlensClient,
    observe,
    observe_anthropic,
    observe_ollama,
    observe_openai,
)

BASE_URL = "https://test.spanlens.local"


def _client() -> SpanlensClient:
    return SpanlensClient(api_key="sl_test_dummy", base_url=BASE_URL, silent=False)


def _mock_ingest_routes() -> None:
    respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=httpx.Response(200, json={}))
    respx.post(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")).mock(
        return_value=httpx.Response(200, json={})
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )


# ── Generic observe ─────────────────────────────────────────────


@respx.mock
def test_observe_returns_callable_result():
    _mock_ingest_routes()

    with _client() as client:
        with client.start_trace("t1") as trace:
            result = observe(trace, "step", lambda _span: 42)
            assert result == 42


@respx.mock
def test_observe_propagates_exception_and_marks_error():
    _mock_ingest_routes()

    with _client() as client:
        with client.start_trace("t1") as trace:
            with pytest.raises(ValueError, match="bad"):
                observe(
                    trace,
                    "failing_step",
                    lambda _span: (_ for _ in ()).throw(ValueError("bad")),
                )


@respx.mock
async def test_observe_handles_async_callable():
    _mock_ingest_routes()

    async def slow_op(_span):  # noqa: ANN001 - test fixture
        return "done"

    with _client() as client:
        with client.start_trace("t1") as trace:
            result = await observe(trace, "async_step", slow_op)
            assert result == "done"


# ── Provider observe ────────────────────────────────────────────


@respx.mock
def test_observe_openai_passes_trace_headers_and_parses_usage():
    _mock_ingest_routes()
    captured: dict[str, dict[str, str]] = {}

    fake_response = {
        "model": "gpt-4o-mini",
        "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12},
    }

    def fake_call(headers: dict[str, str]):
        captured["headers"] = headers
        return fake_response

    with _client() as client:
        with client.start_trace("t1") as trace:
            res = observe_openai(trace, "answer", fake_call)
            assert res is fake_response

    assert "x-trace-id" in captured["headers"]
    assert "x-span-id" in captured["headers"]


@respx.mock
def test_observe_openai_threads_prompt_version_header():
    _mock_ingest_routes()
    captured: dict[str, dict[str, str]] = {}

    def fake_call(headers: dict[str, str]):
        captured["headers"] = headers
        return {"usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_openai(trace, "answer", fake_call, prompt_version="bot@latest")

    assert captured["headers"]["x-spanlens-prompt-version"] == "bot@latest"


@respx.mock
def test_observe_anthropic_parses_input_output_tokens():
    _mock_ingest_routes()

    def fake_call(_headers: dict[str, str]):
        return {
            "model": "claude-3-5-sonnet-20241022",
            "usage": {"input_tokens": 100, "output_tokens": 200},
        }

    with _client() as client:
        with client.start_trace("t1") as trace:
            res = observe_anthropic(trace, "msg", fake_call)
            assert res["usage"]["input_tokens"] == 100


@respx.mock
def test_observe_openai_marks_error_when_call_throws():
    _mock_ingest_routes()

    with _client() as client:
        with client.start_trace("t1") as trace:
            with pytest.raises(RuntimeError, match="upstream"):
                observe_openai(
                    trace,
                    "answer",
                    lambda _h: (_ for _ in ()).throw(RuntimeError("upstream")),
                )


# ── Provider tag (Ollama + override) ────────────────────────────


def _last_span_patch_body() -> dict:
    """Return the JSON body of the last ``PATCH /ingest/spans/{id}`` call.

    Tests inspect the patched span row to confirm provider/model metadata
    landed in the right place.
    """
    import json

    routes = respx.routes
    for route in reversed(list(routes)):
        for call in reversed(route.calls):
            if call.request.method == "PATCH" and "/ingest/spans/" in str(call.request.url):
                return json.loads(call.request.content.decode())
    raise AssertionError("no PATCH /ingest/spans/{id} captured")


@respx.mock
def test_observe_openai_default_provider_tag():
    _mock_ingest_routes()

    fake_response = {
        "model": "gpt-4o-mini",
        "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
    }

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_openai(trace, "call", lambda _h: fake_response)

    body = _last_span_patch_body()
    assert body["metadata"]["provider"] == "openai"
    # Model still flows through alongside the new provider tag.
    assert body["metadata"]["model"] == "gpt-4o-mini"


@respx.mock
def test_observe_ollama_parses_openai_shape_and_tags_provider():
    _mock_ingest_routes()

    # Ollama's /v1 endpoint returns OpenAI-shaped JSON.
    fake_response = {
        "model": "llama3.2",
        "usage": {"prompt_tokens": 12, "completion_tokens": 34, "total_tokens": 46},
    }

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_ollama(trace, "chat", lambda _h: fake_response)

    body = _last_span_patch_body()
    assert body["prompt_tokens"] == 12
    assert body["completion_tokens"] == 34
    assert body["total_tokens"] == 46
    assert body["metadata"]["provider"] == "ollama"
    assert body["metadata"]["model"] == "llama3.2"


@respx.mock
def test_observe_openai_provider_override():
    """User points OpenAI SDK at vLLM and overrides the provider tag."""
    _mock_ingest_routes()

    fake_response = {
        "model": "meta-llama/Llama-3-8B",
        "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
    }

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_openai(trace, "vllm-call", lambda _h: fake_response, provider="vllm")

    body = _last_span_patch_body()
    assert body["metadata"]["provider"] == "vllm"


# ── Output / input capture + log_body privacy (C6.4) ────────────


def _bodies(method: str, fragment: str) -> list[dict]:
    """JSON bodies of every captured request whose URL contains ``fragment``."""
    import json

    out: list[dict] = []
    for route in respx.routes:
        for call in route.calls:
            url = str(call.request.url)
            if call.request.method == method and fragment in url:
                out.append(json.loads(call.request.content.decode()))
    return out


def _span_posts() -> list[dict]:
    return [b for b in _bodies("POST", "/spans") if "span_type" in b]


def _span_patches() -> list[dict]:
    return _bodies("PATCH", "/ingest/spans/")


@respx.mock
def test_observe_captures_return_value_as_output():
    _mock_ingest_routes()

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe(trace, "step", lambda _span: {"answer": 42})

    assert _span_patches()[-1]["output"] == {"answer": 42}


@respx.mock
async def test_observe_async_captures_return_value_as_output():
    _mock_ingest_routes()

    async def op(_span):  # noqa: ANN001 - test fixture
        return "done"

    with _client() as client:
        with client.start_trace("t1") as trace:
            await observe(trace, "async_step", op)

    assert _span_patches()[-1]["output"] == "done"


@respx.mock
def test_observe_does_not_capture_streams_as_output():
    _mock_ingest_routes()

    def gen(_span):  # noqa: ANN001 - test fixture
        yield "chunk"

    with _client() as client:
        with client.start_trace("t1") as trace:
            result = observe(trace, "stream", gen)
            assert list(result) == ["chunk"]

    assert "output" not in _span_patches()[-1]


@respx.mock
def test_observe_sends_input_on_span_creation():
    _mock_ingest_routes()

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe(trace, "step", lambda _span: "ok", input={"q": "hi"})

    assert _span_posts()[-1]["input"] == {"q": "hi"}


@respx.mock
@pytest.mark.parametrize("mode", ["meta", "none"])
def test_observe_log_body_meta_or_none_keeps_bodies_out_of_ingest(mode: str):
    _mock_ingest_routes()

    def fn(span):  # noqa: ANN001 - test fixture
        # Even an explicit output passed by user code must not leave.
        span.end(output="secret answer", total_tokens=3)
        return "secret answer"

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe(trace, "step", fn, input="secret prompt", log_body=mode)

    posts = _span_posts()
    patches = _span_patches()
    assert "input" not in posts[-1]
    assert all("output" not in p for p in patches)
    # Metadata still flows: the span ends with its token count.
    assert patches[0]["total_tokens"] == 3


@respx.mock
def test_log_body_meta_also_covers_child_spans():
    _mock_ingest_routes()

    def fn(span):  # noqa: ANN001 - test fixture
        child = span.child("retrieve", input="secret query")
        child.end(output="secret docs")
        return "ok"

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe(trace, "step", fn, log_body="meta")

    assert all("input" not in p for p in _span_posts())
    assert all("output" not in p for p in _span_patches())


@respx.mock
def test_manual_end_then_return_sends_supplementary_output_patch():
    """The streaming pattern: tokens are passed to span.end() inside fn and
    the accumulated text is returned. Both must reach the span (TS parity)."""
    _mock_ingest_routes()

    def fn(span):  # noqa: ANN001 - test fixture
        span.end(prompt_tokens=5, completion_tokens=2, total_tokens=7)
        return "Hello world"

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe(trace, "stream", fn, span_type="llm")

    patches = _span_patches()
    assert len(patches) == 2
    assert patches[0]["total_tokens"] == 7
    assert "output" not in patches[0]
    assert patches[1] == {"output": "Hello world"}


@respx.mock
def test_observe_openai_captures_response_as_output():
    _mock_ingest_routes()
    fake_response = {
        "model": "gpt-4o-mini",
        "choices": [{"message": {"content": "hi there"}}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
    }

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_openai(trace, "call", lambda _h: fake_response)

    body = _span_patches()[-1]
    assert body["output"] == fake_response
    assert body["total_tokens"] == 3


@respx.mock
def test_observe_openai_serializes_sdk_response_models_as_json():
    """OpenAI returns pydantic models. Output must be the JSON view, not a repr."""
    openai_types = pytest.importorskip("openai.types.chat")
    _mock_ingest_routes()
    completion = openai_types.ChatCompletion.model_validate(
        {
            "id": "chatcmpl-1",
            "object": "chat.completion",
            "created": 1,
            "model": "gpt-4o-mini",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "hi there"},
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        }
    )

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_openai(trace, "call", lambda _h: completion)

    output = _span_patches()[-1]["output"]
    assert isinstance(output, dict)
    assert output["choices"][0]["message"]["content"] == "hi there"


@respx.mock
def test_observe_openai_log_body_meta_sets_header_and_skips_output():
    _mock_ingest_routes()
    captured: dict[str, dict[str, str]] = {}

    def fake_call(headers: dict[str, str]):
        captured["headers"] = headers
        return {"usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_openai(trace, "call", fake_call, log_body="meta")

    assert captured["headers"]["x-spanlens-log-body"] == "meta"
    body = _span_patches()[-1]
    assert "output" not in body
    assert body["total_tokens"] == 2


@respx.mock
def test_observe_ollama_defaults_to_meta_so_responses_stay_local():
    _mock_ingest_routes()
    captured: dict[str, dict[str, str]] = {}
    fake_response = {
        "model": "llama3.2",
        "choices": [{"message": {"content": "PRIVATE LOCAL ANSWER"}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 34, "total_tokens": 46},
    }

    def fake_call(headers: dict[str, str]):
        captured["headers"] = headers
        return fake_response

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_ollama(trace, "chat", fake_call, input=[{"role": "user", "content": "x"}])

    assert "input" not in _span_posts()[-1]
    body = _span_patches()[-1]
    assert "output" not in body
    assert body["total_tokens"] == 46
    assert body["metadata"]["provider"] == "ollama"
    assert captured["headers"]["x-spanlens-log-body"] == "meta"


@respx.mock
def test_observe_ollama_full_opt_in_captures_output():
    _mock_ingest_routes()
    fake_response = {
        "model": "llama3.2",
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }

    with _client() as client:
        with client.start_trace("t1") as trace:
            observe_ollama(trace, "chat", lambda _h: fake_response, log_body="full")

    assert _span_patches()[-1]["output"] == fake_response


@respx.mock
def test_observe_rejects_unknown_log_body_before_running_fn():
    _mock_ingest_routes()
    calls: list[int] = []

    with _client() as client:
        trace = client.start_trace("t1")
        with pytest.raises(ValueError, match="log_body"):
            observe(trace, "x", lambda _span: calls.append(1), log_body="metadata")  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="log_body"):
            observe_openai(trace, "x", lambda _h: calls.append(1), log_body="off")  # type: ignore[arg-type]

    assert calls == []
