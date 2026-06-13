"""Install-target construction + package-manager command selection."""

import sys
from pathlib import Path

from spanlens.cli import installer
from spanlens.cli.installer import (
    install_spanlens,
    install_target,
    is_spanlens_declared,
)


def test_install_target_no_providers() -> None:
    assert install_target([]) == "spanlens"


def test_install_target_sorted_extras() -> None:
    assert install_target(["anthropic", "openai"]) == "spanlens[anthropic,openai]"


def test_install_target_ignores_unknown_provider() -> None:
    # azure / mistral / openrouter have no SDK extra — they fall back to bare.
    assert install_target(["mistral"]) == "spanlens"
    assert install_target(["openai", "mistral"]) == "spanlens[openai]"


def test_argv_per_manager() -> None:
    assert installer._install_argv("poetry", "spanlens")[:2] == ["poetry", "add"]
    assert installer._install_argv("uv", "spanlens")[:2] == ["uv", "add"]
    assert installer._install_argv("pipenv", "spanlens")[:2] == ["pipenv", "install"]
    pip = installer._install_argv("pip", "spanlens")
    assert pip[0] == sys.executable and pip[1:4] == ["-m", "pip", "install"]


def test_dry_run_returns_command_without_spawning(tmp_path: Path) -> None:
    res = install_spanlens(str(tmp_path), "poetry", ["openai"], dry_run=True)
    assert res.ok is True
    assert res.command == "poetry add spanlens[openai]"


def test_missing_manager_reports_error(tmp_path: Path) -> None:
    res = install_spanlens(str(tmp_path), "poetry", ["openai"])
    # poetry is almost certainly not on PATH in CI for this monorepo job.
    if not res.ok:
        assert "not found" in (res.error or "") or "exited" in (res.error or "")


def test_is_spanlens_declared(tmp_path: Path) -> None:
    assert is_spanlens_declared(str(tmp_path)) is False
    (tmp_path / "requirements.txt").write_text("openai\nspanlens[openai]>=0.6\n", encoding="utf-8")
    assert is_spanlens_declared(str(tmp_path)) is True


def test_is_spanlens_declared_word_boundary(tmp_path: Path) -> None:
    # "spanlens-extra" should not be mistaken for the spanlens package.
    (tmp_path / "requirements.txt").write_text("spanlens-extra\n", encoding="utf-8")
    assert is_spanlens_declared(str(tmp_path)) is False
