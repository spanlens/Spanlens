"""Project + provider detection across the common Python manifests."""

from pathlib import Path

from spanlens.cli.framework_detect import detect_project


def test_unknown_when_empty(tmp_path: Path) -> None:
    info = detect_project(str(tmp_path))
    assert info.package_manager == "unknown"
    assert info.manifest is None
    assert info.env_file == ".env"
    assert info.detected_providers == []


def test_poetry_via_lockfile(tmp_path: Path) -> None:
    (tmp_path / "poetry.lock").write_text("", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text("[tool.poetry]\nname='x'\n", encoding="utf-8")
    assert detect_project(str(tmp_path)).package_manager == "poetry"


def test_uv_via_lockfile(tmp_path: Path) -> None:
    (tmp_path / "uv.lock").write_text("", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n", encoding="utf-8")
    assert detect_project(str(tmp_path)).package_manager == "uv"


def test_pipenv_via_pipfile(tmp_path: Path) -> None:
    (tmp_path / "Pipfile").write_text("[packages]\nopenai = '*'\n", encoding="utf-8")
    info = detect_project(str(tmp_path))
    assert info.package_manager == "pipenv"
    assert "openai" in info.detected_providers


def test_pip_via_requirements(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text(
        "openai>=1.0.0\nanthropic==0.30.0\n# comment\n-r other.txt\n", encoding="utf-8"
    )
    info = detect_project(str(tmp_path))
    assert info.package_manager == "pip"
    assert set(info.detected_providers) == {"openai", "anthropic"}


def test_pep621_dependencies_and_extras(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        """
[project]
name = "demo"
dependencies = ["openai>=1.0.0", "httpx"]

[project.optional-dependencies]
ai = ["google-generativeai>=0.5.0"]
""",
        encoding="utf-8",
    )
    info = detect_project(str(tmp_path))
    assert set(info.detected_providers) == {"openai", "gemini"}


def test_poetry_table_dependencies(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text(
        """
[tool.poetry]
name = "demo"

[tool.poetry.dependencies]
python = "^3.11"
anthropic = "^0.30"
""",
        encoding="utf-8",
    )
    info = detect_project(str(tmp_path))
    assert info.package_manager == "poetry"
    assert "anthropic" in info.detected_providers


def test_gemini_normalization(tmp_path: Path) -> None:
    # PEP 503 normalization: Google_Generativeai == google-generativeai
    (tmp_path / "requirements.txt").write_text("Google_Generativeai==0.8\n", encoding="utf-8")
    assert "gemini" in detect_project(str(tmp_path)).detected_providers
