"""Tests for the LangChain / LangGraph callback handler.

Mocks the Spanlens ingest HTTP layer with ``respx`` so we exercise the real
span / trace creation logic and verify the on-wire shape.
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from typing import Any
from uuid import uuid4

import httpx
import pytest
import respx

from spanlens import SpanlensClient
from spanlens.integrations.langchain import SpanlensCallbackHandler

BASE_URL = "https://test.spanlens.local"


# ── Fixtures ──────────────────────────────────────────────────────────────


def _mock_ingest_routes() -> dict[str, respx.MockRouter]:
    """Mock all the ingest endpoints the handler uses; capture posted bodies
    via the route ``calls`` attribute so each test can assert on the shape.
    """
    routes = {
        "trace_post": respx.post(f"{BASE_URL}/ingest/traces").mock(
            return_value=httpx.Response(200, json={})
        ),
        "span_post": respx.post(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")
        ).mock(return_value=httpx.Response(200, json={})),
        "span_patch": respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")).mock(
            return_value=httpx.Response(200, json={})
        ),
        "trace_patch": respx.patch(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")
        ).mock(return_value=httpx.Response(200, json={})),
    }
    return routes


def _client() -> SpanlensClient:
    """Synchronous-flush client suitable for unit tests."""
    return SpanlensClient(api_key="sl_test", base_url=BASE_URL, silent=False)


def _flush(c: SpanlensClient) -> None:
    """Wait briefly so fire-and-forget POST/PATCH chains settle."""
    # The Python SDK uses a thread pool transport; small sleep lets the
    # background thread drain. flush() does this more deterministically.
    try:
        c.flush(timeout=2.0)
    except Exception:
        pass
    # Belt-and-suspenders for tests that already closed the client.
    time.sleep(0.1)


def _bodies(route: respx.MockRouter) -> list[dict[str, Any]]:
    """Return list of JSON request bodies the route received, in order."""
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


# ── 12 scenarios — mirrors the TS PR #137 matrix ─────────────────────────


@respx.mock
def test_llm_start_end_creates_span_with_tokens() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        run_id = uuid4()
        handler.on_llm_start({"id": ["ChatOpenAI"]}, ["hi"], run_id=run_id)
        handler.on_llm_end(
            {
                "llm_output": {
                    "token_usage": {
                        "prompt_tokens": 5,
                        "completion_tokens": 7,
                        "total_tokens": 12,
                    },
                    "model_name": "gpt-4o",
                },
                "generations": [[{"text": "hello"}]],
            },
            run_id=run_id,
        )
        _flush(c)

    span_posts = _bodies(routes["span_post"])
    span_patches = _bodies(routes["span_patch"])
    assert len(span_posts) == 1
    assert span_posts[0]["name"] == "llm.ChatOpenAI"
    assert span_posts[0]["span_type"] == "llm"
    assert len(span_patches) == 1
    assert span_patches[0]["prompt_tokens"] == 5
    assert span_patches[0]["completion_tokens"] == 7
    assert span_patches[0]["total_tokens"] == 12
    assert span_patches[0]["output"] == "hello"


@respx.mock
def test_chain_start_end_captures_input_and_output() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        rid = uuid4()
        handler.on_chain_start({"id": ["langgraph", "plan"]}, {"topic": "tokyo"}, run_id=rid)
        handler.on_chain_end({"steps": ["a", "b"]}, run_id=rid)
        _flush(c)

    span_posts = _bodies(routes["span_post"])
    span_patches = _bodies(routes["span_patch"])
    assert span_posts[0]["name"] == "chain.plan"
    assert span_posts[0]["span_type"] == "custom"
    assert span_posts[0]["input"] == {"topic": "tokyo"}
    assert span_patches[0]["output"] == {"steps": ["a", "b"]}


@respx.mock
def test_parent_child_wiring_via_parent_run_id() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        parent = uuid4()
        child = uuid4()
        handler.on_chain_start({"id": ["LangGraph"]}, {"in": 1}, run_id=parent)
        handler.on_chain_start({"id": ["plan"]}, {"in": 1}, run_id=child, parent_run_id=parent)
        handler.on_chain_end({"plan": "..."}, run_id=child)
        handler.on_chain_end({"done": True}, run_id=parent)
        _flush(c)

    posts = _bodies(routes["span_post"])
    parent_post = next(p for p in posts if p["name"] == "chain.LangGraph")
    child_post = next(p for p in posts if p["name"] == "chain.plan")
    assert "parent_span_id" not in parent_post
    assert child_post["parent_span_id"] == parent_post["id"]


@respx.mock
def test_tool_start_end_captures_input_output() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        rid = uuid4()
        handler.on_tool_start({"id": ["TavilySearch"]}, "best ramen tokyo", run_id=rid)
        handler.on_tool_end(["r1", "r2"], run_id=rid)
        _flush(c)

    posts = _bodies(routes["span_post"])
    patches = _bodies(routes["span_patch"])
    assert posts[0]["name"] == "tool.TavilySearch"
    assert posts[0]["span_type"] == "tool"
    assert posts[0]["input"] == "best ramen tokyo"
    assert patches[0]["output"] == ["r1", "r2"]


@respx.mock
def test_retriever_end_summarises_documents() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        rid = uuid4()
        handler.on_retriever_start({"id": ["PineconeRetriever"]}, "q", run_id=rid)
        handler.on_retriever_end(
            [
                {"page_content": "doc-a", "metadata": {"src": "1"}},
                {"page_content": "doc-b", "metadata": {"src": "2"}},
            ],
            run_id=rid,
        )
        _flush(c)

    posts = _bodies(routes["span_post"])
    patches = _bodies(routes["span_patch"])
    assert posts[0]["name"] == "retrieval.PineconeRetriever"
    assert posts[0]["span_type"] == "retrieval"
    out = patches[0]["output"]
    assert isinstance(out, list) and len(out) == 2
    assert out[0]["page_content"] == "doc-a"


@respx.mock
def test_three_level_span_tree_graph_node_llm() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        graph, node, llm = uuid4(), uuid4(), uuid4()
        handler.on_chain_start({"id": ["LangGraph"]}, {"in": "q"}, run_id=graph)
        handler.on_chain_start({"id": ["execute"]}, {"in": "q"}, run_id=node, parent_run_id=graph)
        handler.on_llm_start({"id": ["ChatOpenAI"]}, ["p"], run_id=llm, parent_run_id=node)
        handler.on_llm_end(
            {
                "llm_output": {
                    "token_usage": {
                        "prompt_tokens": 1,
                        "completion_tokens": 1,
                        "total_tokens": 2,
                    },
                    "model_name": "gpt-4o",
                }
            },
            run_id=llm,
        )
        handler.on_chain_end({"output": "ok"}, run_id=node)
        handler.on_chain_end({"done": True}, run_id=graph)
        _flush(c)

    posts = _bodies(routes["span_post"])
    assert len(posts) == 3
    by_name = {p["name"]: p for p in posts}
    assert "parent_span_id" not in by_name["chain.LangGraph"]
    assert by_name["chain.execute"]["parent_span_id"] == by_name["chain.LangGraph"]["id"]
    assert by_name["llm.ChatOpenAI"]["parent_span_id"] == by_name["chain.execute"]["id"]


@respx.mock
def test_chain_error_ends_span_with_error_status() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        rid = uuid4()
        handler.on_chain_start({"id": ["failing"]}, {}, run_id=rid)
        handler.on_chain_error(RuntimeError("boom"), run_id=rid)
        _flush(c)

    patches = _bodies(routes["span_patch"])
    assert patches[0]["status"] == "error"
    assert "boom" in patches[0]["error_message"]


@respx.mock
def test_capture_chains_false_drops_chain_spans() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c, capture_chains=False)
        rid = uuid4()
        handler.on_chain_start({"id": ["ignored"]}, {}, run_id=rid)
        handler.on_chain_end({}, run_id=rid)
        _flush(c)

    assert _bodies(routes["span_post"]) == []


@respx.mock
def test_capture_tools_false_drops_tool_spans() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c, capture_tools=False)
        rid = uuid4()
        handler.on_tool_start({"id": ["x"]}, "in", run_id=rid)
        handler.on_tool_end("out", run_id=rid)
        _flush(c)

    assert _bodies(routes["span_post"]) == []


@respx.mock
def test_max_input_bytes_truncates_large_chain_input() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c, max_input_bytes=50)
        rid = uuid4()
        big = {"state": "x" * 500}
        handler.on_chain_start({"id": ["big"]}, big, run_id=rid)
        handler.on_chain_end({}, run_id=rid)
        _flush(c)

    posts = _bodies(routes["span_post"])
    inp = posts[0]["input"]
    assert inp["__truncated"] is True
    assert isinstance(inp["preview"], str)
    assert inp["originalBytes"] > 50


@respx.mock
def test_duplicate_chain_end_is_idempotent() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        rid = uuid4()
        handler.on_chain_start({"id": ["x"]}, {}, run_id=rid)
        handler.on_chain_end({}, run_id=rid)
        handler.on_chain_end({}, run_id=rid)  # duplicate
        _flush(c)

    assert len(_bodies(routes["span_patch"])) == 1


@respx.mock
def test_orphan_chain_end_is_silently_ignored() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        handler.on_chain_end({}, run_id=uuid4())  # no prior start
        _flush(c)

    assert _bodies(routes["span_post"]) == []
    assert _bodies(routes["span_patch"]) == []


# ── Concurrent roots on one shared handler (C14.1) ────────────────────────
#
# The docs recommend one handler per process, shared across parallel graph
# invocations. Each root run must get its own trace, end it with its own
# status, and never leave a trace open.


def _trace_id_from_span_url(url: str) -> str:
    match = re.search(r"/ingest/traces/([\w-]+)/spans$", url)
    assert match, url
    return match.group(1)


def _span_trace_ids(routes: dict[str, respx.MockRouter]) -> dict[str, str]:
    """Span name → trace id it was created under."""
    out: dict[str, str] = {}
    for call in routes["span_post"].calls:
        body = json.loads(call.request.content.decode())
        out[body["name"]] = _trace_id_from_span_url(str(call.request.url))
    return out


def _trace_patches(routes: dict[str, respx.MockRouter]) -> dict[str, dict[str, Any]]:
    """Trace id → end PATCH body."""
    out: dict[str, dict[str, Any]] = {}
    for call in routes["trace_patch"].calls:
        trace_id = str(call.request.url).rsplit("/", 1)[-1]
        out[trace_id] = json.loads(call.request.content.decode())
    return out


def _trace_post_ids(routes: dict[str, respx.MockRouter]) -> list[str]:
    return [b["id"] for b in _bodies(routes["trace_post"])]


@respx.mock
def test_parallel_roots_get_their_own_traces_and_statuses() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        a, b = uuid4(), uuid4()
        handler.on_chain_start({"id": ["A"]}, {}, run_id=a)
        handler.on_chain_start({"id": ["B"]}, {}, run_id=b)
        handler.on_chain_error(RuntimeError("B failed"), run_id=b)
        handler.on_chain_end({}, run_id=a)
        _flush(c)

    trace_of = _span_trace_ids(routes)
    patches = _trace_patches(routes)
    assert len(_trace_post_ids(routes)) == 2
    assert trace_of["chain.A"] != trace_of["chain.B"]
    assert patches[trace_of["chain.A"]]["status"] == "completed"
    assert patches[trace_of["chain.B"]]["status"] == "error"


@respx.mock
def test_child_of_a_still_open_root_stays_in_that_roots_trace() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        a, b, tool, later = uuid4(), uuid4(), uuid4(), uuid4()
        handler.on_chain_start({"id": ["A"]}, {}, run_id=a)
        handler.on_chain_start({"id": ["B"]}, {}, run_id=b)
        handler.on_chain_end({}, run_id=a)
        handler.on_tool_start({"id": ["Search"]}, "q", run_id=tool, parent_run_id=b)
        handler.on_tool_end("r", run_id=tool)
        handler.on_chain_error(RuntimeError("boom"), run_id=b)
        # A root that starts after the overlap must not be stuck in a
        # trace nobody ends.
        handler.on_chain_start({"id": ["C"]}, {}, run_id=later)
        handler.on_chain_end({}, run_id=later)
        _flush(c)

    trace_of = _span_trace_ids(routes)
    patches = _trace_patches(routes)
    posted = _trace_post_ids(routes)
    assert trace_of["tool.Search"] == trace_of["chain.B"]
    assert len({trace_of["chain.A"], trace_of["chain.B"], trace_of["chain.C"]}) == 3
    # Every trace that was opened was also closed: no orphan "running" rows.
    assert sorted(posted) == sorted(patches)
    assert patches[trace_of["chain.B"]]["status"] == "error"
    assert patches[trace_of["chain.C"]]["status"] == "completed"


@respx.mock
def test_shared_handler_is_thread_safe_across_concurrent_runs() -> None:
    routes = _mock_ingest_routes()
    workers = 16
    barrier = threading.Barrier(workers)

    def run(handler: SpanlensCallbackHandler, index: int) -> None:
        root, llm = uuid4(), uuid4()
        barrier.wait(timeout=5)
        handler.on_chain_start({"id": [f"graph{index}"]}, {}, run_id=root)
        handler.on_llm_start({"id": [f"llm{index}"]}, ["p"], run_id=llm, parent_run_id=root)
        handler.on_llm_end({"generations": [[{"text": "ok"}]]}, run_id=llm)
        if index % 2:
            handler.on_chain_error(RuntimeError("odd"), run_id=root)
        else:
            handler.on_chain_end({}, run_id=root)

    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        threads = [threading.Thread(target=run, args=(handler, i)) for i in range(workers)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)
        _flush(c)

    trace_of = _span_trace_ids(routes)
    patches = _trace_patches(routes)
    assert len(_trace_post_ids(routes)) == workers
    assert sorted(_trace_post_ids(routes)) == sorted(patches)
    for i in range(workers):
        graph_trace = trace_of[f"chain.graph{i}"]
        assert trace_of[f"llm.llm{i}"] == graph_trace
        expected = "error" if i % 2 else "completed"
        assert patches[graph_trace]["status"] == expected


@respx.mock
async def test_shared_handler_across_interleaved_asyncio_tasks() -> None:
    routes = _mock_ingest_routes()

    async def run(handler: SpanlensCallbackHandler, name: str, fail: bool) -> None:
        root, tool = uuid4(), uuid4()
        handler.on_chain_start({"id": [name]}, {}, run_id=root)
        await asyncio.sleep(0)
        handler.on_tool_start({"id": [f"{name}_tool"]}, "q", run_id=tool, parent_run_id=root)
        await asyncio.sleep(0)
        handler.on_tool_end("r", run_id=tool)
        await asyncio.sleep(0)
        if fail:
            handler.on_chain_error(RuntimeError("x"), run_id=root)
        else:
            handler.on_chain_end({}, run_id=root)

    with _client() as c:
        handler = SpanlensCallbackHandler(client=c)
        await asyncio.gather(run(handler, "one", False), run(handler, "two", True))
        _flush(c)

    trace_of = _span_trace_ids(routes)
    patches = _trace_patches(routes)
    assert trace_of["tool.one_tool"] == trace_of["chain.one"]
    assert trace_of["tool.two_tool"] == trace_of["chain.two"]
    assert trace_of["chain.one"] != trace_of["chain.two"]
    assert patches[trace_of["chain.one"]]["status"] == "completed"
    assert patches[trace_of["chain.two"]]["status"] == "error"


@respx.mock
def test_external_trace_is_shared_by_all_roots_and_never_ended() -> None:
    routes = _mock_ingest_routes()
    with _client() as c:
        external = c.start_trace("owned-by-caller")
        handler = SpanlensCallbackHandler(client=c, trace=external)
        a, b = uuid4(), uuid4()
        handler.on_chain_start({"id": ["A"]}, {}, run_id=a)
        handler.on_chain_start({"id": ["B"]}, {}, run_id=b)
        handler.on_chain_error(RuntimeError("x"), run_id=b)
        handler.on_chain_end({}, run_id=a)
        _flush(c)

        trace_of = _span_trace_ids(routes)
        assert trace_of["chain.A"] == trace_of["chain.B"] == external.trace_id
        assert _trace_post_ids(routes) == [external.trace_id]
        assert _trace_patches(routes) == {}


@respx.mock
def test_sampled_out_error_root_is_still_recorded_when_a_sibling_completes() -> None:
    """Per-root traces keep tail-based error capture working: a completed
    sibling can no longer end (and drop) the trace holding the error."""
    routes = _mock_ingest_routes()
    client = SpanlensClient(api_key="sl_test", base_url=BASE_URL, silent=False, sample_rate=0.0)
    try:
        handler = SpanlensCallbackHandler(client=client)
        a, b = uuid4(), uuid4()
        handler.on_chain_start({"id": ["A"]}, {}, run_id=a)
        handler.on_chain_start({"id": ["B"]}, {}, run_id=b)
        handler.on_chain_end({}, run_id=a)
        handler.on_chain_error(RuntimeError("B failed"), run_id=b)
        _flush(client)
    finally:
        client.close()

    names = [b["name"] for b in _bodies(routes["span_post"])]
    assert names == ["chain.B"]
    assert [p["status"] for p in _bodies(routes["trace_patch"])] == ["error"]


# Sanity that pytest picks up everything in this module — keeps the count
# visible in CI output even when more tests are added later.
def test_module_loaded() -> None:
    """Module import succeeded without langchain-core installed."""
    assert SpanlensCallbackHandler.__name__ == "SpanlensCallbackHandler"
    # `_LCBase` fell back to object when langchain-core is missing — the
    # handler should still be instantiable.
    pytest.importorskip("spanlens.integrations.langchain")
