"""``spanlens`` command entry point. The onboarding wizard.

Usage::

    spanlens init [--dry-run] [--yes] [--api-key KEY] [--server-url URL]
    spanlens test [--api-key KEY] [--server-url URL]
    spanlens --version

``init`` is the default subcommand, so a bare ``spanlens`` runs the wizard.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import List, Optional

from . import colors as c
from . import prompts as p
from .code_patcher import apply_patches, plan_patches
from .env_writer import read_env_var, upsert_env_var
from .framework_detect import detect_project
from .installer import install_spanlens, is_spanlens_declared
from .key_info import KeyInfo, KeyInfoError, fetch_key_info

DEFAULT_DASHBOARD_URL = "https://www.spanlens.io"
# Providers the wizard can auto-patch (those with a dedicated SDK integration).
PATCHABLE_PROVIDERS = ("openai", "anthropic", "gemini")


def _force_utf8_output() -> None:
    """Make stdout/stderr accept UTF-8 so the box-drawing glyphs and emoji in
    the wizard do not crash on legacy Windows code pages (e.g. cp949). Falls
    back to ``errors='replace'`` so output degrades to '?' rather than raising.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):  # pragma: no cover - platform dependent
            pass


def _version() -> str:
    try:
        from spanlens import __version__

        return __version__
    except Exception:
        return "unknown"


def _resolve_bases(server_url: Optional[str]) -> tuple[str, str]:
    """Return (dashboard_url, api_base). ``--server-url`` overrides both."""
    if server_url:
        clean = server_url.rstrip("/")
        return clean, clean
    api_base = os.environ.get("SPANLENS_API_BASE", DEFAULT_DASHBOARD_URL).rstrip("/")
    return DEFAULT_DASHBOARD_URL, api_base


def _validate_key_format(value: str) -> Optional[str]:
    if not value or len(value) < 20:
        return "Looks too short. Copy the whole key."
    if not value.startswith("sl_live_") and not value.startswith("sl_test_"):
        return "Spanlens keys start with sl_live_ or sl_test_"
    return None


def _collect_key(args: argparse.Namespace) -> str:
    """Resolve the Spanlens key from --api-key, env, or an interactive prompt."""
    candidate = args.api_key or os.environ.get("SPANLENS_API_KEY")
    if candidate:
        problem = _validate_key_format(candidate)
        if problem:
            raise SystemExit(f"[spanlens] {problem}")
        return candidate
    return p.password(
        "Paste your Spanlens key (starts with sl_live_)",
        validate=_validate_key_format,
    )


def _print_key_summary(dashboard_url: str, info: KeyInfo) -> None:
    provider_text = ", ".join(info.providers) if info.providers else c.dim("(none registered)")
    project = info.project_name or c.dim("(workspace key)")
    p.success(f"Key valid · project {c.bold(project)} · providers: {provider_text}")

    if info.scope == "public":
        p.warn(
            "This is a public (read-only) key, so proxy calls return 403. "
            "Issue a full key (sl_live_, not sl_live_pub_) to log requests."
        )
    if not info.providers:
        p.warn("No active provider keys on this Spanlens key, so calls return 400 until you add one.")
        p.message(
            f"  Add one at {c.underline(dashboard_url + '/projects')} → your project → "
            '"Add provider key"'
        )


# ── subcommand: init ─────────────────────────────────────────────────


