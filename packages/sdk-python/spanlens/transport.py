"""HTTP transport for the Spanlens SDK.

Mirrors the TypeScript SDK's ``transport.ts`` behaviour:

* Never throws into user code. Observability SDKs must not crash the host
  if the backend is unreachable or slow.
* Fire-and-forget: returns a ``Future`` so callers can chain (and so the
  user's hot path doesn't block on a network round-trip).
* Bounded retry: at most ``MAX_ATTEMPTS`` tries per call with 200ms / 400ms
  backoff plus jitter. Network errors, timeouts, and 5xx are retried; 4xx is
  not. 429 is classified as ``RATE_LIMITED`` (a quota or rate-limit block,
  where retrying only makes things worse).
* Optional ``on_error`` hook lets advanced users surface failures. It fires
  exactly once per failed call, after the last attempt.
* A body that plain ``json.dumps`` can't encode (non-string dict keys, NaN,
  a circular reference) is rewritten value by value rather than dropped, so
  one odd span output never costs the status and timing sent with it.

Implementation notes:
    The TypeScript SDK relies on JavaScript's micro-task queue + ``await`` to
    serialise creation POSTs before subsequent PATCHes. Python has no native
    equivalent, so calls run on a small pool of **daemon** worker threads and
    creation futures are passed explicitly to children: a child task waits
    on the parent future before issuing its own request. This guarantees the
    same INSERT-before-UPDATE ordering that the server-side ownership check
    requires.

    The pool's backlog is bounded (``max_pending``). When Spanlens is down
    the SDK drops new ingest calls and counts them in ``dropped_count``
    instead of growing memory without limit. ``flush()`` and ``close()``
    take a deadline, and the ``atexit`` hook uses one too, so a stuck
    backlog can never hold up process exit for longer than that.
"""

from __future__ import annotations

import atexit
import json
import logging
import math
import random
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass
from typing import Any, Callable, Optional, Protocol

import httpx

from ._base_url import server_origin_from_env
from ._worker_pool import DaemonWorkerPool
from .types import SpanlensConfig

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.spanlens.io"
DEFAULT_TIMEOUT_MS = 3000
# Hard cap on queued + in-flight ingest calls per client. Large enough that a
# busy batch job never hits it while Spanlens is healthy (8 workers drain
# hundreds of calls per second), small enough to bound memory during an
# outage.
DEFAULT_MAX_PENDING = 10_000
# How long ``flush()`` / ``close()`` / the atexit hook wait for the backlog.
DEFAULT_SHUTDOWN_TIMEOUT_S = 5.0
MAX_ATTEMPTS = 3
_RETRY_BASE_DELAY_S = 0.2
# Small pool. One trace might fan out to a handful of concurrent spans, but
# we never need many workers: each task is a short-lived HTTP call.
_POOL_SIZE = 8

_DOCS_QUICK_START_URL = "https://www.spanlens.io/docs/quick-start"
_PRICING_URL = "https://www.spanlens.io/pricing"


class IngestTransport(Protocol):
    """What traces and spans need from a transport. Implemented by
    ``Transport`` and by the sampler's ``BufferingTransport``."""

    def post(
        self, path: str, body: Any, *, after: Optional[Future[Any]] = None
    ) -> Future[Any]: ...

    def patch(
        self, path: str, body: Any, *, after: Optional[Future[Any]] = None
    ) -> Future[Any]: ...


class SpanlensTransportError(RuntimeError):
    """An ingest call the transport could classify but not deliver.

    Passed to ``on_error`` (and stored on the call's ``Future`` when
    ``silent=False``). Network failures and timeouts are passed through as
    the original ``httpx`` exception instead.

    Attributes:
        code: The server's error code when the response used the standard
            error envelope, ``RATE_LIMITED`` for HTTP 429, ``QUEUE_FULL``
            when the call was dropped locally, else ``HTTP_<status>``.
        status: HTTP status, or ``0`` for failures that never reached the
            server.
        endpoint: ``"<METHOD> <path>"`` of the failed call.
    """

    def __init__(self, message: str, *, code: str, status: int, endpoint: str) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.endpoint = endpoint


@dataclass(frozen=True)
class _Outcome:
    value: Any = None
    error: Optional[BaseException] = None


def _sleep(seconds: float) -> None:
    """Indirection so tests can skip real backoff sleeps."""
    time.sleep(seconds)


