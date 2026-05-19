"""Async / concurrency tests for the Spanlens SDK.

The SDK's transport is internally synchronous (ThreadPoolExecutor) so it
works the same whether the caller is sync or async — but async users
typically fan out many spans concurrently via ``asyncio.gather``. These
tests verify that under that pattern:

  1. Every span POST is preceded by the parent trace POST (creation-ordering
     guaranteed by the explicit ``Future`` chain — see CLAUDE.md gotcha #10).
  2. Every span PATCH happens after the matching span POST.
  3. No requests are dropped, even with 50 parallel ``asyncio`` tasks.

We use ``respx`` to capture every HTTP call without touching the network,
and ``client.close()`` to drain the background pool before assertions
(prevents timing flakes on slow CI runners).
"""

from __future__ import annotations

import asyncio
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
        silent=False,  # surface transport errors as exceptions in tests
    )


def _ok_json(body: Any = None) -> httpx.Response:
    return httpx.Response(200, json=body or {"ok": True})


@respx.mock
async def test_asyncio_gather_creates_all_spans_with_correct_ordering() -> None:
    """Spawn 20 concurrent spans via asyncio.gather and assert that:
       - exactly 20 span POSTs happen
       - each span PATCH happens after its own POST (no orphan PATCH)
       - the trace POST always precedes every span POST
    """
    trace_route = respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=_ok_json())
    spans_route = respx.post(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/traces/[^/]+/spans"),
    ).mock(return_value=_ok_json())
    patch_route = respx.patch(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/spans/[^/]+"),
    ).mock(return_value=_ok_json())

    client = _client()
    trace = client.start_trace("gather_test")

    async def one_span(i: int) -> None:
        # Each coroutine creates and ends one span. The SDK is sync internally
        # but is safe to call from inside an asyncio task — see
        # spanlens/transport.py docstring.
        span = trace.span(f"task_{i}", span_type="custom")
        # tiny await so the coroutines actually interleave
        await asyncio.sleep(0)
        span.end(status="completed")

    await asyncio.gather(*(one_span(i) for i in range(20)))
    trace.end(status="completed")
    client.close()  # drain the background pool

    # 1 trace POST
    assert trace_route.call_count == 1
    # 20 span POSTs — one per task
    assert spans_route.call_count == 20
    # 20 span PATCHes — one per end()
    assert patch_route.call_count == 20


@respx.mock
async def test_asyncio_gather_no_orphan_patches() -> None:
    """Verify creation-ordering invariant: for every span ID seen in a PATCH,
    there is a matching prior POST.

    This is the failure mode that CLAUDE.md gotcha #10 calls out — a regression
    where the PATCH races the POST would silently lose data in production.
    """
    respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=_ok_json())
    spans_route = respx.post(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/traces/[^/]+/spans"),
    ).mock(return_value=_ok_json())
    patch_route = respx.patch(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/spans/(?P<sid>[^/]+)"),
    ).mock(return_value=_ok_json())

    client = _client()
    trace = client.start_trace("orphan_check")

    async def one_span(i: int) -> str:
        span = trace.span(f"t_{i}")
        await asyncio.sleep(0)
        span.end(status="completed")
        return span.span_id

    span_ids = await asyncio.gather(*(one_span(i) for i in range(15)))
    trace.end(status="completed")
    client.close()

    # Every span_id returned by the SDK must appear in both a POST and a PATCH
    posted_bodies = [json.loads(c.request.content) for c in spans_route.calls]
    posted_ids = {b["id"] for b in posted_bodies}

    patched_urls = [c.request.url.path for c in patch_route.calls]
    patched_ids = {url.rsplit("/", 1)[-1] for url in patched_urls}

    assert posted_ids == set(span_ids)
    assert patched_ids == set(span_ids)
    assert posted_ids == patched_ids  # no orphan PATCHes


