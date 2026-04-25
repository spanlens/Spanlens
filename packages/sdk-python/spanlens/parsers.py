"""Response parsers for major LLM providers.

Extracts usage/cost metadata from a provider response and produces the shape
that ``SpanHandle.end()`` accepts as keyword arguments.

These are *structural* parsers: they tolerate missing fields (streaming,
tool calls, errors) and silently return an empty dict when the response
shape isn't recognised — instrumentation must never crash user code.

Each parser supports two response shapes:

* The official Python SDK objects (``openai.types.CompletionUsage`` etc.) —
  Pydantic-style models with attribute access.
* Plain dicts (for users who consume the raw HTTP response or use a third-
  party SDK that returns dicts).
"""

from __future__ import annotations

from typing import Any


def _get(obj: Any, key: str) -> Any:
    """Read ``key`` from either a dict or an attribute-style object.

    Returns ``None`` when the field is absent — never raises so a
    half-shaped response doesn't blow up instrumentation.
    """
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


# ── OpenAI (chat.completions / responses / embeddings) ──────────


def parse_openai_usage(res: Any) -> dict[str, Any]:
    """Parse an OpenAI response and return kwargs for ``span.end()``.

    Handles both ``chat.completions`` (``prompt_tokens`` /
    ``completion_tokens``) and the newer ``responses`` API
    (``input_tokens`` / ``output_tokens``).
    """
    if res is None:
        return {}

    usage = _get(res, "usage")
    if usage is None:
        return {}

    prompt_tokens = _get(usage, "prompt_tokens") or _get(usage, "input_tokens") or 0
    completion_tokens = _get(usage, "completion_tokens") or _get(usage, "output_tokens") or 0
    total_tokens = _get(usage, "total_tokens") or (prompt_tokens + completion_tokens)

    out: dict[str, Any] = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }
    model = _get(res, "model")
    if model:
        out["metadata"] = {"model": model}
    return out


# ── Anthropic messages ──────────────────────────────────────────


def parse_anthropic_usage(res: Any) -> dict[str, Any]:
    """Parse an Anthropic ``messages.create`` response.

    Anthropic uses ``input_tokens`` / ``output_tokens`` and *does not*
    provide ``total_tokens`` — we sum them ourselves.
    """
    if res is None:
        return {}

    usage = _get(res, "usage")
    if usage is None:
        return {}

    prompt_tokens = _get(usage, "input_tokens") or 0
    completion_tokens = _get(usage, "output_tokens") or 0
    total_tokens = prompt_tokens + completion_tokens

    out: dict[str, Any] = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }
    model = _get(res, "model")
    if model:
        out["metadata"] = {"model": model}
    return out


# ── Google Gemini (generate_content) ────────────────────────────


def parse_gemini_usage(res: Any) -> dict[str, Any]:
    """Parse a Gemini ``generate_content`` response.

    Gemini uses camelCase keys in JSON (``promptTokenCount``,
    ``candidatesTokenCount``) but the Python SDK exposes snake_case
    attributes (``prompt_token_count``). We try both.
    """
    if res is None:
        return {}

    usage = _get(res, "usage_metadata") or _get(res, "usageMetadata")
    if usage is None:
        return {}

    prompt_tokens = (
        _get(usage, "prompt_token_count") or _get(usage, "promptTokenCount") or 0
    )
    completion_tokens = (
        _get(usage, "candidates_token_count")
        or _get(usage, "candidatesTokenCount")
        or 0
    )
    total_tokens = (
        _get(usage, "total_token_count")
        or _get(usage, "totalTokenCount")
        or (prompt_tokens + completion_tokens)
    )

    out: dict[str, Any] = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }
    model = _get(res, "model_version") or _get(res, "modelVersion")
    if model:
        out["metadata"] = {"model": model}
    return out


__all__ = ["parse_anthropic_usage", "parse_gemini_usage", "parse_openai_usage"]
