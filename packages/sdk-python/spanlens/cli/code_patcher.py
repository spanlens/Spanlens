"""AST-based patcher that routes direct LLM SDK usage through Spanlens.

Python counterpart of ``packages/cli/src/code-patcher.ts``. We detect usage
with the standard-library :mod:`ast` (precise, no third-party parser) and then
splice targeted edits into the original source by byte offset, so formatting,
comments, and unrelated code are left untouched.

Supported rewrites::

    from openai import OpenAI                 from spanlens.integrations.openai import create_openai
    client = OpenAI(api_key=KEY)        →     client = create_openai()

    from anthropic import AsyncAnthropic      from spanlens.integrations.anthropic import create_async_anthropic
    client = AsyncAnthropic()           →     client = create_async_anthropic()

    import google.generativeai as genai       import google.generativeai as genai
    genai.configure(api_key=KEY)        →     from spanlens.integrations.gemini import configure_gemini
                                              configure_gemini()

Scope (MVP, matching the Node CLI): top-level ``from X import Name`` /
``import X`` plus their call sites. Dynamic imports and re-exports are not
rewritten. The patch is always *additive-safe*. A patched file still imports
and runs even in the rare shapes we leave for the user to finish by hand.
"""

from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# api_key / base_url are supplied by the Spanlens factory from the environment,
# so we strip them from the original constructor call.
_STRIP_KWARGS = frozenset({"api_key", "base_url"})


@dataclass(frozen=True)
class ProviderSpec:
    provider: str
    module: str
    classes: Dict[str, str]  # original class name → Spanlens factory name
    spanlens_module: str


CONSTRUCTOR_SPECS: Dict[str, ProviderSpec] = {
    "openai": ProviderSpec(
        provider="openai",
        module="openai",
        classes={"OpenAI": "create_openai", "AsyncOpenAI": "create_async_openai"},
        spanlens_module="spanlens.integrations.openai",
    ),
    "anthropic": ProviderSpec(
        provider="anthropic",
        module="anthropic",
        classes={
            "Anthropic": "create_anthropic",
            "AsyncAnthropic": "create_async_anthropic",
        },
        spanlens_module="spanlens.integrations.anthropic",
    ),
}

_GEMINI_MODULE = "google.generativeai"
_GEMINI_SPANLENS_IMPORT = "from spanlens.integrations.gemini import configure_gemini"

_EXCLUDE_DIRS = frozenset(
    {
        ".venv",
        "venv",
        "env",
        ".env",
        ".git",
        "__pycache__",
        "node_modules",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "build",
        "dist",
        ".tox",
        ".eggs",
        "site-packages",
    }
)


@dataclass(frozen=True)
class PatchPlan:
    filepath: str
    provider: str
    changes: List[str] = field(default_factory=list)


@dataclass(frozen=True)
class PatchResult:
    filepath: str
    provider: str
    patched: bool
    reason: Optional[str] = None


# ── source-editing primitives ────────────────────────────────────────


def _byte_line_starts(encoded: bytes) -> List[int]:
    starts = [0]
    for i, byte in enumerate(encoded):
        if byte == 0x0A:  # newline
            starts.append(i + 1)
    return starts


def _pos_to_byte(line_starts: List[int], lineno: int, col_offset: int) -> int:
    # ast col_offset is a UTF-8 byte offset within the line (CPython semantics).
    return line_starts[lineno - 1] + col_offset


def _node_span(line_starts: List[int], node: ast.AST) -> Tuple[int, int]:
    start = _pos_to_byte(line_starts, node.lineno, node.col_offset)  # type: ignore[attr-defined]
    end = _pos_to_byte(line_starts, node.end_lineno, node.end_col_offset)  # type: ignore[attr-defined]
    return start, end


