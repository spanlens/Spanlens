"""Tests for the LlamaIndex callback handler.

Mocks the Spanlens ingest HTTP layer with ``respx`` and exercises the real
span/trace creation logic to verify the on-wire shape. These tests run
without LlamaIndex installed — the handler falls back to a plain base class
exactly so we can drive it with raw dicts here.

A separate scripts/test-llama-index-integration.py exercises a real
LlamaIndex query engine end-to-end against a live local Spanlens server.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx
import pytest
import respx

from spanlens import SpanlensClient
from spanlens.integrations.llama_index import SpanlensCallbackHandler

BASE_URL = "https://test.spanlens.local"


# ── Fixtures ──────────────────────────────────────────────────────────────


def _mock_ingest_routes() -> dict[str, respx.MockRouter]:
    routes = {
        "trace_post": respx.post(f"{BASE_URL}/ingest/traces").mock(
            return_value=httpx.Response(200, json={})
        ),
        "span_post": respx.post(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")
        ).mock(return_value=httpx.Response(200, json={})),
        "span_patch": respx.patch(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")
        ).mock(return_value=httpx.Response(200, json={})),
        "trace_patch": respx.patch(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")
        ).mock(return_value=httpx.Response(200, json={})),
    }
    return routes


def _client() -> SpanlensClient:
    return SpanlensClient(api_key="sl_test", base_url=BASE_URL, silent=False)


def _flush(c: SpanlensClient) -> None:
    try:
        c.flush(timeout=2.0)
    except Exception:
        pass
    time.sleep(0.1)


def _bodies(route: respx.MockRouter) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for call in route.calls:
        raw = call.request.content
        if not raw:
            continue
        try:
            out.append(json.loads(raw.decode()))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    return out


# ── Tests ────────────────────────────────────────────────────────────────


@pytest.mark.respx(base_url=BASE_URL)
def test_start_trace_creates_trace_post() -> None:
    """A bare start_trace must POST /ingest/traces with the configured name."""
    with respx.mock:
        routes = _mock_ingest_routes()
        client = _client()
        handler = SpanlensCallbackHandler(client=client, trace_name="rag_query")
        try:
            handler.start_trace(trace_id="ignored-id")
            handler.end_trace()
            _flush(client)

            traces = _bodies(routes["trace_post"])
            assert len(traces) == 1, f"expected 1 trace POST, got {len(traces)}"
            assert traces[0].get("name") == "rag_query"

            patches = _bodies(routes["trace_patch"])
            assert len(patches) == 1
            assert patches[0].get("status") == "completed"
        finally:
            client.close()


@pytest.mark.respx(base_url=BASE_URL)
def test_llm_event_records_span_with_usage() -> None:
    """An LLM event_start + event_end with usage on the payload must produce a
    span POST with span_type=llm and a span PATCH carrying token counts."""

    class _FakeUsage:
        def __init__(self) -> None:
            self.prompt_tokens = 120
            self.completion_tokens = 45
            self.total_tokens = 165

    class _FakeRaw:
        def __init__(self) -> None:
            self.usage = _FakeUsage()
            self.model = "gpt-4o-mini-2024-07-18"

    class _FakeResponse:
        def __init__(self) -> None:
            self.raw = _FakeRaw()

    with respx.mock:
        routes = _mock_ingest_routes()
        client = _client()
        handler = SpanlensCallbackHandler(client=client)
        try:
            handler.start_trace()
            handler.on_event_start(
                event_type="llm",
                payload={"messages": [{"role": "user", "content": "what is RAG?"}]},
                event_id="llm-1",
                parent_id="root",
            )
            handler.on_event_end(
                event_type="llm",
                payload={"response": _FakeResponse()},
                event_id="llm-1",
            )
            handler.end_trace()
            _flush(client)

            spans = _bodies(routes["span_post"])
            assert len(spans) == 1
            assert spans[0].get("span_type") == "llm"
            assert spans[0].get("name") == "llama_index.llm"

            patches = _bodies(routes["span_patch"])
            assert len(patches) == 1
            patch = patches[0]
            assert patch.get("status") == "completed"
            assert patch.get("prompt_tokens") == 120
            assert patch.get("completion_tokens") == 45
            assert patch.get("total_tokens") == 165
            meta = patch.get("metadata") or {}
            assert meta.get("model") == "gpt-4o-mini-2024-07-18"
        finally:
            client.close()


@pytest.mark.respx(base_url=BASE_URL)
def test_parent_id_creates_child_span() -> None:
    """parent_id linkage must surface as ``parent_span_id`` on the child's
    span POST body (all spans POST to the same /ingest/traces/{tid}/spans
    endpoint; the parent reference is on the body, not on the URL path).
    """
    with respx.mock:
        routes = _mock_ingest_routes()
        client = _client()
        handler = SpanlensCallbackHandler(client=client)
        try:
            handler.start_trace()
            handler.on_event_start(
                event_type="query",
                payload={"query_str": "what is RAG?"},
                event_id="query-1",
                parent_id="root",
            )
            handler.on_event_start(
                event_type="retrieve",
                payload={"query_str": "what is RAG?"},
                event_id="retrieve-1",
                parent_id="query-1",  # child of the QUERY span
            )
            handler.on_event_end(event_type="retrieve", payload=None, event_id="retrieve-1")
            handler.on_event_end(event_type="query", payload=None, event_id="query-1")
            handler.end_trace()
            _flush(client)

            spans = _bodies(routes["span_post"])
            assert len(spans) == 2, f"expected 2 spans, got {len(spans)}"

            by_name = {s["name"]: s for s in spans}
            assert "llama_index.query" in by_name
            assert "llama_index.retrieve" in by_name

            query_span = by_name["llama_index.query"]
            retrieve_span = by_name["llama_index.retrieve"]

            # Query span is attached to trace root — no parent_span_id.
            assert query_span.get("parent_span_id") in (None, "")
            # Retrieve span references the query span as its parent.
            assert retrieve_span.get("parent_span_id") == query_span["id"]
            assert retrieve_span.get("span_type") == "retrieval"
        finally:
            client.close()


@pytest.mark.respx(base_url=BASE_URL)
def test_ignored_event_types_skip_span_creation() -> None:
    """Default ignore set (chunking, node_parsing, templating) must not
    produce any span traffic."""
    with respx.mock:
        routes = _mock_ingest_routes()
        client = _client()
        handler = SpanlensCallbackHandler(client=client)
        try:
            handler.start_trace()
            for ignored in ("chunking", "node_parsing", "templating"):
                handler.on_event_start(
                    event_type=ignored,
                    payload=None,
                    event_id=f"{ignored}-1",
                    parent_id="root",
                )
                handler.on_event_end(event_type=ignored, payload=None, event_id=f"{ignored}-1")
            handler.end_trace()
            _flush(client)

            # Trace lifecycle posts still happen — only spans are skipped.
            assert len(_bodies(routes["span_post"])) == 0
            assert len(_bodies(routes["span_patch"])) == 0
        finally:
            client.close()


@pytest.mark.respx(base_url=BASE_URL)
def test_exception_payload_marks_span_as_error() -> None:
    """When payload carries an `exception`, the span PATCH should have
    status='error' and the exception message on the body."""
    with respx.mock:
        routes = _mock_ingest_routes()
        client = _client()
        handler = SpanlensCallbackHandler(client=client)
        try:
            handler.start_trace()
            handler.on_event_start(
                event_type="llm",
                payload={"messages": []},
                event_id="bad-1",
                parent_id="root",
            )
            handler.on_event_end(
                event_type="llm",
                payload={"exception": RuntimeError("rate limit")},
                event_id="bad-1",
            )
            handler.end_trace()
            _flush(client)

            patches = _bodies(routes["span_patch"])
            assert len(patches) == 1
            assert patches[0].get("status") == "error"
            assert "rate limit" in (patches[0].get("error_message") or "")
        finally:
            client.close()


@pytest.mark.respx(base_url=BASE_URL)
def test_external_trace_lifecycle_not_managed_by_handler() -> None:
    """When the caller passes their own TraceHandle, end_trace must NOT
    close it — the caller owns the lifecycle."""
    with respx.mock:
        routes = _mock_ingest_routes()
        client = _client()
        external = client.start_trace("user_workflow")
        handler = SpanlensCallbackHandler(client=client, trace=external)
        try:
            handler.start_trace()  # no-op — external trace exists
            handler.on_event_start(
                event_type="llm",
                payload={"messages": []},
                event_id="x",
                parent_id="root",
            )
            handler.on_event_end(event_type="llm", payload=None, event_id="x")
            handler.end_trace()  # must NOT close `external`
            _flush(client)

            trace_patches = _bodies(routes["trace_patch"])
            # 0 — the caller will close `external` themselves.
            assert trace_patches == [] or all(
                p.get("status") != "completed" for p in trace_patches
            )
        finally:
            external.end(status="completed")
            client.close()


@pytest.mark.respx(base_url=BASE_URL)
def test_retrieved_nodes_summarised_not_dumped() -> None:
    """RETRIEVE event_end should record node count + top scores, not the full
    text of every retrieved node (which can be huge)."""

    class _FakeNode:
        def __init__(self, score: float) -> None:
            self.score = score

    nodes = [_FakeNode(0.92), _FakeNode(0.88), _FakeNode(0.81)]
    with respx.mock:
        routes = _mock_ingest_routes()
        client = _client()
        handler = SpanlensCallbackHandler(client=client)
        try:
            handler.start_trace()
            handler.on_event_start(
                event_type="retrieve",
                payload={"query_str": "what is RAG?"},
                event_id="r-1",
                parent_id="root",
            )
            handler.on_event_end(
                event_type="retrieve",
                payload={"nodes": nodes},
                event_id="r-1",
            )
            handler.end_trace()
            _flush(client)

            patches = _bodies(routes["span_patch"])
            assert len(patches) == 1
            output = patches[0].get("output") or {}
            assert output.get("node_count") == 3
            assert output.get("top_scores") == [0.92, 0.88, 0.81]
        finally:
            client.close()