def _retry_delay_s(attempt: int) -> float:
    """Backoff before retry number ``attempt``: 200ms, 400ms, ... plus up to
    50% jitter so a fleet of clients doesn't retry in lockstep."""
    base = _RETRY_BASE_DELAY_S * (1 << (attempt - 1))
    return base + random.uniform(0.0, base / 2)


def _is_retryable_status(status: int) -> bool:
    return status >= 500


class Transport:
    """Thread-safe HTTP transport. Created once per ``SpanlensClient``."""

    def __init__(self, config: SpanlensConfig) -> None:
        api_key = config.get("api_key", "")
        if not api_key or not api_key.strip():
            raise ValueError("[spanlens] api_key is required")

        # Explicit base_url, then a self-hosted origin in SPANLENS_BASE_URL,
        # then the hosted API.
        base_url = config.get("base_url") or server_origin_from_env() or DEFAULT_BASE_URL
        self._base_url = base_url.rstrip("/")
        self._timeout_s = (config.get("timeout_ms") or DEFAULT_TIMEOUT_MS) / 1000
        self._silent = config.get("silent", True)
        self._on_error: Optional[Callable[[BaseException, str], None]] = config.get("on_error")
        self._headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        # A child waits this long for its parent's call (which may itself be
        # retrying) before giving up on ordering and sending anyway.
        self._predecessor_wait_s = MAX_ATTEMPTS * (self._timeout_s + 1.0) + 2.0

        # httpx.Client is thread-safe and reuses the underlying connection pool.
        self._http = httpx.Client(timeout=self._timeout_s)
        self._pool = DaemonWorkerPool(
            max_workers=_POOL_SIZE,
            max_pending=config.get("max_pending") or DEFAULT_MAX_PENDING,
            name_prefix="spanlens-ingest",
        )

        self._state_lock = threading.Lock()
        self._dropped = 0
        self._saturated = False
        self._closed = False
        self._warned: set[str] = set()

        # Best-effort delivery on interpreter shutdown, bounded by a deadline
        # so an unreachable server can't stall process exit.
        atexit.register(self._shutdown, DEFAULT_SHUTDOWN_TIMEOUT_S)

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
        """Issue a PATCH in the background, typically the ``end()`` call for
        a trace or span. ``after`` is the creation Future this PATCH must wait
        on (otherwise the server's row may not exist yet)."""
        return self._submit("PATCH", path, body, after=after)

    def flush(self, timeout: Optional[float] = DEFAULT_SHUTDOWN_TIMEOUT_S) -> bool:
        """Wait until every queued and in-flight call finished, or until
        ``timeout`` seconds passed (``None`` waits without a deadline).
        Returns ``True`` when the backlog fully drained."""
        return self._pool.wait_idle(timeout)

    def close(self, timeout: Optional[float] = DEFAULT_SHUTDOWN_TIMEOUT_S) -> None:
        """Drain the backlog for up to ``timeout`` seconds, cancel whatever
        is still queued, and close the HTTP client. Safe to call more than
        once; calls made after ``close()`` are dropped."""
        self._shutdown(timeout)

    @property
    def dropped_count(self) -> int:
        """Ingest calls dropped because the backlog was full or the
        transport was already closed."""
        with self._state_lock:
            return self._dropped

    # ── Internal ─────────────────────────────────────────────────

    def _submit(
        self,
        method: str,
        path: str,
        body: Any,
        *,
        after: Optional[Future[Any]],
    ) -> Future[Any]:
        future = self._pool.submit(self._call, method, path, body, after)
        if future is not None:
            with self._state_lock:
                self._saturated = False
            return future
        return self._drop(f"{method} {path}")

    def _drop(self, endpoint: str) -> Future[Any]:
        with self._state_lock:
            self._dropped += 1
            first_in_episode = not self._saturated and not self._closed
            self._saturated = True
        if first_in_episode:
            err = SpanlensTransportError(
                f"[spanlens] {endpoint} dropped: ingest backlog is full "
                "(Spanlens unreachable or too slow). Further drops are counted "
                "in dropped_count until the backlog recovers.",
                code="QUEUE_FULL",
                status=0,
                endpoint=endpoint,
            )
            logger.warning("%s", err)
            self._notify(err, endpoint)
        done: Future[Any] = Future()
        done.set_result(None)
        return done

    def _call(
        self,
        method: str,
        path: str,
        body: Any,
        after: Optional[Future[Any]],
    ) -> Any:
        self._await_predecessor(after)
        endpoint = f"{method} {path}"
        try:
            payload = _encode_body(body)
        except Exception as err:
            # Deterministic, so retrying can never help: fail fast like the
            # 4xx path. ``_encode_body`` rewrites every value it can, so this
            # is a last-resort guard rather than an expected outcome.
            return self._fail(err, endpoint)

        outcome = self._send_with_retry(method, f"{self._base_url}{path}", payload, endpoint)
        if outcome.error is not None:
            return self._fail(outcome.error, endpoint)
        return outcome.value

    def _await_predecessor(self, after: Optional[Future[Any]]) -> None:
        # Honour ordering: a span's POST must observe its parent trace's
        # POST. If the parent task failed, swallow it: the child will almost
        # certainly 404 too, but that's the silent SDK contract.
        if after is None:
            return
        try:
            after.result(timeout=self._predecessor_wait_s)
        except Exception:
            pass

    def _send_with_retry(
        self, method: str, url: str, payload: str, endpoint: str
    ) -> _Outcome:
        last_error: BaseException = RuntimeError(f"[spanlens] {endpoint} was not attempted")
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                res = self._http.request(method, url, content=payload, headers=self._headers)
            except httpx.HTTPError as err:
                # Network failure or timeout: retryable.
                last_error = err
            except Exception as err:
                # e.g. the client was closed underneath us. Not retryable.
                return _Outcome(error=err)
            else:
                if res.status_code < 400:
                    return _Outcome(value=_parse_json(res.text))
                error = _http_error(res, endpoint)
                if not _is_retryable_status(res.status_code):
                    self._warn_actionable(error)
                    return _Outcome(error=error)
                last_error = error
            if attempt < MAX_ATTEMPTS:
                _sleep(_retry_delay_s(attempt))
        return _Outcome(error=last_error)

    def _fail(self, err: BaseException, endpoint: str) -> None:
        """Report a failed call exactly once, then honour ``silent``. With
        ``silent=False`` the error is raised inside the worker, so it lands
        on the call's Future and never reaches user code directly."""
        self._notify(err, endpoint)
        if not self._silent:
            raise err
        return None

    def _notify(self, err: BaseException, context: str) -> None:
        if self._on_error is None:
            return
        try:
            self._on_error(err, context)
        except Exception:
            logger.debug("spanlens on_error hook raised", exc_info=True)

    def _warn_actionable(self, err: SpanlensTransportError) -> None:
        """One log warning per (status, code) for the misconfigurations that
        are otherwise invisible under the default ``silent=True``."""
        hint = _actionable_hint(err.status, err.code)
        if hint is None:
            return
        key = f"{err.status}:{err.code}"
        with self._state_lock:
            if key in self._warned:
                return
            self._warned.add(key)
        logger.warning("[spanlens] %s failed with %s. %s", err.endpoint, err.status, hint)

    def _shutdown(self, timeout: Optional[float]) -> None:
        with self._state_lock:
            if self._closed:
                return
            self._closed = True
        try:
            self._pool.shutdown(timeout)
        except Exception:
            logger.debug("spanlens worker pool shutdown failed", exc_info=True)
        try:
            self._http.close()
        except Exception:
            pass


