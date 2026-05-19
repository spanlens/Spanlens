"""P3.8 sampling tests — mirrors ``packages/sdk/src/__tests__/sampling.test.ts``.

Three layers:

1. Pure helpers (``validate_sample_rate``, ``should_sample``) — boundaries +
   invalid-input semantics.
2. ``BufferingTransport`` — drop-by-default + ``flush_buffered`` preserves
   FIFO order + cap bounds memory.
3. End-to-end via ``SpanlensClient`` — uses ``respx`` to assert which ingest
   requests reach the wire for sampled-in / sampled-out / sampled-out+error
   traces. This is the contract users care about.
"""

from __future__ import annotations

import json
import re
from typing import Any
from unittest.mock import patch as mock_patch

import httpx
import pytest
import respx

from spanlens import SpanlensClient
from spanlens.sampler import (
    MAX_BUFFER_SIZE,
    BufferingTransport,
    should_sample,
    validate_sample_rate,
)

BASE_URL = "https://test.spanlens.local"


# ── 1. Pure helpers ──────────────────────────────────────────────────────────


class TestValidateSampleRate:
    def test_none_returns_default_1(self) -> None:
        assert validate_sample_rate(None) == 1.0

    @pytest.mark.parametrize("value", [0, 0.0, 0.1, 0.5, 1, 1.0])
    def test_valid_range(self, value: float) -> None:
        assert validate_sample_rate(value) == float(value)

    @pytest.mark.parametrize("value", [-0.1, 1.5, -1, 2])
    def test_out_of_range_raises(self, value: float) -> None:
        with pytest.raises(ValueError, match=r"sample_rate must be a number"):
            validate_sample_rate(value)

    @pytest.mark.parametrize("value", ["0.5", {"r": 0.5}, [0.5], object()])
    def test_non_number_types_raise(self, value: Any) -> None:
        with pytest.raises(ValueError, match=r"sample_rate must be a number"):
            validate_sample_rate(value)

    def test_bool_rejected_even_though_subclass_of_int(self) -> None:
        # ``True`` and ``False`` are technically int subclasses in Python.
        # We reject them so ``sample_rate=False`` doesn't silently mean 0.0.
        with pytest.raises(ValueError):
            validate_sample_rate(True)
        with pytest.raises(ValueError):
            validate_sample_rate(False)

    def test_nan_rejected(self) -> None:
        with pytest.raises(ValueError):
            validate_sample_rate(float("nan"))


class TestShouldSample:
    def test_rate_1_short_circuits_rng(self) -> None:
        calls: list[int] = []

        def rng() -> float:
            calls.append(1)
            return 0.99

        assert should_sample(1.0, rng) is True
        assert calls == []

    def test_rate_0_short_circuits_rng(self) -> None:
        calls: list[int] = []

        def rng() -> float:
            calls.append(1)
            return 0.0

        assert should_sample(0.0, rng) is False
        assert calls == []

    def test_strict_less_than_comparison(self) -> None:
        assert should_sample(0.5, lambda: 0.4) is True
        assert should_sample(0.5, lambda: 0.6) is False
        # Boundary: rng() == sample_rate should DROP (uses strict <).
        assert should_sample(0.5, lambda: 0.5) is False

    def test_approximate_rate_over_large_sample(self) -> None:
        seed = [0]

        def rng() -> float:
            # Deterministic LCG.
            seed[0] = (seed[0] * 1103515245 + 12345) % 2147483648
            return seed[0] / 2147483648

        n = 10_000
        sampled = sum(1 for _ in range(n) if should_sample(0.1, rng))
        # 10% ± 2% absolute (loose bound).
        assert 0.08 < sampled / n < 0.12


# ── 2. BufferingTransport ────────────────────────────────────────────────────


