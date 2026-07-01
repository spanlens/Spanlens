"""Tests for SpanlensMiddleware — the FastAPI/ASGI auto-instrumentation.

The whole SDK transport is intercepted by respx, so no real network happens.
Each test owns its own FastAPI app + client (no shared module state).
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
import pytest
import respx

pytest.importorskip("fastapi")

from fastapi import FastAPI, Request  # noqa: E402
from httpx import ASGITransport  # noqa: E402

from spanlens import SpanlensClient, SpanlensMiddleware  # noqa: E402

SPANLENS_BASE = "https://test.spanlens.local"


def _ok() -> httpx.Response:
    return httpx.Response(200, json={"ok": True})


def _mock_ingest() -> dict[str, respx.Route]:
    return {
        "trace_post": respx.post(f"{SPANLENS_BASE}/ingest/traces").mock(return_value=_ok()),
        "span_post": respx.post(
            re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/traces/[^/]+/spans"),
        ).mock(return_value=_ok()),
        "span_patch": respx.patch(
            re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/spans/[^/]+"),
        ).mock(return_value=_ok()),
        "trace_patch": respx.patch(
            re.compile(rf"{re.escape(SPANLENS_BASE)}/ingest/traces/[^/]+"),
        ).mock(return_value=_ok()),
    }


def _make_client() -> SpanlensClient:
    return SpanlensClient(api_key="sl_test_dummy", base_url=SPANLENS_BASE, silent=False)


def _bodies(route: respx.Route) -> list[dict[str, Any]]:
    return [json.loads(call.request.content) for call in route.calls]


@respx.mock
async def test_middleware_traces_successful_request() -> None:
    routes = _mock_ingest()
    client = _make_client()

    app = FastAPI()
    app.add_middleware(SpanlensMiddleware, client=client)

    @app.get("/items/{item_id}")
    async def read_item(item_id: str, request: Request) -> dict[str, Any]:
        sl = request.state.spanlens
        return {"item_id": item_id, "trace_id": sl["trace_id"], "span_id": sl["span_id"]}

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver",
    ) as http:
        resp = await http.get("/items/42")

    assert resp.status_code == 200
    body = resp.json()
    # Handler could read request.state.spanlens (proves injection worked).
    assert body["item_id"] == "42"
    assert isinstance(body["trace_id"], str)

    client.close()

    assert routes["trace_post"].call_count == 1
    assert routes["span_post"].call_count == 1
    assert routes["span_patch"].call_count == 1
    assert routes["trace_patch"].call_count == 1

    # Trace POST carries method + path metadata; name is "<METHOD> <path>".
    trace_body = _bodies(routes["trace_post"])[0]
    assert trace_body["name"] == "GET /items/42"
    assert trace_body["metadata"]["method"] == "GET"
    assert trace_body["metadata"]["path"] == "/items/42"

    # Both end PATCHes are completed.
    assert _bodies(routes["span_patch"])[0]["status"] == "completed"
    assert _bodies(routes["trace_patch"])[0]["status"] == "completed"


@respx.mock
async def test_middleware_skips_configured_paths() -> None:
    routes = _mock_ingest()
    client = _make_client()

    app = FastAPI()
    app.add_middleware(SpanlensMiddleware, client=client)  # default skip list

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver",
    ) as http:
        resp = await http.get("/health")

    assert resp.status_code == 200
    client.close()

    # No trace created for a skipped path.
    assert routes["trace_post"].call_count == 0
    assert routes["span_post"].call_count == 0


@respx.mock
async def test_middleware_records_error_and_reraises() -> None:
    routes = _mock_ingest()
    client = _make_client()

    app = FastAPI()
    app.add_middleware(SpanlensMiddleware, client=client)

    @app.get("/boom")
    async def boom() -> dict[str, Any]:
        raise ValueError("kaboom")

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=True),
        base_url="http://testserver",
    ) as http:
        with pytest.raises(ValueError, match="kaboom"):
            await http.get("/boom")

    client.close()

    # The trace + span still opened, and both ended with error status.
    assert routes["trace_post"].call_count == 1
    assert routes["span_post"].call_count == 1
    span_patch = _bodies(routes["span_patch"])[0]
    trace_patch = _bodies(routes["trace_patch"])[0]
    assert span_patch["status"] == "error"
    assert span_patch["error_message"] == "kaboom"
    assert trace_patch["status"] == "error"


@respx.mock
async def test_middleware_builds_client_from_api_key() -> None:
    """When no client is passed, the middleware builds one from api_key and the
    request still succeeds (the request path must never depend on the trace
    flush, which is fire-and-forget on an internally-owned pool)."""
    _mock_ingest()

    app = FastAPI()
    app.add_middleware(
        SpanlensMiddleware,
        api_key="sl_test_dummy",
        base_url=SPANLENS_BASE,
    )

    @app.get("/ping-me")
    async def ping_me() -> dict[str, str]:
        return {"pong": "1"}

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver",
    ) as http:
        resp = await http.get("/ping-me")

    assert resp.status_code == 200
    assert resp.json() == {"pong": "1"}


def test_middleware_requires_client_or_api_key() -> None:
    app = FastAPI()
    with pytest.raises(ValueError, match="client= or api_key="):
        # add_middleware defers instantiation until the app builds its stack;
        # trigger it by constructing directly.
        SpanlensMiddleware(app)
