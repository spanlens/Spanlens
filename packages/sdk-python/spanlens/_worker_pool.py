"""Tiny daemon thread pool with a bounded backlog and deadline-aware shutdown.

``concurrent.futures.ThreadPoolExecutor`` is the obvious choice, but three of
its properties are wrong for an observability SDK:

* its work queue is unbounded, so an unreachable Spanlens server makes the
  backlog (and memory) grow without limit;
* its workers are non-daemon threads (Python 3.9+) and the interpreter joins
  them at exit, so a stuck backlog delays process shutdown;
* ``shutdown()`` has no timeout.

This pool keeps the same ``Future`` contract but caps the number of pending
items, uses daemon workers, and lets callers wait for the backlog with a
deadline. Anything still queued when the deadline passes is cancelled.
"""

from __future__ import annotations

import queue
import threading
import time
from concurrent.futures import Future
from typing import Any, Callable, Optional, Tuple

_WorkItem = Tuple["Future[Any]", Callable[..., Any], Tuple[Any, ...]]


class DaemonWorkerPool:
    """Fixed-size pool of lazily started daemon workers.

    ``pending`` counts queued plus running items. ``submit`` returns ``None``
    instead of queueing once ``pending`` reaches ``max_pending`` or after
    ``shutdown`` started, so callers decide how to account for the drop.
    """

    def __init__(self, *, max_workers: int, max_pending: int, name_prefix: str) -> None:
        if max_workers < 1:
            raise ValueError("max_workers must be at least 1")
        if max_pending < 1:
            raise ValueError("max_pending must be at least 1")
        self._max_workers = max_workers
        self._max_pending = max_pending
        self._name_prefix = name_prefix
        self._queue: queue.SimpleQueue[Optional[_WorkItem]] = queue.SimpleQueue()
        self._cond = threading.Condition()
        self._threads: list[threading.Thread] = []
        self._pending = 0
        self._idle = 0
        self._closed = False

    @property
    def pending(self) -> int:
        with self._cond:
            return self._pending

    def submit(self, fn: Callable[..., Any], *args: Any) -> Optional[Future[Any]]:
        future: Future[Any] = Future()
        with self._cond:
            if self._closed or self._pending >= self._max_pending:
                return None
            self._pending += 1
            if self._idle == 0 and len(self._threads) < self._max_workers:
                self._spawn_worker()
        self._queue.put((future, fn, args))
        return future

    def wait_idle(self, timeout: Optional[float]) -> bool:
        """Block until nothing is pending or ``timeout`` seconds passed.
        ``None`` waits without a deadline. Returns whether the pool drained."""
        deadline = None if timeout is None else time.monotonic() + max(timeout, 0.0)
        with self._cond:
            while self._pending > 0:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    return False
                self._cond.wait(remaining)
            return True

    def shutdown(self, timeout: Optional[float]) -> bool:
        """Stop accepting work, drain until ``timeout``, then cancel whatever
        is still queued. In-flight items finish on their daemon thread; they
        never hold up interpreter exit. Idempotent. Returns whether the
        backlog fully drained before the deadline."""
        with self._cond:
            self._closed = True
        drained = self.wait_idle(timeout)
        self._cancel_queued()
        with self._cond:
            workers = len(self._threads)
        for _ in range(workers):
            self._queue.put(None)
        return drained

    # ── Internal ─────────────────────────────────────────────────

    def _spawn_worker(self) -> None:
        # Called with ``self._cond`` held.
        thread = threading.Thread(
            target=self._run,
            name=f"{self._name_prefix}_{len(self._threads)}",
            daemon=True,
        )
        self._threads.append(thread)
        thread.start()

    def _cancel_queued(self) -> None:
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                return
            if item is None:
                continue
            future, _fn, _args = item
            future.cancel()
            self._mark_done()

    def _mark_done(self) -> None:
        with self._cond:
            self._pending -= 1
            if self._pending <= 0:
                self._pending = 0
                self._cond.notify_all()

    def _run(self) -> None:
        while True:
            with self._cond:
                self._idle += 1
            item = self._queue.get()
            with self._cond:
                self._idle -= 1
            if item is None:
                return
            future, fn, args = item
            if future.set_running_or_notify_cancel():
                try:
                    result = fn(*args)
                except BaseException as exc:  # noqa: BLE001 - mirror ThreadPoolExecutor
                    future.set_exception(exc)
                else:
                    future.set_result(result)
            self._mark_done()


__all__ = ["DaemonWorkerPool"]
