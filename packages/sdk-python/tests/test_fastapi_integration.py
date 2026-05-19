"""FastAPI integration smoke — verify the SDK behaves correctly when used
from inside an async FastAPI handler.

The actual FastAPI / OpenAI packages are optional dev dependencies; the tests
``pytest.importorskip`` them so they're cleanly skipped in minimal CI envs.

What's exercised:
  - Calling ``create_async_openai()`` inside an async route works (no
    event-loop conflicts, no thread-safety issues with httpx)
  - A trace + span lifecycle (start_trace → span → end → end) survives the
    ASGI request lifecycle and produces the expected ingest requests
  - ``observe_openai`` wraps an async OpenAI call cleanly inside a handler

The Spanlens proxy + OpenAI API are both intercepted by respx, so no real
network traffic happens. The test owns the FastAPI app it spins up — no
shared module-level state.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
import pytest
import respx

# Optional deps — skip whole module if not installed
pytest.importorskip("fastapi")
pytest.importorskip("openai")

from fastapi import FastAPI  # noqa: E402
from httpx import ASGITransport  # noqa: E402

from spanlens import SpanlensClient  # noqa: E402
from spanlens.integrations.openai import create_async_openai  # noqa: E402
from spanlens.observe import observe_openai  # noqa: E402

SPANLENS_BASE = "https://test.spanlens.local"
OPENAI_PROXY = f"{SPANLENS_BASE}/proxy/openai/v1"


def _ok_json(body: Any = None) -> httpx.Response:
    return httpx.Response(200, json=body or {"ok": True})


def _make_app(spanlens_client: SpanlensClient) -> FastAPI:
    app = FastAPI()

    @app.post("/chat")
    async def chat(body: dict[str, Any]) -> dict[str, Any]:
        trace = spanlens_client.start_trace(
            "fastapi_chat",
            metadata={"endpoint": "/chat"},
        )

        async def call_openai(headers: dict[str, str]) -> Any:
            client = create_async_openai(
                api_key="sl_test_dummy",
                base_url=OPENAI_PROXY,
            )
            try:
                return await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": body.get("q", "hi")}],
                    extra_headers=headers,
                )
            finally:
                await client.close()

        completion = await observe_openai(trace, "openai_chat", call_openai)
        trace.end(status="completed")
        return {
            "reply": completion.choices[0].message.content,
            "trace_id": trace.trace_id,
        }

    return app


@respx.mock
async def test_fastapi_async_handler_emits_trace_and_span() -> None:
    """End-to-end: a POST to /chat triggers exactly one trace POST, one span
    POST, one OpenAI proxy call, and one span PATCH (the end()).
    """
    trace_route = respx.post(f"{SPANLENS_BASE}/ingest/traces").mock(return_value=_ok_json())
    span_post = respx.post(
        re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/traces/[^/]+/spans"),
    ).mock(return_value=_ok_json())
    span_patch = respx.patch(
        re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/spans/[^/]+"),
    ).mock(return_value=_ok_json())
    trace_patch = respx.patch(
        re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/traces/[^/]+"),
    ).mock(return_value=_ok_json())

    # Mock OpenAI's chat.completions endpoint — the proxy URL becomes
    # /proxy/openai/v1/chat/completions
    openai_route = respx.post(f"{OPENAI_PROXY}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 0,
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "hello back"},
                        "finish_reason": "stop",
                    },
                ],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
            },
        ),
    )

    spanlens_client = SpanlensClient(
        api_key="sl_test_dummy",
        base_url=SPANLENS_BASE,
        timeout_ms=2000,
        silent=False,
    )

    app = _make_app(spanlens_client)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        resp = await client.post("/chat", json={"q": "hi"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"] == "hello back"
    assert isinstance(body["trace_id"], str)

    # Drain the background pool so all PATCHes have fired before assertions
    spanlens_client.close()

    assert trace_route.call_count == 1
    assert span_post.call_count == 1
    assert span_patch.call_count == 1
    assert trace_patch.call_count == 1
    assert openai_route.call_count == 1

    # Verify the OpenAI proxy call carried the Spanlens trace headers,
    # which is the whole point of observe_openai
    openai_req = openai_route.calls[0].request
    assert openai_req.headers.get("x-trace-id") == body["trace_id"]
    assert openai_req.headers.get("x-span-id") is not None


@respx.mock
async def test_fastapi_concurrent_requests_isolate_traces() -> None:
    """Two parallel POST /chat requests each get their own trace_id — no
    cross-contamination between coroutines.
    """
    respx.post(f"{SPANLENS_BASE}/ingest/traces").mock(return_value=_ok_json())
    respx.post(
        re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/traces/[^/]+/spans"),
    ).mock(return_value=_ok_json())
    respx.patch(
        re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/spans/[^/]+"),
    ).mock(return_value=_ok_json())
    respx.patch(
        re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/traces/[^/]+"),
    ).mock(return_value=_ok_json())
    respx.post(f"{OPENAI_PROXY}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "c",
                "object": "chat.completion",
                "created": 0,
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    },
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        ),
    )

    spanlens_client = SpanlensClient(
        api_key="sl_test_dummy",
        base_url=SPANLENS_BASE,
        timeout_ms=2000,
        silent=False,
    )
    app = _make_app(spanlens_client)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as http:
        import asyncio  # local import keeps the module load light

        responses = await asyncio.gather(
            http.post("/chat", json={"q": "a"}),
            http.post("/chat", json={"q": "b"}),
            http.post("/chat", json={"q": "c"}),
        )

    spanlens_client.close()

    trace_ids = {r.json()["trace_id"] for r in responses}
    assert len(trace_ids) == 3  # all unique
    for r in responses:
        assert r.status_code == 200
