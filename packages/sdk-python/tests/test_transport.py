"""Transport reliability tests: bounded retry, bounded queue, deadlines.

Mirrors the TypeScript SDK's ``transport.ts`` contract: at most three
attempts per ingest call, 200ms / 400ms backoff with jitter, no retry on
4xx (429 is classified separately so callers can tell a quota block from a
bad request), and exactly one ``on_error`` notification per failed call.

``respx`` intercepts httpx, so no network traffic happens. Backoff sleeps
are patched out so the suite stays fast.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import Future
from typing import Any, Callable

import httpx
import pytest
import respx

from spanlens import SpanlensTransportError
from spanlens.transport import MAX_ATTEMPTS, Transport

BASE_URL = "https://test.spanlens.local"
PATH = "/ingest/traces"


@pytest.fixture(autouse=True)
def _no_backoff_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Record backoff delays instead of sleeping through them."""
    delays: list[float] = []
    monkeypatch.setattr("spanlens.transport._sleep", delays.append)
    return delays


def _transport(
    *,
    silent: bool = True,
    on_error: Callable[[BaseException, str], None] | None = None,
    max_pending: int | None = None,
) -> Transport:
    config: dict[str, Any] = {
        "api_key": "sl_test_dummy",
        "base_url": BASE_URL,
        "timeout_ms": 2000,
        "silent": silent,
    }
    if on_error is not None:
        config["on_error"] = on_error
    if max_pending is not None:
        config["max_pending"] = max_pending
    return Transport(config)  # type: ignore[arg-type]


def _collect_errors() -> tuple[list[tuple[BaseException, str]], Callable[[BaseException, str], None]]:
    seen: list[tuple[BaseException, str]] = []

    def hook(err: BaseException, context: str) -> None:
        seen.append((err, context))

    return seen, hook


# ── Retry ────────────────────────────────────────────────────────────────


@respx.mock
def test_5xx_is_retried_until_success() -> None:
    route = respx.post(f"{BASE_URL}{PATH}").mock(
        side_effect=[
            httpx.Response(503),
            httpx.Response(502),
            httpx.Response(200, json={"ok": True}),
        ]
    )
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook)
    try:
        assert transport.post(PATH, {"id": "t"}).result(timeout=5) == {"ok": True}
    finally:
        transport.close()

    assert route.call_count == 3
    assert errors == []


@respx.mock
def test_5xx_gives_up_after_max_attempts_and_reports_once() -> None:
    route = respx.post(f"{BASE_URL}{PATH}").mock(return_value=httpx.Response(503))
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook)
    try:
        assert transport.post(PATH, {"id": "t"}).result(timeout=5) is None
    finally:
        transport.close()

    assert MAX_ATTEMPTS == 3
    assert route.call_count == MAX_ATTEMPTS
    assert len(errors) == 1
    err, context = errors[0]
    assert isinstance(err, SpanlensTransportError)
    assert err.status == 503
    assert context == f"POST {PATH}"


@respx.mock
def test_backoff_is_200_then_400ms_with_jitter(_no_backoff_sleep: list[float]) -> None:
    respx.post(f"{BASE_URL}{PATH}").mock(return_value=httpx.Response(500))
    transport = _transport()
    try:
        transport.post(PATH, {}).result(timeout=5)
    finally:
        transport.close()

    assert len(_no_backoff_sleep) == MAX_ATTEMPTS - 1
    first, second = _no_backoff_sleep
    assert 0.2 <= first <= 0.3
    assert 0.4 <= second <= 0.6


@respx.mock
@pytest.mark.parametrize(
    "failure",
    [httpx.ConnectError("refused"), httpx.ReadTimeout("slow")],
    ids=["network", "timeout"],
)
def test_network_errors_and_timeouts_are_retried(failure: Exception) -> None:
    route = respx.post(f"{BASE_URL}{PATH}").mock(
        side_effect=[failure, failure, httpx.Response(200, json={"ok": 1})]
    )
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook)
    try:
        assert transport.post(PATH, {}).result(timeout=5) == {"ok": 1}
    finally:
        transport.close()

    assert route.call_count == 3
    assert errors == []


@respx.mock
def test_exhausted_network_retries_report_the_last_error_once() -> None:
    route = respx.post(f"{BASE_URL}{PATH}").mock(side_effect=httpx.ConnectError("down"))
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook)
    try:
        assert transport.post(PATH, {}).result(timeout=5) is None
    finally:
        transport.close()

    assert route.call_count == MAX_ATTEMPTS
    assert len(errors) == 1
    assert isinstance(errors[0][0], httpx.ConnectError)


@respx.mock
def test_4xx_is_not_retried() -> None:
    route = respx.post(f"{BASE_URL}{PATH}").mock(return_value=httpx.Response(400, text="bad"))
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook)
    try:
        transport.post(PATH, {}).result(timeout=5)
    finally:
        transport.close()

    assert route.call_count == 1
    assert len(errors) == 1
    err = errors[0][0]
    assert isinstance(err, SpanlensTransportError)
    assert err.status == 400
    assert err.code == "HTTP_400"


