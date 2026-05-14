"""OpenAI client helper — pre-configured for the Spanlens proxy.

Replaces::

    from openai import OpenAI
    client = OpenAI(
        api_key=os.environ["SPANLENS_API_KEY"],
        base_url="https://spanlens-server.vercel.app/proxy/openai/v1",
    )

With::

    from spanlens.integrations.openai import create_openai
    client = create_openai()

The returned client behaves identically to ``OpenAI(...)`` — only the
``base_url`` is redirected to the Spanlens proxy (which records the call,
enforces quota, computes cost) and ``api_key`` defaults to
``SPANLENS_API_KEY`` from the environment.

``openai`` is an *optional* dependency — install with
``pip install "spanlens[openai]"``.
"""

from __future__ import annotations

import os
from typing import Any, Optional

DEFAULT_SPANLENS_OPENAI_PROXY = "https://spanlens-server.vercel.app/proxy/openai/v1"
PROMPT_VERSION_HEADER = "x-spanlens-prompt-version"
USER_HEADER = "x-spanlens-user"
SESSION_HEADER = "x-spanlens-session"


def create_openai(
    *,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    **kwargs: Any,
) -> Any:
    """Build an ``openai.OpenAI`` client whose requests flow through the
    Spanlens proxy.

    Args:
        api_key: Spanlens API key. Defaults to ``SPANLENS_API_KEY`` env var.
        base_url: Override the proxy URL — useful for self-hosted Spanlens.
        **kwargs: Forwarded to ``openai.OpenAI(...)`` unchanged.

    Raises:
        ImportError: ``openai`` package is not installed.
        ValueError: ``api_key`` not provided and ``SPANLENS_API_KEY`` unset.
    """
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover - import-time
        raise ImportError(
            "[spanlens] The `openai` package is required for create_openai(). "
            'Install with: pip install "spanlens[openai]"'
        ) from exc

    resolved_key = api_key or os.environ.get("SPANLENS_API_KEY")
    if not resolved_key:
        raise ValueError(
            "[spanlens] SPANLENS_API_KEY is not set. Pass api_key=... to "
            "create_openai() or set the SPANLENS_API_KEY environment variable."
        )

    return OpenAI(
        api_key=resolved_key,
        base_url=base_url or DEFAULT_SPANLENS_OPENAI_PROXY,
        **kwargs,
    )


def with_prompt_version(prompt_version: str) -> dict[str, dict[str, str]]:
    """Tag a single OpenAI request with a Spanlens prompt version.

    Spread the result into the per-request ``extra_headers``::

        from openai import OpenAI
        from spanlens.integrations.openai import (
            create_openai,
            with_prompt_version,
        )

        client = create_openai()
        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[...],
            **with_prompt_version("chatbot-system@3"),
        )

    Args:
        prompt_version: Either a raw ``prompt_versions.id`` UUID,
            ``"<name>@<version>"`` (e.g. ``"chatbot-system@3"``), or
            ``"<name>@latest"`` to always resolve to the latest version
            server-side.
    """
    return {"extra_headers": {PROMPT_VERSION_HEADER: prompt_version}}


def with_user(user_id: str) -> dict[str, dict[str, str]]:
    """Tag a single OpenAI request with an end-user ID.

    Spread the result into the per-request ``extra_headers``::

        from spanlens.integrations.openai import create_openai, with_user

        client = create_openai()
        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[...],
            **with_user("user-123"),
        )

    Combine with :func:`with_session` or :func:`with_prompt_version`::

        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[...],
            **{
                **with_user("user-123"),
                **with_session("sess-456"),
            },
        )

    Args:
        user_id: An arbitrary identifier for the end user (e.g. ``auth.uid``).
            Visible in the Spanlens dashboard Requests filter.
    """
    return {"extra_headers": {USER_HEADER: user_id}}


def with_session(session_id: str) -> dict[str, dict[str, str]]:
    """Tag a single OpenAI request with a session / conversation ID.

    Args:
        session_id: An arbitrary identifier for the conversation session.
            Visible in the Spanlens dashboard Requests filter.
    """
    return {"extra_headers": {SESSION_HEADER: session_id}}


__all__ = [
    "DEFAULT_SPANLENS_OPENAI_PROXY",
    "PROMPT_VERSION_HEADER",
    "USER_HEADER",
    "SESSION_HEADER",
    "create_openai",
    "with_prompt_version",
    "with_user",
    "with_session",
]
