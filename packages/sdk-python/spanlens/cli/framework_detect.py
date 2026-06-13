"""Detect the Python project layout and which LLM libraries it already uses.

Unlike the Node CLI (Next.js-centric), Python projects vary widely in their
package manager and manifest. We sniff the common ones and, crucially, figure
out which provider SDKs (``openai`` / ``anthropic`` / ``google-generativeai``)
are declared so the wizard can suggest the right integrations even before the
Spanlens key tells us which provider keys are registered.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import List, Optional

try:  # Python 3.11+ ships tomllib; older versions degrade to a regex sniff.
    import tomllib  # type: ignore[import-not-found]
except ModuleNotFoundError:  # pragma: no cover - exercised on <3.11 only
    tomllib = None


# Maps the Spanlens provider name to the PyPI distribution names that imply it.
PROVIDER_LIBRARIES = {
    "openai": ("openai",),
    "anthropic": ("anthropic",),
    "gemini": ("google-generativeai", "google-genai"),
}


@dataclass(frozen=True)
class ProjectInfo:
    """Everything the wizard learned by looking at the filesystem."""

    package_manager: str  # 'poetry' | 'uv' | 'pipenv' | 'pip' | 'unknown'
    manifest: Optional[str]  # the file we read deps from, if any
    env_file: str  # preferred env file to write to (always '.env' for Python)
    detected_providers: List[str] = field(default_factory=list)


def detect_project(cwd: Optional[str] = None) -> ProjectInfo:
    root = cwd or os.getcwd()

    pm, manifest = _detect_package_manager(root)
    providers = _detect_providers(root)

    return ProjectInfo(
        package_manager=pm,
        manifest=manifest,
        env_file=".env",
        detected_providers=providers,
    )


def _exists(root: str, name: str) -> bool:
    return os.path.isfile(os.path.join(root, name))


def _detect_package_manager(root: str) -> tuple[str, Optional[str]]:
    """Lockfiles are the most reliable signal; fall back to manifests."""
    if _exists(root, "poetry.lock"):
        return "poetry", "pyproject.toml"
    if _exists(root, "uv.lock"):
        return "uv", "pyproject.toml"
    if _exists(root, "Pipfile.lock") or _exists(root, "Pipfile"):
        return "pipenv", "Pipfile"

    if _exists(root, "pyproject.toml"):
        # A pyproject with [tool.poetry] means poetry even without a lockfile.
        text = _read(os.path.join(root, "pyproject.toml"))
        if text and "[tool.poetry]" in text:
            return "poetry", "pyproject.toml"
        return "pip", "pyproject.toml"

    if _exists(root, "requirements.txt"):
        return "pip", "requirements.txt"

    return "unknown", None


def _read(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def _detect_providers(root: str) -> List[str]:
    """Collect declared dependencies across every manifest we can find, then
    map distribution names back to Spanlens provider names."""
    declared = set()

    declared |= _deps_from_pyproject(os.path.join(root, "pyproject.toml"))
    declared |= _deps_from_requirements(os.path.join(root, "requirements.txt"))
    declared |= _deps_from_pipfile(os.path.join(root, "Pipfile"))

    found: List[str] = []
    for provider, dists in PROVIDER_LIBRARIES.items():
        if any(_normalize(d) in declared for d in dists):
            found.append(provider)
    return found


def _normalize(name: str) -> str:
    # PEP 503 normalization so 'Google-GenerativeAI' == 'google-generativeai'.
    return re.sub(r"[-_.]+", "-", name).strip().lower()


def _deps_from_pyproject(path: str) -> set[str]:
    text = _read(path)
    if text is None:
        return set()

    names: set[str] = set()
    if tomllib is not None:
        try:
            data = tomllib.loads(text)
        except Exception:
            data = {}
        # PEP 621 [project].dependencies + optional-dependencies
        project = data.get("project", {}) if isinstance(data, dict) else {}
        for spec in project.get("dependencies", []) or []:
            names.add(_dist_from_spec(spec))
        for group in (project.get("optional-dependencies", {}) or {}).values():
            for spec in group or []:
                names.add(_dist_from_spec(spec))
        # Poetry [tool.poetry.dependencies] is a table keyed by dist name.
        poetry = (
            data.get("tool", {}).get("poetry", {}) if isinstance(data, dict) else {}
        )
        for key in (poetry.get("dependencies", {}) or {}):
            names.add(_normalize(key))
        for group in (poetry.get("group", {}) or {}).values():
            for key in (group.get("dependencies", {}) or {}):
                names.add(_normalize(key))
    else:  # pragma: no cover - <3.11 fallback
        for spec in re.findall(r'"([A-Za-z0-9._-]+(?:\[[^\]]*\])?[^"]*)"', text):
            names.add(_dist_from_spec(spec))

    names.discard("")
    return names


def _deps_from_requirements(path: str) -> set[str]:
    text = _read(path)
    if text is None:
        return set()
    names: set[str] = set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        names.add(_dist_from_spec(line))
    names.discard("")
    return names


def _deps_from_pipfile(path: str) -> set[str]:
    text = _read(path)
    if text is None:
        return set()
    # Pipfile is TOML but commonly read loosely; grab the bare package names
    # under [packages] / [dev-packages] via a simple key sniff.
    names: set[str] = set()
    for match in re.finditer(r'^\s*"?([A-Za-z0-9._-]+)"?\s*=', text, re.MULTILINE):
        names.add(_normalize(match.group(1)))
    names.discard("")
    return names


def _dist_from_spec(spec: str) -> str:
    """Extract the distribution name from a PEP 508 requirement string.

    ``openai>=1.0.0`` → ``openai``; ``spanlens[openai]`` → ``spanlens``.
    """
    spec = spec.strip()
    # Cut at the first version / marker / extras delimiter.
    name = re.split(r"[\s<>=!~\[;@(]", spec, maxsplit=1)[0]
    return _normalize(name)


__all__ = ["PROVIDER_LIBRARIES", "ProjectInfo", "detect_project"]
