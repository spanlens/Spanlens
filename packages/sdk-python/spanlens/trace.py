"""Active trace handle. Returned by ``client.start_trace()``.

The trace can also be used as a context manager so that ``end()`` is called
automatically — including ``status="error"`` if the block raises.
"""

from __future__ import annotations

import uuid
from concurrent.futures import Future
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Optional

from .span import _OMIT as _OMIT_SENTINEL
from .span import SpanHandle, _completed_future, create_span
from .transport import Transport
from .types import SpanType


class TraceHandle:
    """Represents an in-progress trace. Lives until ``end()`` (or context exit)."""

    def __init__(
        self,
        transport: Transport,
        *,
        trace_id: str,
        name: str,
        started_at: datetime,
    ) -> None:
        self._transport = transport
        self.trace_id = trace_id
        self.name = name
        self.started_at = started_at

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

        self._transport.patch(
            f"/ingest/traces/{self.trace_id}",
            body,
            after=self._creation_future,
        )

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
    transport: Transport,
    name: str,
    metadata: Optional[dict[str, Any]] = None,
) -> TraceHandle:
    """Internal helper used by ``SpanlensClient.start_trace()``."""
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
    )

    # Track the in-flight POST so child spans can chain after it. This
    # prevents a race where a span POST hits the server before the trace
    # INSERT commits, causing the server's ownership check to 404 and the
    # span to be lost. Failures are swallowed (silent SDK contract).
    handle._creation_future = transport.post("/ingest/traces", body)
    return handle


__all__ = ["TraceHandle", "create_trace"]
