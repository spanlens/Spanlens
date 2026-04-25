"""End-to-end ingest tests — verifies that ``trace.span().end()`` fires the
expected HTTP requests in the right order.

We intercept httpx with ``respx`` so no real network traffic happens. The
SDK's background thread pool is drained explicitly via ``client.close()``
before assertions, eliminating timing flakes.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
import pytest
import respx

from spanlens import SpanlensClient

BASE_URL = "https://test.spanlens.local"


def _client() -> SpanlensClient:
    return SpanlensClient(
        api_key="sl_test_dummy",
        base_url=BASE_URL,
        timeout_ms=2000,
        silent=False,  # surface errors in tests
    )


def _captured_bodies(route: respx.Route) -> list[dict[str, Any]]:
    """Return the JSON bodies of every request a respx route captured."""
    bodies: list[dict[str, Any]] = []
    for call in route.calls:
        bodies.append(json.loads(call.request.content))
    return bodies


# ── Trace lifecycle ─────────────────────────────────────────────


@respx.mock
def test_trace_lifecycle_posts_then_patches():
    post = respx.post(f"{BASE_URL}/ingest/traces").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    patch = respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )

    with _client() as client:
        with client.start_trace("my_trace", metadata={"user_id": "u1"}) as trace:
            assert trace.trace_id  # uuid4

    assert post.call_count == 1
    assert patch.call_count == 1

    create_body = _captured_bodies(post)[0]
    assert create_body["name"] == "my_trace"
    assert create_body["metadata"] == {"user_id": "u1"}
    assert "started_at" in create_body
    assert create_body["id"]  # client-generated uuid

    end_body = _captured_bodies(patch)[0]
    assert end_body["status"] == "completed"
    assert "ended_at" in end_body


@respx.mock
def test_trace_context_manager_marks_error_on_exception():
    respx.post(f"{BASE_URL}/ingest/traces").mock(
        return_value=httpx.Response(200, json={})
    )
    patch = respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )

    with _client() as client:
        with pytest.raises(RuntimeError, match="boom"):
            with client.start_trace("oops"):
                raise RuntimeError("boom")

    end_body = _captured_bodies(patch)[0]
    assert end_body["status"] == "error"
    assert end_body["error_message"] == "boom"


# ── Span ordering ───────────────────────────────────────────────


@respx.mock
def test_span_post_chains_after_trace_post():
    """The server's POST /ingest/traces/:id/spans verifies the trace exists.
    The SDK must wait for the trace POST to complete before sending the
    span POST — otherwise the server 404s and the span is lost."""
    call_log: list[str] = []

    def trace_response(_request: httpx.Request) -> httpx.Response:
        call_log.append("trace")
        return httpx.Response(200, json={"ok": True})

    def span_response(_request: httpx.Request) -> httpx.Response:
        call_log.append("span")
        return httpx.Response(200, json={"ok": True})

    respx.post(f"{BASE_URL}/ingest/traces").mock(side_effect=trace_response)
    respx.post(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")).mock(
        side_effect=span_response
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )

    with _client() as client:
        trace = client.start_trace("t1")
        span = trace.span("s1", span_type="llm")
        span.end(prompt_tokens=10, completion_tokens=20, total_tokens=30, cost_usd=0.001)
        trace.end()

    assert call_log[0] == "trace"
    assert "span" in call_log[1:]


@respx.mock
def test_span_end_serialises_token_and_cost_fields():
    respx.post(f"{BASE_URL}/ingest/traces").mock(
        return_value=httpx.Response(200, json={})
    )
    respx.post(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")).mock(
        return_value=httpx.Response(200, json={})
    )
    span_patch = respx.patch(
        re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")
    ).mock(return_value=httpx.Response(200, json={}))
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )

    with _client() as client:
        with client.start_trace("t1") as trace:
            with trace.span("s1", span_type="llm") as span:
                span.end(
                    output={"answer": "42"},
                    prompt_tokens=10,
                    completion_tokens=20,
                    total_tokens=30,
                    cost_usd=0.0123,
                    metadata={"model": "gpt-4o"},
                )

    body = _captured_bodies(span_patch)[0]
    assert body["status"] == "completed"
    assert body["output"] == {"answer": "42"}
    assert body["prompt_tokens"] == 10
    assert body["completion_tokens"] == 20
    assert body["total_tokens"] == 30
    assert body["cost_usd"] == 0.0123
    assert body["metadata"] == {"model": "gpt-4o"}


@respx.mock
def test_span_end_is_idempotent():
    respx.post(f"{BASE_URL}/ingest/traces").mock(
        return_value=httpx.Response(200, json={})
    )
    respx.post(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")).mock(
        return_value=httpx.Response(200, json={})
    )
    span_patch = respx.patch(
        re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")
    ).mock(return_value=httpx.Response(200, json={}))
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )

    with _client() as client:
        trace = client.start_trace("t1")
        span = trace.span("s1")
        span.end()
        span.end()  # Should be a no-op
        span.end()  # Same
        trace.end()

    assert span_patch.call_count == 1


# ── trace_headers ───────────────────────────────────────────────


@respx.mock
def test_trace_headers_include_trace_and_span_ids():
    respx.post(f"{BASE_URL}/ingest/traces").mock(
        return_value=httpx.Response(200, json={})
    )
    respx.post(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")).mock(
        return_value=httpx.Response(200, json={})
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )

    with _client() as client:
        trace = client.start_trace("t1")
        span = trace.span("s1")
        headers = span.trace_headers()
        assert headers == {
            "x-trace-id": trace.trace_id,
            "x-span-id": span.span_id,
        }
        span.end()
        trace.end()