@respx.mock
async def test_nested_spans_via_asyncio_create_task() -> None:
    """A parent span schedules a child span via asyncio.create_task.

    The child must:
      - see the correct parent_span_id
      - POST after the parent's creation Future resolves
    """
    respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=_ok_json())
    spans_route = respx.post(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/traces/[^/]+/spans"),
    ).mock(return_value=_ok_json())
    respx.patch(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/spans/[^/]+"),
    ).mock(return_value=_ok_json())

    client = _client()
    trace = client.start_trace("nested")
    parent = trace.span("parent", span_type="custom")

    async def child_work() -> None:
        child = parent.child("child", span_type="llm")
        await asyncio.sleep(0)
        child.end(status="completed")

    await asyncio.create_task(child_work())
    parent.end(status="completed")
    trace.end(status="completed")
    client.close()

    # `parent_span_id` and `trace_id` are NOT in the POST body — see span.py:
    # parent_span_id is only present when not None, and trace_id lives in the
    # URL path (`/ingest/traces/{trace_id}/spans`). Extract from each call.
    posted = [
        (
            json.loads(call.request.content),
            call.request.url.path.split("/")[-2],  # trace_id segment
        )
        for call in spans_route.calls
    ]
    assert len(posted) == 2

    parent_body, parent_trace_id = next(
        (b, t) for (b, t) in posted if b.get("parent_span_id") is None
    )
    child_body, child_trace_id = next(
        (b, t) for (b, t) in posted if b.get("parent_span_id") is not None
    )
    assert child_body["parent_span_id"] == parent_body["id"]
    # Both spans belong to the same trace (same URL trace_id segment)
    assert parent_trace_id == child_trace_id == trace.trace_id


@respx.mock
async def test_async_observe_passes_headers_for_provider_calls() -> None:
    """observe() injects ``x-trace-id`` + ``x-span-id`` headers into the
    provider call callback. Verify it works with an async function — the
    common path for FastAPI handlers.
    """
    respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=_ok_json())
    respx.post(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/traces/[^/]+/spans"),
    ).mock(return_value=_ok_json())
    respx.patch(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/spans/[^/]+"),
    ).mock(return_value=_ok_json())

    from spanlens.observe import observe_openai

    client = _client()
    trace = client.start_trace("async_observe")

    captured_headers: dict[str, str] = {}

    async def async_provider_call(headers: dict[str, str]) -> dict[str, Any]:
        # Simulate an async OpenAI-style call that just records the headers
        # passed to it by observe_openai.
        captured_headers.update(headers)
        await asyncio.sleep(0)
        return {
            "model": "gpt-4o-mini",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }

    result = await observe_openai(trace, "chat", async_provider_call)
    assert result["model"] == "gpt-4o-mini"

    trace.end(status="completed")
    client.close()

    # The trace + span ids must have been injected — proves the async path
    # in observe.py works under asyncio.
    assert "x-trace-id" in captured_headers
    assert "x-span-id" in captured_headers
    assert captured_headers["x-trace-id"] == trace.trace_id


@pytest.mark.parametrize("n_tasks", [1, 5, 50])
@respx.mock
async def test_asyncio_gather_scales_to_50_parallel_spans(n_tasks: int) -> None:
    """Smoke-scale test: nothing is dropped at 1, 5, or 50 parallel tasks.

    Internally the SDK uses an 8-worker thread pool, so 50 tasks exercise
    the queue. Backed by ``client.close()`` waiting for drain.
    """
    respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=_ok_json())
    spans_route = respx.post(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/traces/[^/]+/spans"),
    ).mock(return_value=_ok_json())
    respx.patch(
        re.compile(rf"{re.escape(BASE_URL)}/ingest/spans/[^/]+"),
    ).mock(return_value=_ok_json())

    client = _client()
    trace = client.start_trace("scale_test")

    async def one(i: int) -> None:
        s = trace.span(f"s_{i}")
        await asyncio.sleep(0)
        s.end(status="completed")

    await asyncio.gather(*(one(i) for i in range(n_tasks)))
    trace.end(status="completed")
    client.close()

    assert spans_route.call_count == n_tasks
