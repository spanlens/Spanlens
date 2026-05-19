"""Spanlens SDK entry point — wraps the transport and exposes ``start_trace()``."""

from __future__ import annotations

from typing import Any, Callable, Optional

from .sampler import BufferingTransport, should_sample, validate_sample_rate
from .trace import TraceHandle, create_trace
from .transport import Transport


class SpanlensClient:
    """Single entry point for the Spanlens SDK.

    Example:
        >>> from spanlens import SpanlensClient
        >>> client = SpanlensClient(api_key="sl_live_...")
        >>> trace = client.start_trace("chat_session", metadata={"user_id": "u_42"})
        >>> span = trace.span("call_openai", span_type="llm")
        >>> # ... do work ...
        >>> span.end(total_tokens=150, cost_usd=0.0023)
        >>> trace.end(status="completed")

    Example (sampling — keep 10% of successful traces; errors always logged):
        >>> client = SpanlensClient(api_key="sl_live_...", sample_rate=0.1)
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: Optional[str] = None,
        timeout_ms: int = 3000,
        silent: bool = True,
        on_error: Optional[Callable[[BaseException, str], None]] = None,
        sample_rate: Optional[float] = None,
    ) -> None:
        if not api_key or not api_key.strip():
            raise ValueError("[spanlens] api_key is required")

        # Validate early so a malformed value can't silently drop 100% of traces.
        self._sample_rate = validate_sample_rate(sample_rate)

        config: dict[str, Any] = {
            "api_key": api_key,
            "timeout_ms": timeout_ms,
            "silent": silent,
        }
        if base_url is not None:
            config["base_url"] = base_url
        if on_error is not None:
            config["on_error"] = on_error

        self._transport = Transport(config)

    def start_trace(
        self,
        name: str,
        *,
        metadata: Optional[dict[str, Any]] = None,
    ) -> TraceHandle:
        """Start a new trace.

        Returns immediately — ingest runs in the background. Use the returned
        handle as a context manager to auto-end on scope exit::

            with client.start_trace("rag_pipeline") as trace:
                with trace.span("retrieval", span_type="retrieval") as span:
                    ...

        Sampling: the decision is made here (per-trace) and is sticky for
        every span beneath this trace. Sampled-out traces buffer their
        ingest calls in memory; the buffer is either replayed (on
        ``status='error'``) or dropped (on success) when ``trace.end()`` runs.
        """
        sampled = should_sample(self._sample_rate)
        # Sampled-in: hand the trace the real transport directly (identical
        # to pre-P3.8). Sampled-out: wrap with a BufferingTransport so child
        # POSTs/PATCHes are queued in memory until the trace ends.
        trace_transport: Any = (
            self._transport
            if sampled
            else BufferingTransport(self._transport)
        )
        return create_trace(
            trace_transport,
            name,
            metadata,
            sampled=sampled,
            real_transport=self._transport,
        )

    def close(self) -> None:
        """Drain in-flight ingest calls and release the connection pool.

        Optional — also runs automatically at interpreter shutdown via
        ``atexit``. Call explicitly when you need to guarantee delivery (e.g.
        in short-lived scripts that exit before the background pool flushes).
        """
        self._transport.close()

    # Allow `with SpanlensClient(...) as c:` for tidy script lifetimes.
    def __enter__(self) -> SpanlensClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ── Internal escape hatch for the integrations module ───────

    @property
    def _transport_internal(self) -> Transport:
        """Exposed for wrappers (openai/anthropic auto-instrumentation)."""
        return self._transport


__all__ = ["SpanlensClient"]
