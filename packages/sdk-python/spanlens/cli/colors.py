"""Tiny ANSI color helpers, a stdlib-only stand-in for picocolors.

Colors are disabled automatically when:

  * ``NO_COLOR`` is set (https://no-color.org/), or
  * ``stdout`` is not a TTY (piped / redirected / CI without a terminal).

Keeping this dependency-free matters: ``pip install spanlens`` should not pull
a color library just so the SDK is importable.
"""

from __future__ import annotations

import os
import sys

_RESET = "\033[0m"


def _enabled() -> bool:
    if os.environ.get("NO_COLOR") is not None:
        return False
    if os.environ.get("FORCE_COLOR") is not None:
        return True
    try:
        return sys.stdout.isatty()
    except Exception:
        return False


def _wrap(code: str, text: str) -> str:
    if not _enabled():
        return text
    return f"\033[{code}m{text}{_RESET}"


def bold(text: str) -> str:
    return _wrap("1", text)


def dim(text: str) -> str:
    return _wrap("2", text)


def underline(text: str) -> str:
    return _wrap("4", text)


def red(text: str) -> str:
    return _wrap("31", text)


def green(text: str) -> str:
    return _wrap("32", text)


def yellow(text: str) -> str:
    return _wrap("33", text)


def cyan(text: str) -> str:
    return _wrap("36", text)


__all__ = ["bold", "cyan", "dim", "green", "red", "underline", "yellow"]
