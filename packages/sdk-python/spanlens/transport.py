"""HTTP transport for the Spanlens SDK.

Mirrors the TypeScript SDK's ``transport.ts`` behaviour:

* Never throws — observability SDKs must not crash user code if the backend
  is unreachable or slow.
* Fire-and-forget: returns a ``Future`` so callers can chain (and so the
  user's hot path doesn't block on a network round-trip).
* Optional ``on_error`` hook lets advanced users surface failures.

Implementation notes:
    The TypeScript SDK relies on JavaScript's micro-task queue + ``await`` to
    serialise creation POSTs before subsequent PATCHes. Python has no native
    equivalent, so we use a small daemon ``ThreadPoolExecutor`` and pass
    creation futures explicitly to children — child tasks block on the parent
    future before issuing their own request. This guarantees the same
    INSERT-before-UPDATE ordering that the server-side ownership check
    requires.
"""

from __future__ import annotations

import atexit
import json
import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, Optional

import httpx

from .types import SpanlensConfig

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://spanlens-server.vercel.app"
DEFAULT_TIMEOUT_MS = 3000
# Small pool — one trace might fan out to a handful of concurrent spans, but
# we never need many workers: each task is a short-lived HTTP call.
_POOL_SIZE = 8


class Transport:
    """Thread-safe HTTP transport. Created once per ``SpanlensClient``."""

    def __init__(self, config: SpanlensConfig) -> None:
        api_key = config.get("api_key", "")
        if not api_key or not api_key.strip():
            raise ValueError("[spanlens] api_key is required")

        self._api_key = api_key
        self._base_url = (config.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
        self._timeout_s = (config.get("timeout_ms") or DEFAULT_TIMEOUT_MS) / 1000
        self._silent = config.get("silent", True)
        self._on_error: Optional[Callable[[BaseException, str], None]] = config.get("on_error")

        # httpx.Client is thread-safe and reuses the underlying connection pool.
        self._http = httpx.Client(timeout=self._timeout_s)

        # daemon=True: don't block process exit if a request is in flight.
        self._executor = ThreadPoolExecutor(
            max_workers=_POOL_SIZE,
            thread_name_prefix="spanlens-ingest",
        )

        # Best-effort cleanup on interpreter shutdown — drains in-flight
        # requests so users don't lose the trace.end() they just fired.
        atexit.register(self._shutdown)

    # ── Public API ───────────────────────────────────────────────

    def post(
        self,
        path: str,
        body: Any,
        *,
        after: Optional[Future[Any]] = None,
    ) -> Future[Any]:
        """Issue a POST in the background. Returns a Future that resolves to
        the parsed JSON response (or ``None`` on failure when silent)."""
        return self._submit("POST", path, body, after=after)

    def patch(
        self,
        path: str,
        body: Any,
        *,
        after: Optional[Future[Any]] = None,
    ) -> Future[Any]:
        """Issue a PATCH in the background — typically the ``end()`` call for
        a trace or span. ``after`` is the creation Future this PATCH must wait
        on (otherwise the server's row may not exist yet)."""
        return self._submit("PATCH", path, body, after=after)

    def close(self) -> None:
        """Drain in-flight requests and close the HTTP client. Safe to call
        more than once."""
        self._shutdown()

    # ── Internal ─────────────────────────────────────────────────

    def _submit(
        self,
        method: str,
        path: str,
        body: Any,
        *,
        after: Optional[Future[Any]],
    ) -> Future[Any]:
        return self._executor.submit(self._call, method, path, body, after)

    def _call(
        self,
        method: str,
        path: str,
        body: Any,
        after: Optional[Future[Any]],
    ) -> Any:
        # Honour ordering: a span's POST must observe its parent trace's
        # POST. If the parent task failed, swallow it — the child will
        # almost certainly 404 too, but that's the silent SDK contract.
        if after is not None:
            try:
                # Bound the wait to (timeout + 2s) so a stuck parent doesn't
                # park a worker forever.
                after.result(timeout=self._timeout_s + 2)
            except Exception:
                pass

        url = f"{self._base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }

        try:
            res = self._http.request(
                method,
                url,
                content=json.dumps(body, default=_json_default),
                headers=headers,
            )

            if res.status_code >= 400:
                snippet = res.text[:200] if res.text else ""
                err = RuntimeError(
                    f"[spanlens] {method} {path} failed: {res.status_code} {snippet}"
                )
                self._report(err, f"{method} {path}")
                return None

            text = res.text
            if not text:
                return None
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return None

        except Exception as err:
            self._report(err, f"{method} {path}")
            return None

    def _report(self, err: BaseException, context: str) -> None:
        if self._on_error is not None:
            try:
                self._on_error(err, context)
            except Exception:
                logger.debug("spanlens on_error hook raised", exc_info=True)
        if not self._silent:
            raise err

    def _shutdown(self) -> None:
        # Idempotent: ThreadPoolExecutor.shutdown is safe to call repeatedly.
        try:
            self._executor.shutdown(wait=True, cancel_futures=False)
        except Exception:
            pass
        try:
            self._http.close()
        except Exception:
            pass


def _json_default(obj: Any) -> Any:
    """Last-resort JSON encoder for opaque user metadata (datetimes, sets, …).

    Falls back to ``str(obj)`` so a non-serialisable field never breaks
    the entire request.
    """
    # datetime / date — call isoformat() if available
    iso = getattr(obj, "isoformat", None)
    if callable(iso):
        try:
            return iso()
        except Exception:
            pass
    if isinstance(obj, (set, frozenset)):
        return list(obj)
    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8", errors="replace")
        except Exception:
            return repr(obj)
    return str(obj)


__all__ = ["DEFAULT_BASE_URL", "Transport"]