class _FakeTransport:
    """Minimal stand-in for the real ``Transport``. Records every call."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Any]] = []

    def post(self, path: str, body: Any, *, after: Any = None) -> Any:  # noqa: ARG002
        self.calls.append(("POST", path, body))
        from concurrent.futures import Future
        f: Future[Any] = Future()
        f.set_result(None)
        return f

    def patch(self, path: str, body: Any, *, after: Any = None) -> Any:  # noqa: ARG002
        self.calls.append(("PATCH", path, body))
        from concurrent.futures import Future
        f: Future[Any] = Future()
        f.set_result(None)
        return f

    def close(self) -> None:
        pass


class TestBufferingTransport:
    def test_post_patch_do_not_reach_real_transport(self) -> None:
        real = _FakeTransport()
        buf = BufferingTransport(real)  # type: ignore[arg-type]

        buf.post("/p1", {"a": 1})
        buf.patch("/p2", {"b": 2})

        assert real.calls == []

    def test_flush_buffered_replays_in_fifo_order(self) -> None:
        real = _FakeTransport()
        buf = BufferingTransport(real)  # type: ignore[arg-type]

        buf.post("/ingest/traces", {"id": "t"})
        buf.post("/ingest/traces/t/spans", {"id": "s1"})
        buf.patch("/ingest/spans/s1", {"ended_at": "x"})

        buf.flush_buffered()

        assert real.calls == [
            ("POST", "/ingest/traces", {"id": "t"}),
            ("POST", "/ingest/traces/t/spans", {"id": "s1"}),
            ("PATCH", "/ingest/spans/s1", {"ended_at": "x"}),
        ]

    def test_buffer_cap_bounds_memory(self) -> None:
        real = _FakeTransport()
        buf = BufferingTransport(real)  # type: ignore[arg-type]

        # Push 2× the cap; only the first MAX_BUFFER_SIZE should buffer.
        for i in range(MAX_BUFFER_SIZE * 2):
            buf.post(f"/p{i}", {"i": i})

        buf.flush_buffered()
        assert len(real.calls) == MAX_BUFFER_SIZE
        assert real.calls[0][1] == "/p0"
        assert real.calls[-1][1] == f"/p{MAX_BUFFER_SIZE - 1}"
        assert buf.overflowed is True

    def test_close_delegates_to_real(self) -> None:
        closed = [False]

        class _T(_FakeTransport):
            def close(self) -> None:
                closed[0] = True

        buf = BufferingTransport(_T())  # type: ignore[arg-type]
        buf.close()
        assert closed[0] is True


# ── 3. End-to-end via SpanlensClient + respx ─────────────────────────────────


def _setup_routes() -> dict[str, respx.Route]:
    return {
        "trace_post": respx.post(f"{BASE_URL}/ingest/traces").mock(
            return_value=httpx.Response(200, json={"ok": True})
        ),
        "span_post": respx.post(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")
        ).mock(return_value=httpx.Response(200, json={"ok": True})),
        "span_patch": respx.patch(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")
        ).mock(return_value=httpx.Response(200, json={})),
        "trace_patch": respx.patch(
            re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")
        ).mock(return_value=httpx.Response(200, json={})),
    }


def _make_client(**kwargs: Any) -> SpanlensClient:
    return SpanlensClient(
        api_key="sl_test_dummy",
        base_url=BASE_URL,
        timeout_ms=2000,
        silent=False,
        **kwargs,
    )


class TestClientSampling:
    def test_invalid_sample_rate_raises_at_construction(self) -> None:
        with pytest.raises(ValueError, match=r"sample_rate must be a number"):
            _make_client(sample_rate=-0.1)
        with pytest.raises(ValueError):
            _make_client(sample_rate=1.5)

    @respx.mock
    def test_default_rate_1_keeps_all_traces(self) -> None:
        routes = _setup_routes()

        with _make_client() as client:
            with client.start_trace("t") as trace:
                with trace.span("s", span_type="llm") as span:
                    span.end(total_tokens=10)

        assert routes["trace_post"].call_count == 1
        assert routes["span_post"].call_count == 1
        assert routes["span_patch"].call_count == 1
        assert routes["trace_patch"].call_count == 1

    @respx.mock
    def test_rate_0_completed_drops_everything(self) -> None:
        routes = _setup_routes()

        with mock_patch("spanlens.sampler._random_module.random", return_value=0.5):
            with _make_client(sample_rate=0.0) as client:
                with client.start_trace("t") as trace:
                    with trace.span("s") as span:
                        span.end(total_tokens=10)
                    # __exit__ → trace.end() with status='completed'

        # NO calls hit the wire.
        for name, route in routes.items():
            assert route.call_count == 0, f"{name} unexpectedly called"

    @respx.mock
    def test_rate_0_error_replays_buffer(self) -> None:
        routes = _setup_routes()

        with mock_patch("spanlens.sampler._random_module.random", return_value=0.5):
            client = _make_client(sample_rate=0.0)
            try:
                trace = client.start_trace("t")
                span = trace.span("llm", span_type="llm")
                span.end(total_tokens=42)
                trace.end(status="error", error_message="boom")
            finally:
                client.close()

        # All four calls should land — buffered ops were replayed, then the
        # trace end PATCH was sent directly via the real transport.
        assert routes["trace_post"].call_count == 1, "trace creation POST missing"
        assert routes["span_post"].call_count == 1, "span creation POST missing"
        assert routes["span_patch"].call_count == 1, "span end PATCH missing"
        assert routes["trace_patch"].call_count == 1, "trace end PATCH missing"

        # The trace end PATCH body should carry status=error.
        end_body = json.loads(routes["trace_patch"].calls[0].request.content)
        assert end_body["status"] == "error"
        assert end_body["error_message"] == "boom"

    @respx.mock
    def test_rate_1_error_path_unchanged(self) -> None:
        routes = _setup_routes()

        with _make_client(sample_rate=1.0) as client:
            trace = client.start_trace("t")
            span = trace.span("s")
            span.end()
            trace.end(status="error", error_message="x")

        # Standard 4-call sequence, no replay needed because nothing buffered.
        assert routes["trace_post"].call_count == 1
        assert routes["span_post"].call_count == 1
        assert routes["span_patch"].call_count == 1
        assert routes["trace_patch"].call_count == 1

    @respx.mock
    def test_decision_is_sticky_across_spans(self) -> None:
        routes = _setup_routes()

        # Pin RNG to 0.5 → with sample_rate=0.1, sampled-out.
        with mock_patch("spanlens.sampler._random_module.random", return_value=0.5):
            with _make_client(sample_rate=0.1) as client:
                with client.start_trace("t") as trace:
                    for i in range(20):
                        with trace.span(f"s{i}") as s:
                            s.end()

        for route in routes.values():
            assert route.call_count == 0

    @respx.mock
    def test_independent_decisions_per_trace(self) -> None:
        routes = _setup_routes()
        # Sequence: trace A sampled IN (rng=0.1 < 0.5),
        #           trace B sampled OUT (rng=0.9, not < 0.5).
        seq = iter([0.1, 0.9])
        with mock_patch(
            "spanlens.sampler._random_module.random", side_effect=lambda: next(seq)
        ):
            with _make_client(sample_rate=0.5) as client:
                trace_a = client.start_trace("a")
                trace_b = client.start_trace("b")
                trace_a.end(status="completed")
                trace_b.end(status="completed")

        # Only trace A should reach the wire (POST + PATCH = 2 calls).
        assert routes["trace_post"].call_count == 1
        assert routes["trace_patch"].call_count == 1
        # Verify it was specifically trace A.
        end_path = routes["trace_patch"].calls[0].request.url.path
        assert end_path.endswith(trace_a.trace_id)
