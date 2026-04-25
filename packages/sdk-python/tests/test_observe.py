"""Tests for ``observe()`` and the provider-specific observe helpers."""

from __future__ import annotations

import re

import httpx
import pytest
import respx

from spanlens import SpanlensClient, observe, observe_anthropic, observe_openai

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
