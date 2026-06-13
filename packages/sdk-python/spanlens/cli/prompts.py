"""Interactive prompt helpers, a stdlib-only stand-in for @clack/prompts.

Everything degrades gracefully when stdin is not a TTY (CI, piped input):
``confirm`` returns its default and ``password`` raises ``NonInteractive`` so
the caller can fall back to a flag / env var instead of hanging on ``input()``.
"""

from __future__ import annotations

import getpass
import sys
from typing import Callable, Optional

from . import colors as c

_BAR = c.dim("│")


class PromptCancelledError(Exception):
    """Raised when the user aborts a prompt (Ctrl-C / Ctrl-D)."""


class NonInteractiveError(Exception):
    """Raised when a value is required but no TTY is available to ask for it."""


def stdin_is_tty() -> bool:
    try:
        return sys.stdin.isatty()
    except Exception:
        return False


def intro(title: str) -> None:
    print()
    print(f"{c.dim('┌')}  {title}")


def outro(message: str) -> None:
    print(f"{c.dim('└')}  {message}")
    print()


def step(message: str) -> None:
    print(f"{c.cyan('◇')}  {message}")


def success(message: str) -> None:
    print(f"{c.green('✓')}  {message}")


def warn(message: str) -> None:
    print(f"{c.yellow('▲')}  {message}")


def error(message: str) -> None:
    print(f"{c.red('■')}  {message}")


def message(text: str = "") -> None:
    if text == "":
        print(_BAR)
    else:
        print(f"{_BAR}  {text}")


def note(body: str, title: str = "") -> None:
    print(_BAR)
    if title:
        print(f"{c.dim('├')}  {c.bold(title)}")
    for line in body.split("\n"):
        print(f"{_BAR}  {line}")
    print(_BAR)


def cancel(message_text: str) -> None:
    print(f"{c.red('■')}  {message_text}")


def confirm(prompt: str, *, default: bool = True, assume_yes: bool = False) -> bool:
    """Yes/No prompt. Returns ``default`` for non-interactive / ``assume_yes``."""
    if assume_yes:
        return True
    if not stdin_is_tty():
        return default
    suffix = c.dim("(Y/n)") if default else c.dim("(y/N)")
    try:
        raw = input(f"{c.cyan('◆')}  {prompt} {suffix} ").strip().lower()
    except (EOFError, KeyboardInterrupt) as exc:
        raise PromptCancelledError() from exc
    if raw == "":
        return default
    return raw in ("y", "yes")


def password(prompt: str, *, validate: Optional[Callable[[str], Optional[str]]] = None) -> str:
    """Masked input. Raises ``NonInteractive`` when there is no TTY."""
    if not stdin_is_tty():
        raise NonInteractiveError(
            "No interactive terminal. Pass --api-key or set SPANLENS_API_KEY."
        )
    while True:
        try:
            value = getpass.getpass(f"{c.cyan('◆')}  {prompt}: ").strip()
        except (EOFError, KeyboardInterrupt) as exc:
            raise PromptCancelledError() from exc
        if validate is not None:
            problem = validate(value)
            if problem is not None:
                error(problem)
                continue
        return value


class Spinner:
    """Minimal start/stop status line. No animation, CI-log friendly."""

    def start(self, label: str) -> None:
        print(f"{c.cyan('○')}  {label}{c.dim(' …')}")

    def stop(self, label: str) -> None:
        print(f"{c.green('●')}  {label}")


def spinner() -> Spinner:
    return Spinner()


__all__ = [
    "PromptCancelledError",
    "NonInteractiveError",
    "Spinner",
    "cancel",
    "confirm",
    "error",
    "intro",
    "message",
    "note",
    "outro",
    "password",
    "spinner",
    "stdin_is_tty",
    "step",
    "success",
    "warn",
]