def _cmd_init(args: argparse.Namespace) -> int:
    dashboard_url, api_base = _resolve_bases(args.server_url)
    cwd = os.getcwd()

    p.intro(c.cyan("🔭  Spanlens setup"))

    # 1. project detection
    project = detect_project(cwd)
    if project.package_manager == "unknown":
        p.warn(f"No Python project manifest found in {c.dim(cwd)}")
        p.message("  Run this from your project root (where pyproject.toml / requirements.txt lives).")
        if not p.confirm("Continue anyway?", default=False, assume_yes=args.yes):
            p.cancel("Aborted.")
            return 0
    else:
        detected = (
            f" · uses {', '.join(project.detected_providers)}"
            if project.detected_providers
            else ""
        )
        p.success(f"Detected {c.bold(project.package_manager)} project{detected}")

    # 2. prerequisites
    p.message("")
    p.step(c.bold("Before continuing, make sure you have:"))
    p.message(f"  1. A Spanlens account at {c.underline(dashboard_url)}")
    p.message(f"  2. A Project at {c.underline(dashboard_url + '/projects')}")
    p.message("  3. Provider keys (OpenAI / Anthropic / Gemini) added to that project")
    p.message("  4. A Spanlens key issued for that project (sl_live_…)")
    p.message("")
    if not p.confirm("Ready?", default=True, assume_yes=args.yes):
        p.cancel("Aborted. Come back after setting up the dashboard.")
        return 0

    # 3. collect + validate key
    try:
        api_key = _collect_key(args)
    except p.NonInteractiveError as exc:
        p.error(str(exc))
        return 1

    s = p.spinner()
    s.start("Validating key with Spanlens")
    try:
        info = fetch_key_info(api_key, api_base)
    except KeyInfoError as exc:
        s.stop(c.red("Key validation failed"))
        p.error(str(exc))
        return 1
    s.stop("Key validated")
    _print_key_summary(dashboard_url, info)

    # 4. write .env (overwrite confirm)
    existing = read_env_var(cwd, project.env_file, "SPANLENS_API_KEY")
    if existing and existing != api_key:
        masked = f"{existing[:12]}…{existing[-4:]}" if len(existing) > 16 else "••••"
        if not p.confirm(
            f"{project.env_file} already has SPANLENS_API_KEY={masked}. Replace it?",
            default=False,
            assume_yes=args.yes,
        ):
            p.cancel("Kept existing key. Re-run when ready.")
            return 0

    s = p.spinner()
    s.start(f"Updating {project.env_file}")
    if args.dry_run:
        s.stop(f"[dry-run] would write SPANLENS_API_KEY to {project.env_file}")
    else:
        result = upsert_env_var(cwd, project.env_file, "SPANLENS_API_KEY", api_key)
        if args.server_url:
            upsert_env_var(cwd, project.env_file, "SPANLENS_BASE_URL", args.server_url.rstrip("/"))
        if result.created:
            s.stop(f"Created {project.env_file} with SPANLENS_API_KEY")
        elif result.changed:
            s.stop(f"Updated SPANLENS_API_KEY in {project.env_file}")
        else:
            s.stop(f"SPANLENS_API_KEY already up to date in {project.env_file}")

    # 5. install spanlens extras
    install_providers = info.providers or list(project.detected_providers)
    if is_spanlens_declared(cwd):
        p.success("spanlens already in project dependencies")
    elif p.confirm(
        f"Install spanlens via {c.cyan(project.package_manager)} now?",
        default=True,
        assume_yes=args.yes,
    ):
        s = p.spinner()
        s.start(f"Installing spanlens with {project.package_manager}")
        res = install_spanlens(
            cwd, project.package_manager, install_providers, dry_run=args.dry_run
        )
        if res.ok:
            s.stop(
                f"[dry-run] would run: {c.cyan(res.command)}"
                if args.dry_run
                else f"Installed ({res.command})"
            )
        else:
            s.stop(c.yellow("Could not auto-install. Run this manually:"))
            p.message(f"  {c.cyan(res.command)}")
            if res.error:
                p.message(c.dim(f"  ({res.error})"))
    else:
        p.warn("Skipped install. Run it manually before deploying.")

    # 6. scan + patch
    patch_targets = [pr for pr in install_providers if pr in PATCHABLE_PROVIDERS]
    s = p.spinner()
    s.start("Scanning your code for provider usage")
    plans = plan_patches(cwd, patch_targets)
    s.stop(f"Found {len(plans)} patch{'' if len(plans) == 1 else 'es'} to apply")

    if not plans:
        rel = c.dim("from spanlens.integrations.openai import create_openai")
        p.message(c.dim(f"No matching client construction found. Add manually, e.g.:\n  {rel}"))
    else:
        for plan in plans:
            p.message(f"  {c.cyan('•')} [{plan.provider}] {c.dim(os.path.relpath(plan.filepath, cwd))}")
            for change in plan.changes:
                p.message(f"      {c.dim('→')} {change}")
        verb = "Show patch preview?" if args.dry_run else "Apply these changes?"
        if p.confirm(verb, default=True, assume_yes=args.yes):
            s = p.spinner()
            s.start("Dry-run patch" if args.dry_run else "Patching files")
            results = apply_patches(plans, dry_run=args.dry_run)
            patched = sum(1 for r in results if r.patched)
            s.stop(
                f"[dry-run] would patch {patched} file(s)"
                if args.dry_run
                else f"Patched {patched} file(s)"
            )
        else:
            p.warn("Code patch skipped. You can re-run the wizard anytime.")

    # 7. next steps
    p.note(
        "\n".join(
            [
                f"{c.bold('1.')} Add {c.cyan('SPANLENS_API_KEY')} to your deployment environment",
                f"     {c.dim('(your host → Settings → Environment Variables)')}",
                "",
                f"{c.bold('2.')} Redeploy your app",
                "",
                f"{c.bold('3.')} Your requests will show up at:",
                f"     {c.underline(dashboard_url + '/requests')}",
            ]
        ),
        "Next steps",
    )

    p.message("")
    p.message(
        f"{c.yellow('★')}  Star Spanlens on GitHub:  "
        f"{c.underline('https://github.com/spanlens/Spanlens?utm_source=cli_init')}"
    )
    p.message(c.dim("   Read the docs:           https://spanlens.io/docs"))
    p.outro(c.green("🎉 Spanlens setup complete"))
    return 0


