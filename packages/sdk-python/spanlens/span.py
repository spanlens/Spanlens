"""Active span handle — returned by ``trace.span()`` or ``parent.child()``."""

from __future__ import annotations

import uuid
from concurrent.futures import Future
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Optional

from .transport import IngestTransport
from .types import SpanType

# Sentinel for "argument intentionally omitted" — distinct from None which
# users may legitimately want to pass as an output.
_OMIT: Any = object()


class SpanHandle:
    """Represents an in-progress span.

    Fire-and-forget: every method returns immediately. Network I/O happens in
    the background transport pool. The handle is usable even when the
    Spanlens server is unreachable — failing calls no-op silently (unless the
    client was created with ``silent=False``).
    """

    def __init__(
        self,
        transport: IngestTransport,
        *,
        span_id: str,
        trace_id: str,
        name: str,
        span_type: SpanType,
        started_at: datetime,
        parent_span_id: Optional[str] = None,
        capture_body: bool = True,
    ) -> None:
        self._transport = transport
        self.span_id = span_id
        self.trace_id = trace_id
        self.name = name
        self.span_type: SpanType = span_type
        self.started_at = started_at
        self.parent_span_id = parent_span_id

        # In-flight POST /ingest/.../spans. ``end()`` and child spans must
        # chain after this so the server sees INSERT before UPDATE.
        self._creation_future: Future[Any] = _completed_future()
        # The end PATCH, so a late output-only PATCH can queue behind it.
        self._end_future: Future[Any] = _completed_future()
        self._ended = False
        self._output_captured = False
        # False when the span was opened under ``log_body="meta"|"none"``:
        # input/output never leave the process for this span or its children.
        self._capture_body = capture_body

    # ── Headers for proxy linkage ────────────────────────────────

    def trace_headers(self) -> dict[str, str]:
        """Return HTTP headers that the Spanlens proxy reads to link a
        proxied LLM call to this span.

        Pass them to the OpenAI/Anthropic/Gemini SDK via its per-request
        ``extra_headers`` (or equivalent) option. The proxy populates
        ``requests.trace_id`` and ``requests.span_id`` from these headers,
        so the dashboard can join spans ↔ raw request logs.
        """
        return {"x-trace-id": self.trace_id, "x-span-id": self.span_id}

    # ── Children ─────────────────────────────────────────────────

    def child(
        self,
        name: str,
        *,
        span_type: SpanType = "custom",
        parent_span_id: Optional[str] = None,
        input: Any = _OMIT,
        metadata: Optional[dict[str, Any]] = None,
        request_id: Optional[str] = None,
    ) -> SpanHandle:
        """Create a nested child span. ``parent_span_id`` defaults to this span's id.

        A child of a span opened with ``log_body="meta"`` or ``"none"``
        inherits that setting, so its input and output stay local too.
        """
        return create_span(
            self._transport,
            self.trace_id,
            name=name,
            span_type=span_type,
            parent_span_id=parent_span_id if parent_span_id is not None else self.span_id,
            input=input,
            metadata=metadata,
            request_id=request_id,
            parent_creation_future=self._creation_future,
            capture_body=self._capture_body,
        )

    # ── Lifecycle ────────────────────────────────────────────────

    def end(
        self,
        *,
        status: Optional[str] = None,
        output: Any = _OMIT,
        error_message: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        prompt_tokens: Optional[int] = None,
        completion_tokens: Optional[int] = None,
        total_tokens: Optional[int] = None,
        cost_usd: Optional[float] = None,
        request_id: Optional[str] = None,
    ) -> None:
        """End the span. Idempotent: a second call does not end it again.

        ``duration_ms`` is computed server-side from ``started_at`` +
        ``ended_at``.

        ``output`` is omitted when not passed. Passing ``output=None``
        explicitly is preserved (sent as JSON ``null``). If the first
        ``end()`` carried no output, a later call that does is sent as an
        output-only update. That is how ``observe()`` records the returned
        value after user code already ended the span with token counts
        (the streaming pattern). Output is never sent for spans opened with
        ``log_body="meta"`` or ``"none"``.
        """
        if not self._capture_body:
            output = _OMIT
        if self._ended:
            self._send_late_output(output)
            return
        self._ended = True
        if output is not _OMIT:
            self._output_captured = True

        resolved_status = status or ("error" if error_message else "completed")

        body: dict[str, Any] = {
            "status": resolved_status,
            "ended_at": datetime.now(timezone.utc).isoformat(),
        }
        if output is not _OMIT:
            body["output"] = output
        if error_message is not None:
            body["error_message"] = error_message
        if metadata is not None:
            body["metadata"] = metadata
        if prompt_tokens is not None:
            body["prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            body["completion_tokens"] = completion_tokens
        if total_tokens is not None:
            body["total_tokens"] = total_tokens
        if cost_usd is not None:
            body["cost_usd"] = cost_usd
        if request_id is not None:
            body["request_id"] = request_id

        # PATCH waits on creation POST so it doesn't 404.
        self._end_future = self._transport.patch(
            f"/ingest/spans/{self.span_id}",
            body,
            after=self._creation_future,
        )

    def _send_late_output(self, output: Any) -> None:
        if output is _OMIT or self._output_captured:
            return
        self._output_captured = True
        self._transport.patch(
            f"/ingest/spans/{self.span_id}",
            {"output": output},
            after=self._end_future,
        )

    # ── Context manager ─────────────────────────────────────────

    def __enter__(self) -> SpanHandle:
        return self

    def __exit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        # Auto-end on context exit. If the block raised, mark the span as
        # errored — but DO NOT swallow the exception (return None
        # propagates the exception, just like a regular `with`).
        if exc is not None:
            self.end(status="error", error_message=str(exc))
        else:
            self.end()


def create_span(
    transport: IngestTransport,
    trace_id: str,
    *,
    name: str,
    span_type: SpanType = "custom",
    parent_span_id: Optional[str] = None,
    input: Any = _OMIT,
    metadata: Optional[dict[str, Any]] = None,
    request_id: Optional[str] = None,
    parent_creation_future: Optional[Future[Any]] = None,
    capture_body: bool = True,
) -> SpanHandle:
    """Internal helper — creates a span and fires the POST in the background,
    chained after the parent's creation Future so the server sees them in
    order. ``capture_body=False`` keeps ``input`` (and later ``output``) off
    the wire.

    Why chain: the server's ``POST /ingest/traces/:id/spans`` verifies trace
    ownership by SELECTing the trace row. If the trace POST hasn't committed
    yet, this 404s and the span is lost. Chaining after the parent's
    ``_creation_future`` guarantees ordering without slowing user code (the
    user's hot path is presumably awaiting the LLM call anyway).
    """
    span_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)

    body: dict[str, Any] = {
        "id": span_id,
        "name": name,
        "span_type": span_type,
        "started_at": started_at.isoformat(),
    }
    if parent_span_id is not None:
        body["parent_span_id"] = parent_span_id
    if input is not _OMIT and capture_body:
        body["input"] = input
    if metadata is not None:
        body["metadata"] = metadata
    if request_id is not None:
        body["request_id"] = request_id

    handle = SpanHandle(
        transport,
        span_id=span_id,
        trace_id=trace_id,
        name=name,
        span_type=span_type,
        started_at=started_at,
        parent_span_id=parent_span_id,
        capture_body=capture_body,
    )

    handle._creation_future = transport.post(
        f"/ingest/traces/{trace_id}/spans",
        body,
        after=parent_creation_future,
    )
    return handle


def _completed_future() -> Future[Any]:
    f: Future[Any] = Future()
    f.set_result(None)
    return f


def _disable_body_capture(span: SpanHandle) -> SpanHandle:
    """Mark a freshly created span so its output (and its children's input
    and output) never leave the process. Used by ``observe()`` for
    ``log_body="meta"`` / ``"none"``; call it before handing the span to
    user code."""
    span._capture_body = False
    return span


__all__ = ["SpanHandle", "create_span"]
