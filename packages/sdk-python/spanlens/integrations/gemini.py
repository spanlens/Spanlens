"""Google Gemini client helper — pre-configured for the Spanlens proxy.

The Google ``google-generativeai`` SDK uses a *module-level* configuration
pattern (``genai.configure(api_key=..., transport=...)``) and routes through
its own internal HTTP client; it does **not** support a per-instance
``base_url`` the way OpenAI/Anthropic do.

To make the proxy approach work, we expose ``create_gemini()`` which returns
an ``httpx.Client`` pre-configured with the Spanlens proxy as ``base_url``
plus an ``Authorization`` header carrying the Spanlens API key. The proxy
in turn forwards to ``generativelanguage.googleapis.com`` and decodes the
provider key on the server.

Use the returned client to issue raw HTTP calls, OR use the proxy URL +
your own ``google.generativeai`` ``client_options.api_endpoint`` override.

``google-generativeai`` is an *optional* dependency for the
``configure_gemini()`` variant — install with
``pip install "spanlens[gemini]"``.
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx

DEFAULT_SPANLENS_GEMINI_PROXY = "https://spanlens-server.vercel.app/proxy/gemini"


def create_gemini(
    *,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: float = 60.0,
) -> httpx.Client:
    """Return an ``httpx.Client`` pre-configured for the Spanlens Gemini proxy.

    Use it to issue REST calls to Gemini through Spanlens::

        client = create_gemini()
        res = client.post(
            "/v1beta/models/gemini-1.5-flash:generateContent",
            json={"contents": [{"parts": [{"text": "Hello"}]}]},
        )
        print(res.json())

    Args:
        api_key: Spanlens API key. Defaults to ``SPANLENS_API_KEY`` env var.
        base_url: Override the proxy URL — useful for self-hosted Spanlens.
        timeout: Request timeout in seconds (LLM calls can be slow — default
            60s).

    Raises:
        ValueError: ``api_key`` not provided and ``SPANLENS_API_KEY`` unset.
    """
    resolved_key = api_key or os.environ.get("SPANLENS_API_KEY")
    if not resolved_key:
        raise ValueError(
            "[spanlens] SPANLENS_API_KEY is not set. Pass api_key=... to "
            "create_gemini() or set the SPANLENS_API_KEY environment variable."
        )

    return httpx.Client(
        base_url=base_url or DEFAULT_SPANLENS_GEMINI_PROXY,
        headers={"Authorization": f"Bearer {resolved_key}"},
        timeout=timeout,
    )


def configure_gemini(
    *,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> None:
    """Point ``google.generativeai`` at the Spanlens proxy globally.

    This calls ``genai.configure()`` with the Spanlens proxy as the API
    endpoint. After calling, all ``genai.GenerativeModel(...).generate_content(...)``
    calls flow through Spanlens.

    Note:
        ``google.generativeai`` configures the endpoint *globally* per
        process — use this in single-tenant scripts. For multi-tenant
        servers, prefer the ``create_gemini()`` raw-HTTP client.

    Raises:
        ImportError: ``google-generativeai`` package is not installed.
        ValueError: ``api_key`` not provided and ``SPANLENS_API_KEY`` unset.
    """
    try:
        import google.generativeai as genai  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - import-time
        raise ImportError(
            "[spanlens] The `google-generativeai` package is required for "
            'configure_gemini(). Install with: pip install "spanlens[gemini]"'
        ) from exc

    resolved_key = api_key or os.environ.get("SPANLENS_API_KEY")
    if not resolved_key:
        raise ValueError(
            "[spanlens] SPANLENS_API_KEY is not set. Pass api_key=... to "
            "configure_gemini() or set the SPANLENS_API_KEY environment variable."
        )

    proxy = base_url or DEFAULT_SPANLENS_GEMINI_PROXY

    # google.generativeai accepts api_endpoint via client_options. The path
    # prefix (e.g. /v1beta) is added by the SDK; we only configure the host.
    client_options: Any = {"api_endpoint": proxy}
    genai.configure(api_key=resolved_key, client_options=client_options)


__all__ = [
    "DEFAULT_SPANLENS_GEMINI_PROXY",
    "configure_gemini",
    "create_gemini",
]
