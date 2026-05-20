"""High-level helpers that wrap a function in a span and auto-end it.

Two flavours are provided:

* ``observe()`` — generic. Takes any callable, runs it inside a span, and
  ensures the span ends even if the callable raises.

* ``observe_openai()`` / ``observe_anthropic()`` / ``observe_gemini()`` —
  provider-aware. Inject ``x-trace-id`` / ``x-span-id`` headers into the
  callback so the proxy can link the proxied request to this span, then
  parse usage from the LLM response automatically.

Both sync and async callables are supported. Async detection uses
``asyncio.iscoroutinefunction`` plus an ``inspect.isawaitable`` check on
the return value (covers callables that return coroutines without being
declared ``async``, e.g. partials).
"""

from __future__ import annotations

import inspect
from typing import Any, Awaitable, Callable, Optional, TypeVar, Union

from .parsers import parse_anthropic_usage, parse_gemini_usage, parse_openai_usage
from .span import SpanHandle
from .trace import TraceHandle
from .types import SpanType

T = TypeVar("T")

PROMPT_VERSION_HEADER = "x-spanlens-prompt-version"

Parent = Union[TraceHandle, SpanHandle]
"""A trace or a span — both can produce a child span via ``span()`` /
``child()`` respectively."""


# ── Generic observe ─────────────────────────────────────────────


def observe(
    parent: Parent,
    name: str,
    fn: Callable[[SpanHandle], T],
    *,
    span_type: SpanType = "custom",
    metadata: Optional[dict[str, Any]] = None,
) -> T:
    """Run ``fn`` inside a new child span, auto-ending it.

    The span ends with ``status="completed"`` on success and
    ``status="error"`` (with ``error_message`` from the exception) on
    failure. The exception is re-raised — observe never swallows.

    Both sync and async callables work::

        # sync
        result = observe(trace, "vector_search", lambda span: store.query(q))

        # async
        result = await observe(trace, "vector_search", lambda span: store.aquery(q))
    """
    span = _start_child(parent, name, span_type=span_type, metadata=metadata)

    try:
        result = fn(span)
    except BaseException as err:
        span.end(status="error", error_message=str(err))
        raise

    if inspect.isawaitable(result):
        return _finish_async(span, result)  # type: ignore[return-value]

    span.end(status="completed")
    return result


async def _finish_async(span: SpanHandle, awaitable: Awaitable[T]) -> T:
    try:
        result = await awaitable
    except BaseException as err:
        span.end(status="error", error_message=str(err))
        raise
    span.end(status="completed")
    return result


# ── Provider-aware observe ──────────────────────────────────────


def observe_openai(
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    *,
    metadata: Optional[dict[str, Any]] = None,
    prompt_version: Optional[str] = None,
    provider: Optional[str] = None,
) -> T:
    """Observe an OpenAI call.

    ``fn`` receives a dict of HTTP headers — pass them to the OpenAI SDK via
    its ``extra_headers`` option so the proxy can link the request row to
    this span. The response's ``usage`` is parsed and recorded automatically.

    Example::

        from openai import OpenAI
        client = OpenAI(...)

        result = observe_openai(trace, "answer", lambda headers:
            client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                extra_headers=headers,
            )
        )

    For an OpenAI-compatible endpoint that isn't actually OpenAI
    (vLLM, LM Studio, Together, Groq, etc.) pass ``provider="vllm"`` etc.
    so the dashboard tags the span correctly. For Ollama specifically, prefer
    :func:`observe_ollama` — clearer intent.
    """
    return _observe_provider(
        provider="openai",
        provider_override=provider,
        parent=parent,
        name=name,
        fn=fn,
        metadata=metadata,
        prompt_version=prompt_version,
    )


def observe_anthropic(
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    *,
    metadata: Optional[dict[str, Any]] = None,
    prompt_version: Optional[str] = None,
    provider: Optional[str] = None,
) -> T:
    """Anthropic variant — parses ``input_tokens`` / ``output_tokens``."""
    return _observe_provider(
        provider="anthropic",
        provider_override=provider,
        parent=parent,
        name=name,
        fn=fn,
        metadata=metadata,
        prompt_version=prompt_version,
    )


