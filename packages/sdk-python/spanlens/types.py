"""Spanlens SDK public types.

Mirrors the TypeScript SDK's `types.ts` exactly so the on-the-wire shape stays
consistent across language SDKs.
"""

from __future__ import annotations

from typing import Any, Callable, Literal, Optional

# Python 3.9 doesn't expose `NotRequired`; pull it from typing_extensions if
# available, otherwise fall back to making every TypedDict field required by
# treating them as plain dicts at the call site.
try:  # pragma: no cover - import-time branch
    from typing import NotRequired, TypedDict
except ImportError:  # Python < 3.11
    from typing import TypedDict

    from typing_extensions import NotRequired  # type: ignore[assignment]


SpanType = Literal["llm", "tool", "retrieval", "embedding", "custom"]
"""Categorises what the span represents — drives the dashboard icon/colour."""

Status = Literal["running", "completed", "error"]
"""Lifecycle state of a trace or span."""


# ── Configuration ────────────────────────────────────────────────


class SpanlensConfig(TypedDict, total=False):
    """Constructor options for ``SpanlensClient``.

    Attributes:
        api_key: Spanlens API key created in the dashboard
            (``sl_live_...`` or ``sl_test_...``). **Required.**
        base_url: API base URL — default ``https://spanlens-server.vercel.app``.
        timeout_ms: Request timeout in ms for ingest calls (default 3000).
            Observability calls should not block user code indefinitely.
        silent: Swallow all errors so instrumentation never crashes user code
            (default ``True``).
        on_error: Custom error hook — called when an ingest call fails.
            Signature ``(err: Exception, context: str) -> None``.
    """

    api_key: str
    base_url: NotRequired[str]
    timeout_ms: NotRequired[int]
    silent: NotRequired[bool]
    on_error: NotRequired[Optional[Callable[[BaseException, str], None]]]


# ── Trace / span options ─────────────────────────────────────────


class TraceOptions(TypedDict, total=False):
    name: str
    metadata: NotRequired[dict[str, Any]]


class SpanOptions(TypedDict, total=False):
    name: str
    span_type: NotRequired[SpanType]
    parent_span_id: NotRequired[str]
    input: NotRequired[Any]
    metadata: NotRequired[dict[str, Any]]
    request_id: NotRequired[str]
    """Link this span to a Spanlens proxy request (set automatically by wrappers)."""


class EndTraceOptions(TypedDict, total=False):
    status: NotRequired[Status]
    error_message: NotRequired[str]
    metadata: NotRequired[dict[str, Any]]


class EndSpanOptions(TypedDict, total=False):
    status: NotRequired[Status]
    output: NotRequired[Any]
    error_message: NotRequired[str]
    metadata: NotRequired[dict[str, Any]]
    prompt_tokens: NotRequired[int]
    completion_tokens: NotRequired[int]
    total_tokens: NotRequired[int]
    cost_usd: NotRequired[float]
    request_id: NotRequired[str]


__all__ = [
    "EndSpanOptions",
    "EndTraceOptions",
    "SpanOptions",
    "SpanType",
    "SpanlensConfig",
    "Status",
    "TraceOptions",
]
