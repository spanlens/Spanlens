"""Active trace handle. Returned by ``client.start_trace()``.

The trace can also be used as a context manager so that ``end()`` is called
automatically — including ``status="error"`` if the block raises.
"""

from __future__ import annotations

import uuid
from concurrent.futures import Future
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Optional, Union

from .sampler import BufferingTransport
from .span import _OMIT as _OMIT_SENTINEL
from .span import SpanHandle, _completed_future, create_span
from .transport import Transport
from .types import SpanType


class TraceHandle:
    """Represents an in-progress trace. Lives until ``end()`` (or context exit)."""

    def __init__(
        self,
        transport: Union[Transport, BufferingTransport],
        *,
        trace_id: str,
        name: str,
        started_at: datetime,
        sampled: bool,
        real_transport: Transport,
    ) -> None:
        self._transport = transport
        self.trace_id = trace_id
        self.name = name
        self.started_at = started_at

        # Sampling state — kept as private fields so user code is unaware.
        self._sampled = sampled
        self._real_transport = real_transport

        # In-flight POST /ingest/traces. Spans + the trace's own end() PATCH
        # must chain after this so the server sees INSERT before any
        # downstream INSERT/UPDATE that references this trace_id.
        self._creation_future: Future[Any] = _completed_future()
        self._ended = False

    # ── Span creation ────────────────────────────────────────────

    def span(
        self,
        name: str,
        *,
        span_type: SpanType = "custom",
        parent_span_id: Optional[str] = None,
        input: Any = _OMIT_SENTINEL,
        metadata: Optional[dict[str, Any]] = None,
        request_id: Optional[str] = None,
    ) -> SpanHandle:
        """Create a top-level (root) span under this trace."""
        return create_span(
            self._transport,
            self.trace_id,
            name=name,
            span_type=span_type,
            parent_span_id=parent_span_id,
            input=input,
            metadata=metadata,
            request_id=request_id,
            parent_creation_future=self._creation_future,
        )

    # ── Lifecycle ────────────────────────────────────────────────

    def end(
        self,
        *,
        status: Optional[str] = None,
        error_message: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        """End the trace. Idempotent.

        ``duration_ms`` is computed server-side from ``started_at`` +
        ``ended_at``. The PATCH is queued behind the trace's own creation
        POST — otherwise it could race ahead and target a row that doesn't
        exist yet (silent 404).

        Sampling semantics (P3.8):

        * Sampled-in trace → behaves exactly as before; the PATCH goes
          through the real transport.
        * Sampled-out trace + ``status='error'`` → replay buffered span/trace
          POSTs to the real transport first (tail-based error bypass), then
          send the end PATCH directly to the real transport so it isn't
          re-buffered. Net result on the dashboard: identical to a
          sampled-in error trace.
        * Sampled-out trace + ``status='completed'`` → drop the buffer
          silently; no network traffic for this trace's ingest layer.
        """
        if self._ended:
            return
        self._ended = True

        resolved_status = status or ("error" if error_message else "completed")
        body: dict[str, Any] = {
            "status": resolved_status,
            "ended_at": datetime.now(timezone.utc).isoformat(),
        }
        if error_message is not None:
            body["error_message"] = error_message
        if metadata is not None:
            body["metadata"] = metadata

        if self._sampled:
            # Fast path — identical to pre-P3.8 behaviour.
            self._transport.patch(
                f"/ingest/traces/{self.trace_id}",
                body,
                after=self._creation_future,
            )
            return

        # Sampled-out path. The trace's `_transport` here is the
        # BufferingTransport that has been queuing every span POST/PATCH.
        buffering = self._transport
        assert isinstance(buffering, BufferingTransport)

        if resolved_status == "error":
            # Tail-based bypass: replay the buffered ops via the real
            # transport, then send the end-PATCH directly so it doesn't
            # get re-buffered.
            buffering.flush_buffered()
            self._real_transport.patch(
                f"/ingest/traces/{self.trace_id}",
                body,
            )
            return

        # Completed / running with no error → drop everything. Nothing to send.

    # ── Context manager ─────────────────────────────────────────

    def __enter__(self) -> TraceHandle:
        return self

    def __exit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        # Auto-end on context exit. If the block raised, mark the trace
        # as errored — but DO NOT swallow the exception (return None
        # propagates the exception, just like a regular `with`).
        if exc is not None:
            self.end(status="error", error_message=str(exc))
        else:
            self.end()


def create_trace(
    transport: Union[Transport, BufferingTransport],
    name: str,
    metadata: Optional[dict[str, Any]] = None,
    *,
    sampled: bool = True,
    real_transport: Optional[Transport] = None,
) -> TraceHandle:
    """Internal helper used by ``SpanlensClient.start_trace()``.

    ``sampled`` + ``real_transport`` are keyword-only and default to the
    sampled-in (back-compat) path. ``SpanlensClient`` always provides them
    explicitly; the defaults exist so external test helpers can still call
    ``create_trace(transport, name)`` without caring about sampling.
    """
    # Back-compat default: when no real_transport is supplied, the trace's
    # transport IS the real one (sampled-in with no buffering).
    resolved_real = real_transport if real_transport is not None else transport
    # If the caller passed a BufferingTransport with no real_transport,
    # that's a programmer error — caller must always supply real_transport
    # when sampling is enabled. We accept it silently here (defaults =
    # sampled-in) so the type checker stays happy; SpanlensClient is the
    # gate that enforces this contract.
    if isinstance(resolved_real, BufferingTransport):
        resolved_real = transport  # not reachable in practice

    trace_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)

    body: dict[str, Any] = {
        "id": trace_id,
        "name": name,
        "started_at": started_at.isoformat(),
    }
    if metadata is not None:
        body["metadata"] = metadata

    handle = TraceHandle(
        transport,
        trace_id=trace_id,
        name=name,
        started_at=started_at,
        sampled=sampled,
        real_transport=resolved_real,  # type: ignore[arg-type]
    )

    # Track the in-flight POST so child spans can chain after it. This
    # prevents a race where a span POST hits the server before the trace
    # INSERT commits, causing the server's ownership check to 404 and the
    # span to be lost. Failures are swallowed (silent SDK contract).
    #
    # For sampled-out traces this POST goes into the BufferingTransport
    # queue instead of hitting the network; replay-on-error preserves order.
    handle._creation_future = transport.post("/ingest/traces", body)
    return handle


__all__ = ["TraceHandle", "create_trace"]