def observe_gemini(
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    *,
    metadata: Optional[dict[str, Any]] = None,
    prompt_version: Optional[str] = None,
) -> T:
    """Gemini variant — parses ``usage_metadata``.

    Note:
        The Google ``generativeai`` Python SDK does not currently expose a
        per-call ``extra_headers`` option, so the headers passed to ``fn``
        are informational unless you build the request via raw HTTP. The
        usage parsing still works regardless.
    """
    return _observe_provider(
        provider="gemini",
        provider_override=None,
        parent=parent,
        name=name,
        fn=fn,
        metadata=metadata,
        prompt_version=prompt_version,
    )


def observe_ollama(
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    *,
    metadata: Optional[dict[str, Any]] = None,
    prompt_version: Optional[str] = None,
) -> T:
    """Observe a self-hosted Ollama call (OpenAI-compatible endpoint).

    Ollama exposes an OpenAI-compatible API at ``http://localhost:11434/v1``,
    so usage parsing reuses ``parse_openai_usage``. The trace is tagged
    ``provider: "ollama"`` so the dashboard distinguishes it from real OpenAI.

    Cost is left as ``None`` (Ollama is self-hosted — no per-token bill
    Spanlens can compute) and the dashboard renders a "Self-hosted" badge.

    Example::

        from openai import OpenAI
        from spanlens import observe_ollama

        ollama = OpenAI(
            base_url="http://localhost:11434/v1",
            api_key="ollama",  # ignored by local Ollama; required by the SDK
        )

        response = observe_ollama(trace, "chat", lambda headers:
            ollama.chat.completions.create(
                model="llama3.2",
                messages=[{"role": "user", "content": "Hello"}],
                extra_headers=headers,
            )
        )

    For other OpenAI-compatible self-hosted runtimes (vLLM, LM Studio, etc.)
    use ``observe_openai(..., provider="vllm")`` with the override kwarg.
    """
    return _observe_provider(
        provider="ollama",
        provider_override=None,
        parent=parent,
        name=name,
        fn=fn,
        metadata=metadata,
        prompt_version=prompt_version,
    )


# ── Internals ───────────────────────────────────────────────────


def _start_child(
    parent: Parent,
    name: str,
    *,
    span_type: SpanType,
    metadata: Optional[dict[str, Any]] = None,
) -> SpanHandle:
    """Start a span under either a trace or another span."""
    if isinstance(parent, TraceHandle):
        return parent.span(name, span_type=span_type, metadata=metadata)
    return parent.child(name, span_type=span_type, metadata=metadata)


def _observe_provider(
    *,
    provider: str,
    provider_override: Optional[str],
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], Any],
    metadata: Optional[dict[str, Any]],
    prompt_version: Optional[str],
) -> Any:
    span = _start_child(parent, name, span_type="llm", metadata=metadata)

    headers = dict(span.trace_headers())
    if prompt_version:
        headers[PROMPT_VERSION_HEADER] = prompt_version

    # Ollama reuses OpenAI's response schema (it exposes an /v1 OpenAI-compat
    # surface), so the parser is the OpenAI one — only the provider tag differs.
    parser = {
        "openai": parse_openai_usage,
        "anthropic": parse_anthropic_usage,
        "gemini": parse_gemini_usage,
        "ollama": parse_openai_usage,
    }[provider]

    # Explicit override wins (e.g. observe_openai(..., provider="vllm")).
    # Otherwise tag with the wrapper name.
    provider_tag = provider_override or provider

    try:
        result = fn(headers)
    except BaseException as err:
        span.end(status="error", error_message=str(err))
        raise

    if inspect.isawaitable(result):
        return _finish_provider_async(span, result, parser, provider_tag)

    span.end(status="completed", **_with_provider(parser(result), provider_tag))
    return result


async def _finish_provider_async(
    span: SpanHandle,
    awaitable: Awaitable[Any],
    parser: Callable[[Any], dict[str, Any]],
    provider_tag: str,
) -> Any:
    try:
        result = await awaitable
    except BaseException as err:
        span.end(status="error", error_message=str(err))
        raise
    span.end(status="completed", **_with_provider(parser(result), provider_tag))
    return result


def _with_provider(parsed: dict[str, Any], provider_tag: str) -> dict[str, Any]:
    """Merge ``provider`` into the parsed result's ``metadata`` without
    mutating the parser output. Preserves any existing metadata keys (e.g.
    ``model``) the parser already populated."""
    existing = parsed.get("metadata") or {}
    merged = {**existing, "provider": provider_tag}
    return {**parsed, "metadata": merged}


__all__ = [
    "PROMPT_VERSION_HEADER",
    "observe",
    "observe_anthropic",
    "observe_gemini",
    "observe_ollama",
    "observe_openai",
]
