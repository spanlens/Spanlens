"""Unit tests for the transport's daemon worker pool."""

from __future__ import annotations

import threading

import pytest

from spanlens._worker_pool import DaemonWorkerPool


def _pool(**overrides: int) -> DaemonWorkerPool:
    return DaemonWorkerPool(
        max_workers=overrides.get("max_workers", 2),
        max_pending=overrides.get("max_pending", 100),
        name_prefix="spanlens-test-pool",
    )


def test_submit_runs_callable_and_resolves_future() -> None:
    pool = _pool()
    try:
        future = pool.submit(lambda a, b: a + b, 2, 3)
        assert future is not None
        assert future.result(timeout=5) == 5
    finally:
        pool.shutdown(timeout=1)


def test_exceptions_land_on_the_future() -> None:
    pool = _pool()
    try:
        future = pool.submit(lambda: 1 / 0)
        assert future is not None
        with pytest.raises(ZeroDivisionError):
            future.result(timeout=5)
    finally:
        pool.shutdown(timeout=1)


def test_submit_refuses_work_beyond_max_pending() -> None:
    release = threading.Event()
    pool = _pool(max_workers=1, max_pending=2)
    try:
        assert pool.submit(release.wait, 5) is not None
        assert pool.submit(release.wait, 5) is not None
        assert pool.submit(release.wait, 5) is None
        assert pool.pending == 2
    finally:
        release.set()
        pool.shutdown(timeout=5)


def test_shutdown_cancels_what_is_still_queued_at_the_deadline() -> None:
    release = threading.Event()
    pool = _pool(max_workers=1)
    running = pool.submit(release.wait, 5)
    queued = [pool.submit(release.wait, 5) for _ in range(3)]

    assert pool.shutdown(timeout=0.1) is False
    release.set()

    assert running is not None and running.result(timeout=5) is True
    assert all(f is not None and f.cancelled() for f in queued)
    assert pool.submit(lambda: None) is None  # closed pools accept nothing


def test_a_burst_runs_on_up_to_max_workers_in_parallel() -> None:
    """Every worker must be able to run at once: four tasks that each wait
    for the other three only finish if the pool started four threads."""
    barrier = threading.Barrier(4)
    pool = _pool(max_workers=4)
    try:
        futures = [pool.submit(barrier.wait, 5) for _ in range(4)]
        assert all(f is not None for f in futures)
        for f in futures:
            assert f is not None
            f.result(timeout=10)  # BrokenBarrierError if under-spawned
    finally:
        pool.shutdown(timeout=1)


def test_finished_workers_are_reused_instead_of_spawning_more() -> None:
    pool = _pool(max_workers=4)
    try:
        for _ in range(20):
            future = pool.submit(lambda: None)
            assert future is not None
            future.result(timeout=5)
            assert pool.wait_idle(timeout=5)  # worker has marked itself idle
        assert len(pool._threads) == 1
    finally:
        pool.shutdown(timeout=1)


def test_wait_idle_returns_true_once_drained() -> None:
    pool = _pool()
    try:
        for _ in range(10):
            pool.submit(lambda: None)
        assert pool.wait_idle(timeout=5) is True
        assert pool.pending == 0
    finally:
        pool.shutdown(timeout=1)
