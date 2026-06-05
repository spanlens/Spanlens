"""End-to-end smoke test for the LlamaIndex callback handler.

Unlike ``tests/test_integrations_llama_index.py`` which drives the handler
with raw dicts (so it can run without LlamaIndex installed), this script
imports the **real** LlamaIndex ``CallbackManager`` / ``CBEventType`` /
``EventPayload`` and drives a synthetic agent run through it. We verify that
our handler:

  1. Subclasses LlamaIndex's ``BaseCallbackHandler`` cleanly (no MRO errors,
     no abstract methods missed).
  2. Receives the actual enum values LlamaIndex uses (CBEventType.LLM etc.)
     and routes them to the correct Spanlens span_type.
  3. Produces a valid wire shape (trace POST → span POSTs → span PATCHes →
     trace PATCH) when CallbackManager fires events end-to-end.

We mock the HTTP layer with respx so the script needs no live server. To
run it against a live server, set ``SPANLENS_LIVE_URL=http://localhost:3001``
and ``SPANLENS_LIVE_KEY=sl_live_...``.

    python scripts/test_llama_index_integration.py

Exit codes: 0 = all assertions passed. 1 = wire shape mismatch.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, List

import httpx
import respx

# Import the REAL LlamaIndex enums and base class — fail loud if missing.
try:
    from llama_index.core.callbacks import CallbackManager, CBEventType, EventPayload
    from llama_index.core.callbacks.base_handler import BaseCallbackHandler as LIBase
except ImportError as e:
    print(f"FAIL: llama-index-core not installed: {e}", file=sys.stderr)
    sys.exit(2)

from spanlens import SpanlensClient
from spanlens.integrations.llama_index import SpanlensCallbackHandler

# ── Assertions on import-time wiring ───────────────────────────────────────


def assert_subclass_relationship() -> None:
    """Our handler must be a real subclass of LlamaIndex's base — otherwise
    CallbackManager would silently ignore it."""
    assert issubclass(SpanlensCallbackHandler, LIBase), (
        "SpanlensCallbackHandler is NOT a subclass of llama_index "
        "BaseCallbackHandler. CallbackManager will reject it."
    )
    print("[ok] SpanlensCallbackHandler is a real LlamaIndex BaseCallbackHandler subclass")


# ── Wire-shape verification under real CallbackManager ─────────────────────


def _bodies(route: respx.Route) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for call in route.calls:
        raw = call.request.content
        if not raw:
            continue
        try:
            out.append(json.loads(raw.decode()))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    return out


def run_synthetic_query() -> Dict[str, List[Dict[str, Any]]]:
    """Drive a minimal LlamaIndex-style query through CallbackManager and
    return the captured wire bodies."""
    base = os.environ.get("SPANLENS_LIVE_URL", "https://test.spanlens.local")
    api_key = os.environ.get("SPANLENS_LIVE_KEY", "sl_test_smoke")
    using_live = "SPANLENS_LIVE_URL" in os.environ

    def _scenario(client: SpanlensClient) -> Dict[str, List[Dict[str, Any]]]:
        handler = SpanlensCallbackHandler(
            client=client,
            trace_name="li_smoke_query",
        )
        cb_mgr = CallbackManager([handler])

        # Mimic what a real query engine does: outer QUERY event wrapping
        # RETRIEVE + LLM. We use the real CallbackManager.event() context
        # managers — this is the exact dispatch path LlamaIndex pipelines
        # use internally.
        with cb_mgr.as_trace("smoke_query"):
            with cb_mgr.event(
                CBEventType.QUERY, payload={EventPayload.QUERY_STR: "what is RAG?"}
            ) as query_evt:

                with cb_mgr.event(
                    CBEventType.RETRIEVE,
                    payload={EventPayload.QUERY_STR: "what is RAG?"},
                ) as retr_evt:
                    # Fake the retrieved nodes shape so our handler exercises
                    # the node-summarisation branch.
                    class _FakeNode:
                        def __init__(self, score: float) -> None:
                            self.score = score

                    retr_evt.on_end(
                        payload={
                            EventPayload.NODES: [_FakeNode(0.91), _FakeNode(0.85)]
                        }
                    )

                with cb_mgr.event(
                    CBEventType.LLM,
                    payload={
                        EventPayload.MESSAGES: [
                            {"role": "user", "content": "what is RAG?"}
                        ]
                    },
                ) as llm_evt:
                    class _U:
                        prompt_tokens = 120
                        completion_tokens = 45
                        total_tokens = 165

                    class _Raw:
                        usage = _U()
                        model = "gpt-4o-mini-2024-07-18"

                    class _Resp:
                        raw = _Raw()

                    llm_evt.on_end(payload={EventPayload.RESPONSE: _Resp()})

                query_evt.on_end(payload={EventPayload.RESPONSE: "RAG is..."})

        # NOTE: SpanlensClient has no explicit flush() — `close()` drains
        # the in-flight pool. We let the wrapping function call close().
        return {}  # filled in by the wrapping function

    if using_live:
        client = SpanlensClient(api_key=api_key, base_url=base, silent=False)
        try:
            _scenario(client)
            print(f"[ok] LIVE mode: events flushed to {base}")
            return {"trace_post": [], "span_post": [], "span_patch": [], "trace_patch": []}
        finally:
            client.close()

    # NOTE: must use bare ``respx.mock`` attribute (no call) — calling it
    # like ``respx.mock(...)`` returns a fresh router whose patches don't
    # always cover the httpx.Client instances that the background transport
    # thread spawns. Unit tests use bare ``with respx.mock:``.

    with respx.mock:
        routes = {
            "trace_post": respx.post(f"{base}/ingest/traces").mock(
                return_value=httpx.Response(200, json={})
            ),
            "span_post": respx.post(
                re.compile(rf"^{re.escape(base)}/ingest/traces/[\w-]+/spans$")
            ).mock(return_value=httpx.Response(200, json={})),
            "span_patch": respx.patch(
                re.compile(rf"^{re.escape(base)}/ingest/spans/[\w-]+$")
            ).mock(return_value=httpx.Response(200, json={})),
            "trace_patch": respx.patch(
                re.compile(rf"^{re.escape(base)}/ingest/traces/[\w-]+$")
            ).mock(return_value=httpx.Response(200, json={})),
        }
        client = SpanlensClient(api_key=api_key, base_url=base, silent=False)
        try:
            _scenario(client)
        finally:
            client.close()
        return {k: _bodies(r) for k, r in routes.items()}


def verify_wire_shape(captured: Dict[str, List[Dict[str, Any]]]) -> None:
    traces = captured["trace_post"]
    spans = captured["span_post"]
    span_patches = captured["span_patch"]
    trace_patches = captured["trace_patch"]

    # ── Trace lifecycle ────────────────────────────────────────────────
    assert len(traces) == 1, f"expected 1 trace POST, got {len(traces)}: {traces}"
    assert traces[0].get("name") == "li_smoke_query", (
        f"trace name should be the user-provided trace_name, got {traces[0].get('name')!r}"
    )
    assert len(trace_patches) == 1, f"expected 1 trace PATCH, got {len(trace_patches)}"
    assert trace_patches[0].get("status") == "completed"
    print(f"[ok] Trace: 1 POST + 1 PATCH (completed), name={traces[0].get('name')!r}")

    # ── Spans by type ──────────────────────────────────────────────────
    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for s in spans:
        by_type.setdefault(s.get("span_type", "?"), []).append(s)

    assert "llm" in by_type, f"no llm span produced. seen types: {list(by_type)}"
    assert "retrieval" in by_type, f"no retrieval span. seen: {list(by_type)}"
    # QUERY event maps to 'custom' (not one of our first-class span types).
    assert "custom" in by_type, f"no custom (query) span. seen: {list(by_type)}"
    print(
        f"[ok] Spans by type: llm={len(by_type.get('llm', []))}, "
        f"retrieval={len(by_type.get('retrieval', []))}, "
        f"custom={len(by_type.get('custom', []))}"
    )

    # ── Parent linkage ─────────────────────────────────────────────────
    # The QUERY span should be top-level (no parent_span_id); the RETRIEVE
    # and LLM spans should reference it as their parent.
    query_span = by_type["custom"][0]
    assert query_span.get("name") == "llama_index.query", (
        f"top span name expected llama_index.query, got {query_span.get('name')!r}"
    )
    assert not query_span.get("parent_span_id"), (
        f"query span should be top-level, has parent={query_span.get('parent_span_id')!r}"
    )

    for child in by_type["llm"] + by_type["retrieval"]:
        assert child.get("parent_span_id") == query_span["id"], (
            f"child span {child.get('name')!r} parent_span_id="
            f"{child.get('parent_span_id')!r} expected {query_span['id']!r}"
        )
    print("[ok] Parent linkage: LLM + retrieval children reference QUERY as parent")

    # ── LLM usage extraction ───────────────────────────────────────────
    llm_patches = [
        p for p in span_patches if (p.get("metadata") or {}).get("model")
    ]
    assert llm_patches, "no LLM span PATCH carrying model metadata found"
    llm_patch = llm_patches[0]
    assert llm_patch.get("prompt_tokens") == 120, llm_patch
    assert llm_patch.get("completion_tokens") == 45, llm_patch
    assert llm_patch.get("total_tokens") == 165, llm_patch
    assert llm_patch["metadata"]["model"] == "gpt-4o-mini-2024-07-18", llm_patch
    print(
        f"[ok] LLM usage extracted: 120/45/165 tokens, model="
        f"{llm_patch['metadata']['model']}"
    )

    # ── Retrieved nodes summarisation ──────────────────────────────────
    retr_patches = [
        p for p in span_patches
        if isinstance(p.get("output"), dict) and "node_count" in p["output"]
    ]
    assert retr_patches, "no retrieval span PATCH with node summarisation found"
    assert retr_patches[0]["output"]["node_count"] == 2
    assert retr_patches[0]["output"]["top_scores"] == [0.91, 0.85]
    print("[ok] Retrieval span carries node_count=2, top_scores=[0.91, 0.85]")


def main() -> int:
    print("=" * 60)
    print("LlamaIndex integration smoke test")
    print("=" * 60)
    assert_subclass_relationship()
    print()
    print("Running synthetic query through real CallbackManager...")
    captured = run_synthetic_query()
    if "SPANLENS_LIVE_URL" in os.environ:
        print("\nLIVE mode: check Spanlens dashboard manually for trace 'li_smoke_query'.")
        return 0
    print()
    verify_wire_shape(captured)
    print()
    print("=" * 60)
    print("ALL CHECKS PASSED")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
