"""Parser tests — pure functions, no network."""

from __future__ import annotations

from types import SimpleNamespace

from spanlens.parsers import (
    parse_anthropic_usage,
    parse_gemini_usage,
    parse_openai_usage,
)

# ── OpenAI ──────────────────────────────────────────────────────


def test_parse_openai_usage_chat_completions_dict():
    res = {
        "model": "gpt-4o-mini",
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 34,
            "total_tokens": 46,
        },
    }
    out = parse_openai_usage(res)
    assert out == {
        "prompt_tokens": 12,
        "completion_tokens": 34,
        "total_tokens": 46,
        "metadata": {"model": "gpt-4o-mini"},
    }


def test_parse_openai_usage_responses_api():
    """The newer ``responses`` API uses input_tokens/output_tokens."""
    res = {
        "model": "gpt-4o",
        "usage": {"input_tokens": 5, "output_tokens": 10},
    }
    out = parse_openai_usage(res)
    assert out["prompt_tokens"] == 5
    assert out["completion_tokens"] == 10
    assert out["total_tokens"] == 15  # computed from sum


def test_parse_openai_usage_object_attributes():
    """Pydantic-style OpenAI SDK objects expose attributes, not dict keys."""
    res = SimpleNamespace(
        model="gpt-4o-mini",
        usage=SimpleNamespace(prompt_tokens=10, completion_tokens=20, total_tokens=30),
    )
    out = parse_openai_usage(res)
    assert out["prompt_tokens"] == 10
    assert out["completion_tokens"] == 20
    assert out["total_tokens"] == 30


def test_parse_openai_usage_missing_usage():
    """Streaming chunks without usage should not crash."""
    assert parse_openai_usage({"model": "gpt-4o"}) == {}


def test_parse_openai_usage_none():
    assert parse_openai_usage(None) == {}


# ── Anthropic ───────────────────────────────────────────────────


def test_parse_anthropic_usage_dict():
    res = {
        "model": "claude-3-5-sonnet-20241022",
        "usage": {"input_tokens": 100, "output_tokens": 200},
    }
    out = parse_anthropic_usage(res)
    assert out["prompt_tokens"] == 100
    assert out["completion_tokens"] == 200
    assert out["total_tokens"] == 300  # Anthropic doesn't ship total
    assert out["metadata"] == {"model": "claude-3-5-sonnet-20241022"}


def test_parse_anthropic_usage_object():
    res = SimpleNamespace(
        model="claude-3-haiku-20240307",
        usage=SimpleNamespace(input_tokens=50, output_tokens=75),
    )
    out = parse_anthropic_usage(res)
    assert out["total_tokens"] == 125


def test_parse_anthropic_usage_no_usage():
    assert parse_anthropic_usage({"model": "claude-3"}) == {}


# ── Gemini ──────────────────────────────────────────────────────


def test_parse_gemini_usage_camelcase_dict():
    """Raw HTTP response uses camelCase."""
    res = {
        "modelVersion": "gemini-1.5-flash",
        "usageMetadata": {
            "promptTokenCount": 8,
            "candidatesTokenCount": 16,
            "totalTokenCount": 24,
        },
    }
    out = parse_gemini_usage(res)
    assert out["prompt_tokens"] == 8
    assert out["completion_tokens"] == 16
    assert out["total_tokens"] == 24
    assert out["metadata"] == {"model": "gemini-1.5-flash"}


def test_parse_gemini_usage_snake_case_object():
    """Python SDK exposes snake_case attributes."""
    res = SimpleNamespace(
        model_version="gemini-1.5-pro",
        usage_metadata=SimpleNamespace(
            prompt_token_count=11,
            candidates_token_count=22,
            total_token_count=33,
        ),
    )
    out = parse_gemini_usage(res)
    assert out["prompt_tokens"] == 11
    assert out["completion_tokens"] == 22
    assert out["total_tokens"] == 33


def test_parse_gemini_usage_no_metadata():
    assert parse_gemini_usage({"modelVersion": "gemini"}) == {}


def test_parse_gemini_usage_total_falls_back_to_sum():
    res = {
        "usageMetadata": {
            "promptTokenCount": 10,
            "candidatesTokenCount": 5,
            # totalTokenCount intentionally omitted
        },
    }
    out = parse_gemini_usage(res)
    assert out["total_tokens"] == 15
