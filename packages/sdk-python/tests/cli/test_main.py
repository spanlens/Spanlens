"""End-to-end wizard smoke tests in non-interactive (--yes --dry-run) mode."""

from pathlib import Path

import pytest

import spanlens.cli.main as cli_main
from spanlens.cli.key_info import KeyInfo


@pytest.fixture
def fake_key_info(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake(api_key: str, api_base: str, **_kw: object) -> KeyInfo:
        return KeyInfo(
            project_id="p_1",
            project_name="Demo",
            providers=["openai"],
            scope="full",
        )

    monkeypatch.setattr(cli_main, "fetch_key_info", _fake)


def test_init_dry_run_writes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fake_key_info: None
) -> None:
    (tmp_path / "requirements.txt").write_text("openai>=1.0\n", encoding="utf-8")
    (tmp_path / "agent.py").write_text(
        "from openai import OpenAI\nc = OpenAI(api_key='k')\n", encoding="utf-8"
    )
    monkeypatch.chdir(tmp_path)

    code = cli_main.main(["init", "--yes", "--dry-run", "--api-key", "sl_live_" + "a" * 20])
    assert code == 0
    # dry run: no .env created, source untouched
    assert not (tmp_path / ".env").exists()
    assert "OpenAI(api_key='k')" in (tmp_path / "agent.py").read_text(encoding="utf-8")


def test_init_real_run_writes_env_and_patches(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fake_key_info: None
) -> None:
    (tmp_path / "requirements.txt").write_text("openai>=1.0\nspanlens\n", encoding="utf-8")
    (tmp_path / "agent.py").write_text(
        "from openai import OpenAI\nc = OpenAI(api_key='k')\n", encoding="utf-8"
    )
    monkeypatch.chdir(tmp_path)

    # spanlens already declared → install step is skipped (no subprocess).
    code = cli_main.main(["init", "--yes", "--api-key", "sl_live_" + "b" * 20])
    assert code == 0
    assert (tmp_path / ".env").read_text(encoding="utf-8").count("SPANLENS_API_KEY=") == 1
    assert "c = create_openai()" in (tmp_path / "agent.py").read_text(encoding="utf-8")


def test_bad_key_format_exits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit):
        cli_main.main(["init", "--yes", "--api-key", "not-a-key"])


def test_test_subcommand(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fake_key_info: None) -> None:
    monkeypatch.chdir(tmp_path)
    code = cli_main.main(["test", "--api-key", "sl_live_" + "c" * 20])
    assert code == 0


def test_bare_invocation_defaults_to_init(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fake_key_info: None
) -> None:
    monkeypatch.chdir(tmp_path)
    # No subcommand, just flags → should run init.
    code = cli_main.main(["--yes", "--dry-run", "--api-key", "sl_live_" + "d" * 20])
    assert code == 0


def test_version_flag_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        cli_main.main(["--version"])
    assert exc.value.code == 0
    assert "spanlens" in capsys.readouterr().out
