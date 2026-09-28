"""``SPANLENS_BASE_URL`` routing for self-hosted Spanlens.

``spanlens init --server-url`` writes ``SPANLENS_BASE_URL=<server origin>``
to ``.env`` and rewrites ``OpenAI(...)`` into ``create_openai()``. The
factories used to ignore that variable, so a self-hosted user's prompts and
key went to the hosted api.spanlens.io instead. Priority, per factory:
explicit ``base_url`` > ``SPANLENS_BASE_URL`` + the provider's proxy path >
the hosted default.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

import pytest

import spanlens.cli.main as cli_main
from spanlens import SpanlensClient
from spanlens.cli.env_writer import read_env_var
from spanlens.cli.key_info import KeyInfo
from spanlens.integrations.anthropic import (
    DEFAULT_SPANLENS_ANTHROPIC_PROXY,
    create_anthropic,
    create_async_anthropic,
)
from spanlens.integrations.gemini import (
    DEFAULT_SPANLENS_GEMINI_PROXY,
    configure_gemini,
    create_gemini,
)
from spanlens.integrations.openai import (
    DEFAULT_SPANLENS_OPENAI_PROXY,
    create_async_openai,
    create_openai,
)

SELF_HOST = "https://spanlens.example.test"
KEY = "sl_live_" + "c" * 24


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SPANLENS_BASE_URL", raising=False)
    monkeypatch.setenv("SPANLENS_API_KEY", KEY)


def _url(client: Any) -> str:
    return str(client.base_url).rstrip("/")


# ── OpenAI / Anthropic factories ─────────────────────────────────────────


@pytest.mark.parametrize(
    ("factory", "path", "hosted"),
    [
        (create_openai, "/proxy/openai/v1", DEFAULT_SPANLENS_OPENAI_PROXY),
        (create_async_openai, "/proxy/openai/v1", DEFAULT_SPANLENS_OPENAI_PROXY),
        (create_anthropic, "/proxy/anthropic", DEFAULT_SPANLENS_ANTHROPIC_PROXY),
        (create_async_anthropic, "/proxy/anthropic", DEFAULT_SPANLENS_ANTHROPIC_PROXY),
    ],
)
def test_factories_follow_spanlens_base_url(
    monkeypatch: pytest.MonkeyPatch, factory: Any, path: str, hosted: str
) -> None:
    assert _url(factory()) == hosted

    monkeypatch.setenv("SPANLENS_BASE_URL", SELF_HOST)
    assert _url(factory()) == f"{SELF_HOST}{path}"

    # A trailing slash in the env value is tolerated.
    monkeypatch.setenv("SPANLENS_BASE_URL", f"{SELF_HOST}/")
    assert _url(factory()) == f"{SELF_HOST}{path}"

    # An explicit base_url always wins.
    assert _url(factory(base_url="https://explicit.test/x")) == "https://explicit.test/x"


def test_env_value_that_already_holds_the_proxy_path_is_not_doubled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SPANLENS_BASE_URL", f"{SELF_HOST}/proxy/openai/v1")
    assert _url(create_openai()) == f"{SELF_HOST}/proxy/openai/v1"


def test_blank_env_value_falls_back_to_hosted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPANLENS_BASE_URL", "   ")
    assert _url(create_openai()) == DEFAULT_SPANLENS_OPENAI_PROXY


# ── Gemini ───────────────────────────────────────────────────────────────


def test_create_gemini_follows_spanlens_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    assert _url(create_gemini()) == DEFAULT_SPANLENS_GEMINI_PROXY
    monkeypatch.setenv("SPANLENS_BASE_URL", SELF_HOST)
    assert _url(create_gemini()) == f"{SELF_HOST}/proxy/gemini"
    assert _url(create_gemini(base_url="https://explicit.test")) == "https://explicit.test"


def test_configure_gemini_follows_spanlens_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    fake_genai = types.ModuleType("google.generativeai")
    fake_genai.configure = lambda **kwargs: captured.update(kwargs)  # type: ignore[attr-defined]
    fake_google = types.ModuleType("google")
    fake_google.generativeai = fake_genai  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setitem(sys.modules, "google.generativeai", fake_genai)

    monkeypatch.setenv("SPANLENS_BASE_URL", SELF_HOST)
    configure_gemini()

    assert captured["client_options"]["api_endpoint"] == f"{SELF_HOST}/proxy/gemini"
    assert captured["transport"] == "rest"


# ── Ingest client ────────────────────────────────────────────────────────


def test_spanlens_client_ingest_follows_spanlens_base_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SPANLENS_BASE_URL", f"{SELF_HOST}/")
    client = SpanlensClient(api_key=KEY)
    try:
        assert client._transport._base_url == SELF_HOST
    finally:
        client.close()

    explicit = SpanlensClient(api_key=KEY, base_url="https://explicit.test")
    try:
        assert explicit._transport._base_url == "https://explicit.test"
    finally:
        explicit.close()


# ── CLI round trip ───────────────────────────────────────────────────────


def test_value_written_by_cli_routes_patched_code_to_the_self_hosted_server(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def fake_key_info(api_key: str, api_base: str, **_kw: object) -> KeyInfo:
        assert api_base == SELF_HOST
        return KeyInfo(project_id="p", project_name="Demo", providers=["openai"], scope="full")

    monkeypatch.setattr(cli_main, "fetch_key_info", fake_key_info)
    (tmp_path / "requirements.txt").write_text("openai>=1.0\nspanlens\n", encoding="utf-8")
    (tmp_path / "agent.py").write_text(
        "from openai import OpenAI\nc = OpenAI(api_key='k')\n", encoding="utf-8"
    )
    monkeypatch.chdir(tmp_path)

    code = cli_main.main(
        ["init", "--yes", "--api-key", KEY, "--server-url", f"{SELF_HOST}/"]
    )
    assert code == 0

    written = read_env_var(str(tmp_path), ".env", "SPANLENS_BASE_URL")
    assert written == SELF_HOST
    # The next steps tell the user to ship the variable with the app.
    assert "SPANLENS_BASE_URL" in capsys.readouterr().out

    # What the patched code does once the app loads that .env value.
    monkeypatch.setenv("SPANLENS_BASE_URL", written)
    assert "c = create_openai()" in (tmp_path / "agent.py").read_text(encoding="utf-8")
    assert _url(create_openai()) == f"{SELF_HOST}/proxy/openai/v1"
