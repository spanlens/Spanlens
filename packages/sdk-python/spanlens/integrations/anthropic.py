"""Anthropic client helper — pre-configured for the Spanlens proxy.

Replaces::

    from anthropic import Anthropic
    client = Anthropic(
        api_key=os.environ["SPANLENS_API_KEY"],
        base_url="https://spanlens-server.vercel.app/proxy/anthropic",
    )

With::

    from spanlens.integrations.anthropic import create_anthropic
    client = create_anthropic()

``anthropic`` is an *optional* dependency — install with
``pip install "spanlens[anthropic]"``.
"""

from __future__ import annotations

import os
from typing import Any, Optional

DEFAULT_SPANLENS_ANTHROPIC_PROXY = "https://spanlens-server.vercel.app/proxy/anthropic"
PROMPT_VERSION_HEADER = "x-spanlens-prompt-version"


def create_anthropic(
    *,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    **kwargs: Any,
) -> Any:
    """Build an ``anthropic.Anthropic`` client whose requests flow through
    the Spanlens proxy.

    Args:
        api_key: Spanlens API key. Defaults to ``SPANLENS_API_KEY`` env var.
        base_url: Override the proxy URL — useful for self-hosted Spanlens.
        **kwargs: Forwarded to ``anthropic.Anthropic(...)`` unchanged.

    Raises:
        ImportError: ``anthropic`` package is not installed.
        ValueError: ``api_key`` not provided and ``SPANLENS_API_KEY`` unset.
    """
    try:
        from anthropic import Anthropic
    except ImportError as exc:  # pragma: no cover - import-time
        raise ImportError(
            "[spanlens] The `anthropic` package is required for create_anthropic(). "
            'Install with: pip install "spanlens[anthropic]"'
        ) from exc

    resolved_key = api_key or os.environ.get("SPANLENS_API_KEY")
    if not resolved_key:
        raise ValueError(
            "[spanlens] SPANLENS_API_KEY is not set. Pass api_key=... to "
            "create_anthropic() or set the SPANLENS_API_KEY environment variable."
        )

    return Anthropic(
        api_key=resolved_key,
        base_url=base_url or DEFAULT_SPANLENS_ANTHROPIC_PROXY,
        **kwargs,
    )


def with_prompt_version(prompt_version: str) -> dict[str, dict[str, str]]:
    """Tag a single Anthropic request with a Spanlens prompt version.

    Example::

        from spanlens.integrations.anthropic import (
            create_anthropic,
            with_prompt_version,
        )

        client = create_anthropic()
        msg = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            messages=[...],
            **with_prompt_version("greeter@latest"),
        )

    Args:
        prompt_version: Raw UUID, ``"<name>@<version>"`` or
            ``"<name>@latest"``.
    """
    return {"extra_headers": {PROMPT_VERSION_HEADER: prompt_version}}


__all__ = [
    "DEFAULT_SPANLENS_ANTHROPIC_PROXY",
    "PROMPT_VERSION_HEADER",
    "create_anthropic",
    "with_prompt_version",
]
