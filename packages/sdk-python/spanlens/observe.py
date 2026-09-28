"""High-level helpers that wrap a function in a span and auto-end it.

Two flavours are provided:

* ``observe()`` is generic. It takes any callable, runs it inside a span,
  and ensures the span ends even if the callable raises. The callable's
  return value is recorded as the span output.

* ``observe_openai()`` / ``observe_anthropic()`` / ``observe_gemini()`` /
  ``observe_ollama()`` are provider-aware. They inject ``x-trace-id`` /
  ``x-span-id`` headers into the callback so the proxy can link the proxied
  request to this span, parse usage from the LLM response automatically, and
  record the response as the span output.

Privacy: every helper takes ``log_body``. ``"meta"`` and ``"none"`` keep the
span's input and output (and those of spans created under it) out of the
ingest calls entirely; only metadata such as model, tokens, and latency is
sent. The provider helpers also forward the mode to the proxy as the
``x-spanlens-log-body`` header. ``observe_ollama()`` defaults to ``"meta"``
because the whole point of a local model is that prompts and responses stay
on your machine.

Both sync and async callables are supported. Async detection uses an
``inspect.isawaitable`` check on the return value (covers callables that
return coroutines without being declared ``async``, e.g. partials).
"""

from __future__ import annotations

import inspect
from collections.abc import AsyncIterator, Iterator
from typing import Any, Awaitable, Callable, Optional, TypeVar, Union, cast

from .parsers import parse_anthropic_usage, parse_gemini_usage, parse_openai_usage
from .span import _OMIT, SpanHandle, _disable_body_capture
from .trace import TraceHandle
from .types import LogBodyMode, SpanType

T = TypeVar("T")

PROMPT_VERSION_HEADER = "x-spanlens-prompt-version"
LOG_BODY_HEADER = "x-spanlens-log-body"

_LOG_BODY_MODES = ("full", "meta", "none")

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
    input: Any = _OMIT,
    log_body: Optional[LogBodyMode] = None,
) -> T:
    """Run ``fn`` inside a new child span, auto-ending it.

    The span ends with ``status="completed"`` on success and
    ``status="error"`` (with ``error_message`` from the exception) on
    failure. The exception is re-raised — observe never swallows.

    ``fn``'s return value is recorded as the span output unless it is a
    stream (iterator, generator, async iterator). ``input`` is recorded when
    the span is created. With ``log_body="meta"`` or ``"none"`` neither is
    sent, even if ``fn`` passes ``output=`` to ``span.end()`` itself.

    If ``fn`` already called ``span.end(...)`` without an output (typical
    when it records token counts after consuming a stream), the returned
    value is still attached to the span as its output.

    Both sync and async callables work::

        # sync
        result = observe(trace, "vector_search", lambda span: store.query(q))

        # async
        result = await observe(trace, "vector_search", lambda span: store.aquery(q))
    """
    capture_body = _capture_body(log_body)
    span = _start_child(
        parent,
        name,
        span_type=span_type,
        metadata=metadata,
        input=input,
        capture_body=capture_body,
    )

    try:
        result = fn(span)
    except BaseException as err:
        span.end(status="error", error_message=str(err))
        raise

    if inspect.isawaitable(result):
        return cast(T, _finish_async(span, result))

    span.end(status="completed", **_output_kwargs(result))
    return result


async def _finish_async(span: SpanHandle, awaitable: Awaitable[T]) -> T:
    try:
        result = await awaitable
    except BaseException as err:
        span.end(status="error", error_message=str(err))
        raise
    span.end(status="completed", **_output_kwargs(result))
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
    input: Any = _OMIT,
    log_body: Optional[LogBodyMode] = None,
) -> T:
    """Observe an OpenAI call.

    ``fn`` receives a dict of HTTP headers — pass them to the OpenAI SDK via
    its ``extra_headers`` option so the proxy can link the request row to
    this span. The response's ``usage`` is parsed and recorded automatically,
    and the response itself becomes the span output (skipped for streams and
    for ``log_body="meta"`` / ``"none"``).

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
        input=input,
        log_body=log_body,
    )


def observe_anthropic(
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    *,
    metadata: Optional[dict[str, Any]] = None,
    prompt_version: Optional[str] = None,
    provider: Optional[str] = None,
    input: Any = _OMIT,
    log_body: Optional[LogBodyMode] = None,
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
        input=input,
        log_body=log_body,
    )


def observe_gemini(
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    *,
    metadata: Optional[dict[str, Any]] = None,
    prompt_version: Optional[str] = None,
    input: Any = _OMIT,
    log_body: Optional[LogBodyMode] = None,
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
        input=input,
        log_body=log_body,
    )


def observe_ollama(
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    *,
    metadata: Optional[dict[str, Any]] = None,
    prompt_version: Optional[str] = None,
    input: Any = _OMIT,
    log_body: Optional[LogBodyMode] = "meta",
) -> T:
    """Observe a self-hosted Ollama call (OpenAI-compatible endpoint).

    Ollama exposes an OpenAI-compatible API at ``http://localhost:11434/v1``,
    so usage parsing reuses ``parse_openai_usage``. The trace is tagged
    ``provider: "ollama"`` so the dashboard distinguishes it from real OpenAI.

    ``log_body`` defaults to ``"meta"``: only metadata (model, tokens,
    latency) is sent to Spanlens, and the prompt and response stay on your
    machine. Pass ``log_body="full"`` to record them as span input and output.

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
        input=input,
        log_body=log_body,
    )