def _parse_json(text: str) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _http_error(res: httpx.Response, endpoint: str) -> SpanlensTransportError:
    status = res.status_code
    text = res.text or ""
    envelope_code, envelope_message = _parse_error_envelope(text)
    if envelope_code is not None:
        code = envelope_code
        detail = envelope_message or ""
    elif status == 429:
        code = "RATE_LIMITED"
        detail = "monthly quota or rate limit reached"
    else:
        code = f"HTTP_{status}"
        detail = text[:200]
    return SpanlensTransportError(
        f"[spanlens] {endpoint} failed: {status} {code} {detail}".rstrip(),
        code=code,
        status=status,
        endpoint=endpoint,
    )


def _parse_error_envelope(text: str) -> tuple[Optional[str], Optional[str]]:
    """Read ``{"error": {"code", "message"}}`` when the server sent it."""
    if not text:
        return None, None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None, None
    error = parsed.get("error") if isinstance(parsed, dict) else None
    if not isinstance(error, dict):
        return None, None
    code = error.get("code")
    message = error.get("message")
    if not isinstance(code, str):
        return None, None
    return code, message if isinstance(message, str) else None


def _actionable_hint(status: int, code: str) -> Optional[str]:
    if status == 401:
        return (
            "Check that SPANLENS_API_KEY is loaded in this process and that the key "
            f"was not revoked. Docs: {_DOCS_QUICK_START_URL}"
        )
    if status == 403 and code == "PUBLIC_KEY_WRITE_FORBIDDEN":
        return (
            "Public keys (sl_live_pub_*) are read-only. Ingest calls need a full "
            f"sl_live_ key. Docs: {_DOCS_QUICK_START_URL}"
        )
    if status == 429:
        return f"Monthly quota or rate limit reached. See {_PRICING_URL}"
    return None