def _apply_edits(src: str, edits: List[Tuple[int, int, str]]) -> str:
    """Apply (start_byte, end_byte, replacement) edits bottom-up on UTF-8 bytes."""
    encoded = bytearray(src.encode("utf-8"))
    for start, end, replacement in sorted(edits, key=lambda e: e[0], reverse=True):
        encoded[start:end] = replacement.encode("utf-8")
    return encoded.decode("utf-8")


def _segment(src: str, node: ast.AST) -> str:
    seg = ast.get_source_segment(src, node)
    return seg if seg is not None else ""


def _render_kept_args(src: str, call: ast.Call) -> str:
    """Reconstruct a call's argument list minus api_key / base_url."""
    parts: List[str] = []
    for arg in call.args:
        if isinstance(arg, ast.Starred):
            parts.append(f"*{_segment(src, arg.value)}")
        else:
            parts.append(_segment(src, arg))
    for kw in call.keywords:
        if kw.arg is None:  # **kwargs
            parts.append(f"**{_segment(src, kw.value)}")
        elif kw.arg not in _STRIP_KWARGS:
            parts.append(f"{kw.arg}={_segment(src, kw.value)}")
    return ", ".join(parts)


# ── constructor providers (OpenAI / Anthropic) ───────────────────────


def _patch_constructor(src: str, spec: ProviderSpec) -> Tuple[Optional[str], List[str]]:
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None, []

    line_starts = _byte_line_starts(src.encode("utf-8"))

    # local class name → original class name (named imports)
    named_bindings: Dict[str, str] = {}
    named_import_nodes: List[ast.ImportFrom] = []
    # local module alias → True (module imports: `import openai` / `import openai as oai`)
    module_aliases: Dict[str, bool] = {}
    module_import_nodes: List[ast.Import] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == spec.module:
            for alias in node.names:
                if alias.name in spec.classes:
                    local = alias.asname or alias.name
                    named_bindings[local] = alias.name
                    if node not in named_import_nodes:
                        named_import_nodes.append(node)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == spec.module:
                    module_aliases[alias.asname or alias.name] = True
                    if node not in module_import_nodes:
                        module_import_nodes.append(node)

    if not named_bindings and not module_aliases:
        return None, []

    edits: List[Tuple[int, int, str]] = []
    used_factories: List[str] = []
    call_count = 0

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        class_name: Optional[str] = None
        if isinstance(func, ast.Name) and func.id in named_bindings:
            class_name = named_bindings[func.id]
        elif (
            isinstance(func, ast.Attribute)
            and isinstance(func.value, ast.Name)
            and func.value.id in module_aliases
            and func.attr in spec.classes
        ):
            class_name = func.attr
        if class_name is None:
            continue

        factory = spec.classes[class_name]
        if factory not in used_factories:
            used_factories.append(factory)
        kept = _render_kept_args(src, node)
        start, end = _node_span(line_starts, node)
        edits.append((start, end, f"{factory}({kept})"))
        call_count += 1

    if call_count == 0:
        return None, []

    changes: List[str] = []
    import_line = f"from {spec.spanlens_module} import {', '.join(used_factories)}"

    # Prefer replacing a named import that imports ONLY provider classes,
    # that yields the clean `from openai import OpenAI` → spanlens swap.
    replaced_import = False
    for node in named_import_nodes:
        only_provider = all(a.name in spec.classes for a in node.names)
        if only_provider and not replaced_import:
            start, end = _node_span(line_starts, node)
            edits.append((start, end, import_line))
            replaced_import = True
            changes.append(f"import: from {spec.module} → {import_line}")
            break

    if not replaced_import:
        # Insert the Spanlens import right after the first provider import we saw.
        anchor: Optional[ast.AST] = (
            named_import_nodes[0]
            if named_import_nodes
            else (module_import_nodes[0] if module_import_nodes else None)
        )
        if anchor is not None:
            _, end = _node_span(line_starts, anchor)
            edits.append((end, end, f"\n{import_line}"))
            changes.append(f"add import: {import_line}")

    changes.append(
        f"{call_count} × constructor → {', '.join(sorted(used_factories))}(...)"
    )
    return _apply_edits(src, edits), changes


