"""Integration helper tests — verify ``create_openai`` / ``create_anthropic``
construct clients pointed at the proxy with the right key and base URL.

Skipped when the optional dependency isn't installed."""

from __future__ import annotations

import pytest

from spanlens.integrations.openai import (
    DEFAULT_SPANLENS_OPENAI_PROXY,
    PROMPT_VERSION_HEADER,
    SESSION_HEADER,
    USER_HEADER,
    with_prompt_version,
    with_session,
    with_user,
)


def test_openai_with_prompt_version_returns_extra_headers_dict():
    out = with_prompt_version("bot@3")
    assert out == {"extra_headers": {PROMPT_VERSION_HEADER: "bot@3"}}


def test_openai_with_user_returns_extra_headers_dict():
    out = with_user("user-123")
    assert out == {"extra_headers": {USER_HEADER: "user-123"}}


def test_openai_with_session_returns_extra_headers_dict():
    out = with_session("sess-abc")
    assert out == {"extra_headers": {SESSION_HEADER: "sess-abc"}}


def test_openai_helpers_can_be_merged():
    merged = {
        **with_user("u1"),
        **with_session("s1"),
        **with_prompt_version("bot@2"),
    }
    assert merged == {
        "extra_headers": {
            USER_HEADER: "u1",
            SESSION_HEADER: "s1",
            PROMPT_VERSION_HEADER: "bot@2",
        }
    }


def test_openai_user_header_matches_anthropic():
    from spanlens.integrations.anthropic import USER_HEADER as ANTH_USER
    from spanlens.integrations.anthropic import SESSION_HEADER as ANTH_SESSION
    assert USER_HEADER == ANTH_USER
    assert SESSION_HEADER == ANTH_SESSION


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


# ── anthropic helpers ──────────────────────────────────────────


def test_anthropic_with_user_returns_extra_headers_dict():
    from spanlens.integrations.anthropic import USER_HEADER as ANTH_USER
    from spanlens.integrations.anthropic import with_user as anth_with_user

    out = anth_with_user("user-xyz")
    assert out == {"extra_headers": {ANTH_USER: "user-xyz"}}


def test_anthropic_with_session_returns_extra_headers_dict():
    from spanlens.integrations.anthropic import SESSION_HEADER as ANTH_SESSION
    from spanlens.integrations.anthropic import with_session as anth_with_session

    out = anth_with_session("sess-xyz")
    assert out == {"extra_headers": {ANTH_SESSION: "sess-xyz"}}


# ── create_anthropic ───────────────────────────────────────────


@pytest.fixture
def anthropic_installed():
    pytest.importorskip("anthropic")


def test_create_anthropic_requires_api_key(monkeypatch, anthropic_installed):
    from spanlens.integrations.anthropic import create_anthropic

    monkeypatch.delenv("SPANLENS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SPANLENS_API_KEY is not set"):
        create_anthropic()


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
