"""Idempotently add or update a ``KEY=VALUE`` line in a ``.env`` file.

Mirrors ``packages/cli/src/env-writer.ts`` so the Python and Node wizards
behave identically:

  * Existing lines and comments are preserved.
  * If ``KEY`` already exists, its value is replaced in place.
  * If the file does not exist, it is created.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class UpsertResult:
    changed: bool
    created: bool
    existed: bool


def read_env_var(cwd: str, filename: str, key: str) -> Optional[str]:
    """Return the current value of ``key`` in the env file, or ``None``."""
    path = os.path.join(cwd, filename)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return None
    match = re.search(rf"^{re.escape(key)}\s*=\s*(.+)$", text, re.MULTILINE)
    return match.group(1).strip() if match else None


def upsert_env_var(cwd: str, filename: str, key: str, value: str) -> UpsertResult:
    path = os.path.join(cwd, filename)
    existed = os.path.isfile(path)
    existing = ""
    if existed:
        try:
            with open(path, encoding="utf-8") as fh:
                existing = fh.read()
        except OSError:
            existing = ""

    lines = existing.split("\n") if existing else []
    pattern = re.compile(rf"^{re.escape(key)}\s*=")
    found = False
    value_changed = False
    new_line = f"{key}={value}"

    updated = []
    for line in lines:
        if pattern.match(line):
            found = True
            if line != new_line:
                value_changed = True
            updated.append(new_line)
        else:
            updated.append(line)

    if not found:
        if updated and updated[-1] != "":
            updated.append("")
        updated.append(new_line)
        updated.append("")  # trailing newline

    next_text = "\n".join(updated)
    if next_text == existing:
        return UpsertResult(changed=False, created=False, existed=existed)

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(next_text)

    return UpsertResult(
        changed=value_changed if found else True,
        created=not existed,
        existed=existed,
    )


__all__ = ["UpsertResult", "read_env_var", "upsert_env_var"]