_CIRCULAR_MARKER = "[Circular]"
# Nesting depth past which the rewrite pass stringifies instead of recursing.
_MAX_SAFE_DEPTH = 64


def _encode_body(body: Any) -> str:
    """Encode an ingest body as strict JSON, degrading values instead of
    dropping the call.

    Span input, output, and metadata are arbitrary user values, and a few of
    them defeat ``json.dumps``: dict keys that are not strings (a tuple, a
    pandas ``Timestamp`` or MultiIndex key from ``DataFrame.to_dict()``), a
    circular reference, or NaN / Infinity, which ``json.dumps`` would emit as
    bare literals the server rejects with a 400. Failing the whole call would
    also throw away the status, end time, and token counts that travel in
    the same body, leaving the span ``running`` forever. So when the plain
    encode fails, only the offending values are rewritten: keys become
    strings, non-finite floats become ``null``, a cycle becomes
    ``"[Circular]"``.
    """
    try:
        return json.dumps(body, default=_json_default, allow_nan=False)
    except Exception:
        logger.debug("spanlens ingest body needed rewriting to encode", exc_info=True)
    return json.dumps(_json_safe(body, frozenset(), 0), allow_nan=False)


def _json_safe(value: Any, ancestors: frozenset[int], depth: int) -> Any:
    """Copy ``value`` into something ``json.dumps(allow_nan=False)`` accepts.

    ``ancestors`` holds the ids of the containers on the current path, so a
    value that is merely shared between two branches is kept, while one that
    contains itself is cut.
    """
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if id(value) in ancestors:
        return _CIRCULAR_MARKER
    if depth >= _MAX_SAFE_DEPTH:
        return _safe_str(value)
    inner = ancestors | {id(value)}
    if isinstance(value, dict):
        return {_json_safe_key(k): _json_safe(v, inner, depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_safe(item, inner, depth + 1) for item in value]
    try:
        converted = _json_default(value)
    except Exception:
        return _safe_str(value)
    return _json_safe(converted, inner, depth + 1)


def _json_safe_key(key: Any) -> Any:
    """A dict key ``json.dumps`` accepts. str, int, bool, and None pass
    through (json already knows how to write them); anything else becomes a
    string, using ``isoformat()`` for dates and timestamps."""
    if key is None or isinstance(key, (str, bool, int)):
        return key
    if isinstance(key, float) and math.isfinite(key):
        return key
    iso = getattr(key, "isoformat", None)
    if callable(iso):
        try:
            return str(iso())
        except Exception:
            pass
    return _safe_str(key)


def _safe_str(value: Any) -> str:
    """``str(value)`` that cannot raise, even for a hostile ``__str__`` or a
    structure too deep to print."""
    try:
        return str(value)
    except Exception:
        return f"<unserializable {type(value).__name__}>"


def _json_default(obj: Any) -> Any:
    """Last-resort JSON encoder for opaque user values (datetimes, sets,
    provider SDK response models, ...).

    Falls back to ``str(obj)`` so a non-serialisable field never breaks
    the entire request.
    """
    # Pydantic v2 models (OpenAI / Anthropic response objects).
    model_dump = getattr(obj, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(mode="json")
        except Exception:
            pass
    # Objects that expose a plain-dict view (e.g. google-generativeai responses).
    to_dict = getattr(obj, "to_dict", None)
    if callable(to_dict):
        try:
            return to_dict()
        except Exception:
            pass
    # datetime / date: call isoformat() if available
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


__all__ = [
    "DEFAULT_BASE_URL",
    "DEFAULT_MAX_PENDING",
    "DEFAULT_SHUTDOWN_TIMEOUT_S",
    "MAX_ATTEMPTS",
    "IngestTransport",
    "SpanlensTransportError",
    "Transport",
]
