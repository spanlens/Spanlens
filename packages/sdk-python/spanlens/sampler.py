"""Trace sampling — opt-in cost / volume control for the agent-tracing layer.

Mirrors ``packages/sdk/src/sampler.ts``. See that module's docstring for the
rationale (per-trace decisions, tail-based error bypass, scope clarifications).

Implementation notes:
    The Python SDK already runs every ingest call through a daemon
    ``ThreadPoolExecutor`` and returns a ``Future``. A buffering transport
    just records ``(method, path, body)`` tuples and returns an
    already-resolved Future, so consumers see the same API surface (no
    awaits change shape).
"""

from __future__ import annotations

import random as _random_module
from concurrent.futures import Future
from threading import Lock
from typing import Any, Callable, Optional

from .transport import Transport

# Cap on buffered ops per sampled-out trace. Bounds worst-case memory if a
# long-running trace never ends. ~1000 ops = ~50 spans × 20-deep nesting.
MAX_BUFFER_SIZE = 1000


def validate_sample_rate(value: Any) -> float:
    """Validate and normalise a sample-rate value.

    Returns ``1.0`` when the value is ``None`` (the default — no sampling).
    Raises ``ValueError`` for any other invalid input. We'd rather fail at
    construction than silently drop 100% of traces because the user passed
    ``"0.1"`` (string) by accident.
    """
    if value is None:
        return 1.0
    # Reject bool explicitly — ``True`` and ``False`` are subclasses of int.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(
            f"[spanlens] sample_rate must be a number in [0, 1] — got {value!r}"
        )
    f = float(value)
    if f != f or f < 0.0 or f > 1.0:  # NaN-check via self-inequality
        raise ValueError(
            f"[spanlens] sample_rate must be a number in [0, 1] — got {value!r}"
        )
    return f


def should_sample(
    sample_rate: float,
    rng: Optional[Callable[[], float]] = None,
) -> bool:
    """Decide whether a single trace is sampled in.

    Pure function — tests inject a deterministic RNG via the ``rng`` argument
    (or by patching ``spanlens.sampler._random_module.random``).
    ``sample_rate=1`` short-circuits the RNG call entirely (cheap fast path
    for the default config).

    The default RNG is looked up at call time (not bound at function-definition
    time) so ``unittest.mock.patch`` against ``_random_module.random`` works
    for monkey-patching in tests.
    """
    if sample_rate >= 1.0:
        return True
    if sample_rate <= 0.0:
        return False
    if rng is None:
        rng = _random_module.random
    return rng() < sample_rate


def _completed_future() -> Future[Any]:
    """Returns a Future already resolved to None — same trick `span.py` uses
    when no parent creation needs to be awaited."""
    fut: Future[Any] = Future()
    fut.set_result(None)
    return fut


class BufferingTransport:
    """In-memory buffer that mimics the ``Transport`` protocol.

    Created per-trace when the trace loses the sampling coin-flip. POST/PATCH
    calls are recorded as tuples instead of being sent. On ``flush_buffered()``
    the recorded ops are replayed serially against the real transport,
    preserving FIFO order — which is the same INSERT-before-UPDATE invariant
    the real transport relies on via parent ``after`` futures.

    Thread-safety: backed by a ``Lock`` so concurrent ``trace.span()`` calls
    from user threads can't corrupt the buffer (the real transport's executor
    serialises actual HTTP requests, but the buffer push happens on the
    caller's thread).
    """

    def __init__(self, real: Transport) -> None:
        self._real = real
        self._buffer: list[tuple[str, str, Any]] = []
        self._overflowed = False
        self._lock = Lock()

    # ── Transport protocol ───────────────────────────────────────

    def post(
        self,
        path: str,
        body: Any,
        *,
        after: Optional[Future[Any]] = None,
    ) -> Future[Any]:
        """Queue a POST. ``after`` is ignored — buffered ops are replayed
        serially in FIFO order, which preserves the same ordering invariant."""
        self._push("POST", path, body)
        return _completed_future()

    def patch(
        self,
        path: str,
        body: Any,
        *,
        after: Optional[Future[Any]] = None,
    ) -> Future[Any]:
        """Queue a PATCH. See ``post`` for the ``after`` discussion."""
        self._push("PATCH", path, body)
        return _completed_future()

    def close(self) -> None:
        """Delegate close to the real transport — the buffer itself owns no
        OS resources."""
        self._real.close()

    # ── Internal ─────────────────────────────────────────────────

    def _push(self, method: str, path: str, body: Any) -> None:
        with self._lock:
            if len(self._buffer) < MAX_BUFFER_SIZE:
                self._buffer.append((method, path, body))
            else:
                self._overflowed = True

    # ── Public extension API ─────────────────────────────────────

    def flush_buffered(self) -> None:
        """Replay every buffered op against the real transport, serially.

        Called by ``TraceHandle.end()`` when a sampled-out trace resolves with
        ``status='error'`` — the tail-based bypass path. After this call the
        buffer is cleared; new pushes start a fresh buffer.

        Ordering: we explicitly chain each call's ``after`` to the previous
        op's future so the real transport's executor sees the same
        INSERT-before-UPDATE order the live path would have produced.
        """
        with self._lock:
            ops = self._buffer
            self._buffer = []
        previous: Future[Any] = _completed_future()
        for method, path, body in ops:
            if method == "POST":
                previous = self._real.post(path, body, after=previous)
            else:
                previous = self._real.patch(path, body, after=previous)
        # Block on the tail so callers can rely on "after flush_buffered()
        # returns, the buffer is on the wire."
        try:
            previous.result(timeout=30)
        except Exception:
            # Silent SDK contract — replay failures don't crash user code.
            pass

    @property
    def overflowed(self) -> bool:
        """Whether the buffer hit ``MAX_BUFFER_SIZE`` and dropped any ops.
        Exposed for future "trace truncated" warnings."""
        return self._overflowed


__all__ = [
    "BufferingTransport",
    "MAX_BUFFER_SIZE",
    "should_sample",
    "validate_sample_rate",
]