# ── subcommand: test ─────────────────────────────────────────────────


def _cmd_test(args: argparse.Namespace) -> int:
    dashboard_url, api_base = _resolve_bases(args.server_url)
    p.intro(c.cyan("🔭  Spanlens connection test"))
    try:
        api_key = _collect_key(args)
    except p.NonInteractiveError as exc:
        p.error(str(exc))
        return 1

    s = p.spinner()
    s.start(f"Contacting {api_base}")
    try:
        info = fetch_key_info(api_key, api_base)
    except KeyInfoError as exc:
        s.stop(c.red("Connection failed"))
        p.error(str(exc))
        return 1
    s.stop("Connected")
    _print_key_summary(dashboard_url, info)
    p.outro(c.green("✓ Spanlens is reachable and your key is valid"))
    return 0


# ── arg parsing ──────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="spanlens",
        description="Spanlens onboarding wizard. Connect your app in two minutes.",
    )
    parser.add_argument("--version", action="version", version=f"spanlens {_version()}")

    sub = parser.add_subparsers(dest="command")

    def _add_common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--api-key", default=None, help="Spanlens key (else prompt / SPANLENS_API_KEY).")
        sp.add_argument("--server-url", default=None, help="Self-hosted Spanlens base URL.")

    init = sub.add_parser("init", help="Run the onboarding wizard (default).")
    _add_common(init)
    init.add_argument("--dry-run", action="store_true", help="Preview without writing files.")
    init.add_argument("-y", "--yes", action="store_true", help="Accept all prompts (non-interactive).")

    test = sub.add_parser("test", help="Validate your key and connectivity.")
    _add_common(test)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    _force_utf8_output()
    raw = list(sys.argv[1:] if argv is None else argv)

    # `init` is the default subcommand: inject it when the first token is not a
    # known command or a top-level flag, so `spanlens` and `spanlens --dry-run`
    # both run the wizard while `spanlens test` / `spanlens --version` still work.
    passthrough = {"init", "test", "-h", "--help", "--version"}
    if not raw or raw[0] not in passthrough:
        raw = ["init", *raw]

    parser = _build_parser()
    args = parser.parse_args(raw)
    command = args.command or "init"

    try:
        if command == "test":
            return _cmd_test(args)
        return _cmd_init(args)
    except p.PromptCancelledError:
        print()
        p.cancel("Aborted.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