@respx.mock
def test_429_is_not_retried_and_is_classified_as_rate_limited() -> None:
    route = respx.post(f"{BASE_URL}{PATH}").mock(return_value=httpx.Response(429))
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook)
    try:
        transport.post(PATH, {}).result(timeout=5)
    finally:
        transport.close()

    assert route.call_count == 1
    assert len(errors) == 1
    err = errors[0][0]
    assert isinstance(err, SpanlensTransportError)
    assert err.status == 429
    assert err.code == "RATE_LIMITED"
    assert "quota" in str(err).lower()


@respx.mock
def test_server_error_envelope_code_is_surfaced() -> None:
    respx.post(f"{BASE_URL}{PATH}").mock(
        return_value=httpx.Response(
            403,
            json={"error": {"code": "PUBLIC_KEY_WRITE_FORBIDDEN", "message": "read only"}},
        )
    )
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook)
    try:
        transport.post(PATH, {}).result(timeout=5)
    finally:
        transport.close()

    err = errors[0][0]
    assert isinstance(err, SpanlensTransportError)
    assert err.code == "PUBLIC_KEY_WRITE_FORBIDDEN"
    assert err.status == 403


@respx.mock
def test_silent_false_notifies_once_and_stores_error_on_future() -> None:
    respx.post(f"{BASE_URL}{PATH}").mock(return_value=httpx.Response(400))
    errors, hook = _collect_errors()
    transport = _transport(silent=False, on_error=hook)
    try:
        future = transport.post(PATH, {})
        exc = future.exception(timeout=5)
    finally:
        transport.close()

    assert isinstance(exc, SpanlensTransportError)
    assert len(errors) == 1  # previously reported twice


# ── Bounded queue ────────────────────────────────────────────────────────


@respx.mock
def test_pending_queue_is_bounded_and_drops_are_counted() -> None:
    release = threading.Event()

    def slow(_request: httpx.Request) -> httpx.Response:
        release.wait(5)
        return httpx.Response(200, json={})

    route = respx.post(f"{BASE_URL}{PATH}").mock(side_effect=slow)
    errors, hook = _collect_errors()
    transport = _transport(on_error=hook, max_pending=5)
    try:
        futures = [transport.post(PATH, {"i": i}) for i in range(20)]
        assert transport.dropped_count == 15
        # Dropped calls resolve immediately so callers never block on them.
        assert all(f.done() for f in futures[5:])
        release.set()
        assert transport.flush(timeout=5) is True
    finally:
        release.set()
        transport.close()

    assert route.call_count == 5
    # One notification per saturation episode, not one per dropped call.
    queue_errors = [e for e, _ in errors if getattr(e, "code", "") == "QUEUE_FULL"]
    assert len(queue_errors) == 1


def test_workers_are_daemon_threads() -> None:
    transport = _transport()
    try:
        with respx.mock:
            respx.post(f"{BASE_URL}{PATH}").mock(return_value=httpx.Response(200))
            transport.post(PATH, {}).result(timeout=5)
            workers = [t for t in threading.enumerate() if t.name.startswith("spanlens-ingest")]
            assert workers
            assert all(t.daemon for t in workers)
    finally:
        transport.close()


# ── Deadlines ────────────────────────────────────────────────────────────


@respx.mock
def test_flush_returns_false_when_deadline_passes() -> None:
    release = threading.Event()

    def slow(_request: httpx.Request) -> httpx.Response:
        release.wait(5)
        return httpx.Response(200)

    respx.post(f"{BASE_URL}{PATH}").mock(side_effect=slow)
    transport = _transport()
    try:
        transport.post(PATH, {})
        started = time.monotonic()
        assert transport.flush(timeout=0.2) is False
        assert time.monotonic() - started < 1.5
    finally:
        release.set()
        transport.close()


@respx.mock
def test_close_does_not_wait_for_the_whole_backlog() -> None:
    release = threading.Event()

    def slow(_request: httpx.Request) -> httpx.Response:
        release.wait(5)
        return httpx.Response(200)

    route = respx.post(f"{BASE_URL}{PATH}").mock(side_effect=slow)
    transport = _transport()
    for i in range(50):
        transport.post(PATH, {"i": i})
    started = time.monotonic()
    transport.close(timeout=0.2)
    elapsed = time.monotonic() - started
    release.set()

    assert elapsed < 1.5
    # The queued backlog was cancelled instead of drained serially.
    assert route.call_count < 50


def test_post_after_close_is_dropped_without_raising() -> None:
    transport = _transport()
    transport.close()
    future: Future[Any] = transport.post(PATH, {})
    assert future.done()
    assert future.result() is None
