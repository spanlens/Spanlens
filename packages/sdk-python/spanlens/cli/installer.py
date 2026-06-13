"""Install the ``spanlens`` provider extras into the user's project.

The ``spanlens`` distribution is the SDK *and* this CLI, so the user already
has it on their machine to run ``spanlens init``. What this step does is make
it a declared dependency of their project and pull the right provider extras
(``spanlens[openai]`` etc.) using whichever package manager they use.
"""

from __future__ import annotations

import os
import re
import subprocess  # noqa: S404 - we build argv lists ourselves, never shell strings
import sys
from dataclasses import dataclass
from typing import List, Optional, Sequence

# Spanlens provider name → extras key in pyproject [project.optional-dependencies].
PROVIDER_EXTRAS = {
    "openai": "openai",
    "anthropic": "anthropic",
    "gemini": "gemini",
}


@dataclass(frozen=True)
class InstallResult:
    ok: bool
    command: str
    error: Optional[str] = None


def install_target(providers: Sequence[str]) -> str:
    """Build the pip-style requirement, e.g. ``spanlens[openai,anthropic]``."""
    extras = sorted(
        {PROVIDER_EXTRAS[p] for p in providers if p in PROVIDER_EXTRAS}
    )
    if not extras:
        return "spanlens"
    return f"spanlens[{','.join(extras)}]"


def _install_argv(package_manager: str, target: str) -> List[str]:
    if package_manager == "poetry":
        return ["poetry", "add", target]
    if package_manager == "uv":
        return ["uv", "add", target]
    if package_manager == "pipenv":
        return ["pipenv", "install", target]
    # pip (and 'unknown') uses the active interpreter so we install into the
    # same environment the CLI is running from.
    return [sys.executable, "-m", "pip", "install", target]


def install_spanlens(
    cwd: str,
    package_manager: str,
    providers: Sequence[str],
    *,
    dry_run: bool = False,
    timeout: int = 300,
) -> InstallResult:
    target = install_target(providers)
    argv = _install_argv(package_manager, target)
    command = " ".join(argv if argv[0] != sys.executable else ["python", "-m", "pip", "install", target])

    if dry_run:
        return InstallResult(ok=True, command=command)

    try:
        proc = subprocess.run(  # noqa: S603 - argv is a fixed list, no shell
            argv,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        return InstallResult(
            ok=False,
            command=command,
            error=f"{package_manager} not found on PATH",
        )
    except subprocess.TimeoutExpired:
        return InstallResult(ok=False, command=command, error="install timed out")

    if proc.returncode == 0:
        return InstallResult(ok=True, command=command)

    detail = (proc.stderr or proc.stdout or "").strip()
    return InstallResult(
        ok=False,
        command=command,
        error=f"exited with code {proc.returncode}{f': {detail[:200]}' if detail else ''}",
    )


def is_spanlens_declared(cwd: str) -> bool:
    """Best-effort check for an existing ``spanlens`` dependency in a manifest."""
    for manifest in ("pyproject.toml", "requirements.txt", "Pipfile"):
        path = os.path.join(cwd, manifest)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            continue
        # Match the package name as a token, not a substring of another word.
        if re.search(r"(?<![\w-])spanlens(?![\w-])", text):
            return True
    return False


__all__ = [
    "PROVIDER_EXTRAS",
    "InstallResult",
    "install_spanlens",
    "install_target",
    "is_spanlens_declared",
]