# ── Internals ───────────────────────────────────────────────────


def _capture_body(log_body: Optional[str]) -> bool:
    """Validate ``log_body`` and say whether span input/output may be sent.

    Unknown values raise instead of silently falling back to ``full``: a
    typo in a privacy setting must not leak the bodies it meant to hide.
    """
    if log_body is not None and log_body not in _LOG_BODY_MODES:
        raise ValueError(
            f"[spanlens] log_body must be one of {', '.join(_LOG_BODY_MODES)} "
            f"(got {log_body!r})"
        )
    return log_body not in ("meta", "none")


def _is_stream_like(value: Any) -> bool:
    """True for values whose contents are not safely serializable as span
    output: iterators, generators, and async iterables (e.g. OpenAI /
    Anthropic ``Stream`` objects). Plain containers (list, dict, str, ...)
    are iterable but not iterators, so they are captured."""
    if isinstance(value, (str, bytes, bytearray, dict, list, tuple, set, frozenset)):
        return False
    if isinstance(value, (Iterator, AsyncIterator)):
        return True
    return hasattr(value, "__aiter__")


def _output_kwargs(result: Any) -> dict[str, Any]:
    return {} if _is_stream_like(result) else {"output": result}


def _start_child(
    parent: Parent,
    name: str,
    *,
    span_type: SpanType,
    metadata: Optional[dict[str, Any]],
    input: Any,
    capture_body: bool,
) -> SpanHandle:
    """Start a span under either a trace or another span."""
    kwargs: dict[str, Any] = {"span_type": span_type, "metadata": metadata}
    if capture_body and input is not _OMIT:
        kwargs["input"] = input
    if isinstance(parent, TraceHandle):
        span = parent.span(name, **kwargs)
    else:
        span = parent.child(name, **kwargs)
    return span if capture_body else _disable_body_capture(span)


def _observe_provider(
    *,
    provider: str,
    provider_override: Optional[str],
    parent: Parent,
    name: str,
    fn: Callable[[dict[str, str]], T],
    metadata: Optional[dict[str, Any]],
    prompt_version: Optional[str],
    input: Any,
    log_body: Optional[LogBodyMode],
) -> T:
    capture_body = _capture_body(log_body)
    span = _start_child(
        parent,
        name,
        span_type="llm",
        metadata=metadata,
        input=input,
        capture_body=capture_body,
    )

    headers = dict(span.trace_headers())
    if prompt_version:
        headers[PROMPT_VERSION_HEADER] = prompt_version
    if log_body is not None:
        headers[LOG_BODY_HEADER] = log_body

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
        return cast(T, _finish_provider_async(span, result, parser, provider_tag))

    span.end(status="completed", **_provider_end_kwargs(result, parser, provider_tag))
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
    span.end(status="completed", **_provider_end_kwargs(result, parser, provider_tag))
    return result


def _provider_end_kwargs(
    result: Any,
    parser: Callable[[Any], dict[str, Any]],
    provider_tag: str,
) -> dict[str, Any]:
    return {**_with_provider(parser(result), provider_tag), **_output_kwargs(result)}


def _with_provider(parsed: dict[str, Any], provider_tag: str) -> dict[str, Any]:
    """Merge ``provider`` into the parsed result's ``metadata`` without
    mutating the parser output. Preserves any existing metadata keys (e.g.
    ``model``) the parser already populated."""
    existing = parsed.get("metadata") or {}
    merged = {**existing, "provider": provider_tag}
    return {**parsed, "metadata": merged}


__all__ = [
    "LOG_BODY_HEADER",
    "PROMPT_VERSION_HEADER",
    "observe",
    "observe_anthropic",
    "observe_gemini",
    "observe_ollama",
    "observe_openai",
]
