"""Env-file upsert mirrors packages/cli/src/env-writer.ts behavior."""

from pathlib import Path

from spanlens.cli.env_writer import read_env_var, upsert_env_var


def test_creates_file_when_missing(tmp_path: Path) -> None:
    result = upsert_env_var(str(tmp_path), ".env", "SPANLENS_API_KEY", "sl_live_abc")
    assert result.created is True
    assert result.changed is True
    assert (tmp_path / ".env").read_text(encoding="utf-8") == "SPANLENS_API_KEY=sl_live_abc\n"


def test_appends_preserving_existing_lines(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("# my config\nOPENAI_API_KEY=sk-123\n", encoding="utf-8")
    result = upsert_env_var(str(tmp_path), ".env", "SPANLENS_API_KEY", "sl_live_abc")
    assert result.created is False
    assert result.changed is True
    text = env.read_text(encoding="utf-8")
    assert "# my config" in text
    assert "OPENAI_API_KEY=sk-123" in text
    assert "SPANLENS_API_KEY=sl_live_abc" in text


def test_replaces_existing_key_in_place(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("SPANLENS_API_KEY=old\nFOO=bar\n", encoding="utf-8")
    result = upsert_env_var(str(tmp_path), ".env", "SPANLENS_API_KEY", "new")
    assert result.changed is True
    text = env.read_text(encoding="utf-8")
    assert "SPANLENS_API_KEY=new" in text
    assert "SPANLENS_API_KEY=old" not in text
    assert "FOO=bar" in text


def test_idempotent_when_value_unchanged(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("SPANLENS_API_KEY=same\n", encoding="utf-8")
    result = upsert_env_var(str(tmp_path), ".env", "SPANLENS_API_KEY", "same")
    assert result.changed is False
    assert result.created is False


def test_read_env_var(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text("SPANLENS_API_KEY= sl_live_xyz \nA=1\n", encoding="utf-8")
    assert read_env_var(str(tmp_path), ".env", "SPANLENS_API_KEY") == "sl_live_xyz"
    assert read_env_var(str(tmp_path), ".env", "MISSING") is None
    assert read_env_var(str(tmp_path), "nope.env", "SPANLENS_API_KEY") is None
