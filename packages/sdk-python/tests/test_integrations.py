"""Integration helper tests — verify ``create_openai`` / ``create_anthropic``
construct clients pointed at the proxy with the right key and base URL.

Skipped when the optional dependency isn't installed."""

from __future__ import annotations

import pytest

from spanlens.integrations.openai import (
    DEFAULT_SPANLENS_OPENAI_PROXY,
    PROMPT_VERSION_HEADER,
    with_prompt_version,
)


def test_openai_with_prompt_version_returns_extra_headers_dict():
    out = with_prompt_version("bot@3")
    assert out == {"extra_headers": {PROMPT_VERSION_HEADER: "bot@3"}}


# ── create_openai (skipped without optional dep) ────────────────


@pytest.fixture
def openai_installed():
    pytest.importorskip("openai")


def test_create_openai_requires_api_key(monkeypatch, openai_installed):
    from spanlens.integrations.openai import create_openai

    monkeypatch.delenv("SPANLENS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SPANLENS_API_KEY is not set"):
        create_openai()


def test_create_openai_uses_env_var(monkeypatch, openai_installed):
    from spanlens.integrations.openai import create_openai

    monkeypatch.setenv("SPANLENS_API_KEY", "sl_test_envkey")
    client = create_openai()
    # OpenAI Python SDK exposes ``base_url`` as a property.
    assert str(client.base_url).rstrip("/") == DEFAULT_SPANLENS_OPENAI_PROXY


def test_create_openai_explicit_overrides_env(monkeypatch, openai_installed):
    from spanlens.integrations.openai import create_openai

    monkeypatch.setenv("SPANLENS_API_KEY", "sl_test_envkey")
    client = create_openai(api_key="sl_test_explicit", base_url="https://custom.test")
    assert str(client.base_url).rstrip("/") == "https://custom.test"


# ── create_async_openai ────────────────────────────────────────


def test_create_async_openai_requires_api_key(monkeypatch, openai_installed):
    from spanlens.integrations.openai import create_async_openai

    monkeypatch.delenv("SPANLENS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SPANLENS_API_KEY is not set"):
        create_async_openai()


def test_create_async_openai_uses_env_var(monkeypatch, openai_installed):
    from openai import AsyncOpenAI

    from spanlens.integrations.openai import create_async_openai

    monkeypatch.setenv("SPANLENS_API_KEY", "sl_test_async_env")
    client = create_async_openai()
    assert isinstance(client, AsyncOpenAI)
    assert str(client.base_url).rstrip("/") == DEFAULT_SPANLENS_OPENAI_PROXY


def test_create_async_openai_explicit_overrides_env(monkeypatch, openai_installed):
    from spanlens.integrations.openai import create_async_openai

    monkeypatch.setenv("SPANLENS_API_KEY", "sl_test_envkey")
    client = create_async_openai(
        api_key="sl_test_explicit_async",
        base_url="https://custom-async.test",
    )
    assert str(client.base_url).rstrip("/") == "https://custom-async.test"


# ── create_anthropic ───────────────────────────────────────────


@pytest.fixture
def anthropic_installed():
    pytest.importorskip("anthropic")


def test_create_anthropic_requires_api_key(monkeypatch, anthropic_installed):
    from spanlens.integrations.anthropic import create_anthropic

    monkeypatch.delenv("SPANLENS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SPANLENS_API_KEY is not set"):
        create_anthropic()


# ── create_async_anthropic ─────────────────────────────────────


def test_create_async_anthropic_requires_api_key(monkeypatch, anthropic_installed):
    from spanlens.integrations.anthropic import create_async_anthropic

    monkeypatch.delenv("SPANLENS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SPANLENS_API_KEY is not set"):
        create_async_anthropic()


def test_create_async_anthropic_uses_env_var(monkeypatch, anthropic_installed):
    from anthropic import AsyncAnthropic

    from spanlens.integrations.anthropic import (
        DEFAULT_SPANLENS_ANTHROPIC_PROXY,
        create_async_anthropic,
    )

    monkeypatch.setenv("SPANLENS_API_KEY", "sl_test_async_anthropic")
    client = create_async_anthropic()
    assert isinstance(client, AsyncAnthropic)
    assert str(client.base_url).rstrip("/") == DEFAULT_SPANLENS_ANTHROPIC_PROXY


# ── create_gemini (no optional dep needed — pure httpx) ─────────


def test_create_gemini_requires_api_key(monkeypatch):
    from spanlens.integrations.gemini import create_gemini

    monkeypatch.delenv("SPANLENS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SPANLENS_API_KEY is not set"):
        create_gemini()


def test_create_gemini_returns_httpx_client_with_auth(monkeypatch):
    import httpx

    from spanlens.integrations.gemini import (
        DEFAULT_SPANLENS_GEMINI_PROXY,
        create_gemini,
    )

    monkeypatch.setenv("SPANLENS_API_KEY", "sl_test_gemini")
    client = create_gemini()
    try:
        assert isinstance(client, httpx.Client)
        assert str(client.base_url).rstrip("/") == DEFAULT_SPANLENS_GEMINI_PROXY
        assert client.headers["Authorization"] == "Bearer sl_test_gemini"
    finally:
        client.close()


# ── configure_gemini (mocks google.generativeai so no optional dep needed) ──


def test_configure_gemini_uses_rest_transport(monkeypatch):
    """Regression guard: the default gRPC transport silently bypasses the
    proxy (it ignores an https api_endpoint). configure_gemini() MUST pass
    transport="rest" so calls are actually logged. See gemini.py."""
    import sys
    import types
    from unittest.mock import MagicMock

    fake = types.ModuleType("google.generativeai")
    fake.configure = MagicMock()  # type: ignore[attr-defined]
    google_pkg = sys.modules.get("google") or types.ModuleType("google")
    monkeypatch.setitem(sys.modules, "google", google_pkg)
    monkeypatch.setitem(sys.modules, "google.generativeai", fake)
    monkeypatch.setenv("SPANLENS_API_KEY", "sl_test_gem")

    from spanlens.integrations.gemini import (
        DEFAULT_SPANLENS_GEMINI_PROXY,
        configure_gemini,
    )

    configure_gemini()

    fake.configure.assert_called_once()
    kwargs = fake.configure.call_args.kwargs
    assert kwargs["transport"] == "rest"
    assert kwargs["api_key"] == "sl_test_gem"
    assert kwargs["client_options"]["api_endpoint"] == DEFAULT_SPANLENS_GEMINI_PROXY