# ── gemini (configure-call style) ────────────────────────────────────


def _patch_gemini(src: str) -> Tuple[Optional[str], List[str]]:
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None, []

    line_starts = _byte_line_starts(src.encode("utf-8"))

    module_aliases: Dict[str, bool] = {}
    import_nodes: List[ast.Import] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == _GEMINI_MODULE:
                    module_aliases[alias.asname or alias.name.split(".")[0]] = True
                    if node not in import_nodes:
                        import_nodes.append(node)

    if not module_aliases:
        return None, []

    edits: List[Tuple[int, int, str]] = []
    call_count = 0
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "configure"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id in module_aliases
        ):
            start, end = _node_span(line_starts, node)
            edits.append((start, end, "configure_gemini()"))
            call_count += 1

    if call_count == 0:
        return None, []

    _, end = _node_span(line_starts, import_nodes[0])
    edits.append((end, end, f"\n{_GEMINI_SPANLENS_IMPORT}"))

    changes = [
        f"add import: {_GEMINI_SPANLENS_IMPORT}",
        f"{call_count} × genai.configure(...) → configure_gemini()",
    ]
    return _apply_edits(src, edits), changes


def _patch_source(src: str, provider: str) -> Tuple[Optional[str], List[str]]:
    if provider == "gemini":
        return _patch_gemini(src)
    spec = CONSTRUCTOR_SPECS.get(provider)
    if spec is None:
        return None, []
    return _patch_constructor(src, spec)


# ── filesystem scanning ──────────────────────────────────────────────


def _candidate_files(root: str) -> List[str]:
    out: List[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _EXCLUDE_DIRS]
        for name in filenames:
            if name.endswith(".py"):
                out.append(os.path.join(dirpath, name))
    return out


def _prefilter(text: str, provider: str) -> bool:
    if provider == "gemini":
        return _GEMINI_MODULE in text and "configure" in text
    spec = CONSTRUCTOR_SPECS.get(provider)
    if spec is None:
        return False
    return spec.module in text and any(cls in text for cls in spec.classes)


def plan_patches(cwd: str, providers: List[str]) -> List[PatchPlan]:
    plans: List[PatchPlan] = []
    supported = [p for p in providers if p == "gemini" or p in CONSTRUCTOR_SPECS]
    if not supported:
        return plans

    for filepath in _candidate_files(cwd):
        try:
            with open(filepath, encoding="utf-8") as fh:
                src = fh.read()
        except (OSError, UnicodeDecodeError):
            continue
        for provider in supported:
            if not _prefilter(src, provider):
                continue
            new_src, changes = _patch_source(src, provider)
            if new_src is not None and changes:
                plans.append(PatchPlan(filepath=filepath, provider=provider, changes=changes))
    return plans


def apply_patches(plans: List[PatchPlan], *, dry_run: bool = False) -> List[PatchResult]:
    results: List[PatchResult] = []
    for plan in plans:
        try:
            with open(plan.filepath, encoding="utf-8") as fh:
                src = fh.read()
        except (OSError, UnicodeDecodeError) as exc:
            results.append(
                PatchResult(plan.filepath, plan.provider, patched=False, reason=str(exc))
            )
            continue
        new_src, _changes = _patch_source(src, plan.provider)
        if new_src is None or new_src == src:
            results.append(
                PatchResult(plan.filepath, plan.provider, patched=False, reason="no change")
            )
            continue
        if not dry_run:
            with open(plan.filepath, "w", encoding="utf-8") as fh:
                fh.write(new_src)
        results.append(PatchResult(plan.filepath, plan.provider, patched=True))
    return results


__all__ = [
    "CONSTRUCTOR_SPECS",
    "PatchPlan",
    "PatchResult",
    "ProviderSpec",
    "apply_patches",
    "plan_patches",
]
