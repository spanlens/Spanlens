"""One place that decides where the SDK sends traffic.

``SPANLENS_BASE_URL`` holds the **server origin** of a self-hosted Spanlens
(for example ``https://spanlens.yourcompany.com``). ``spanlens init
--server-url`` writes it in exactly that form. Each consumer appends its own
path:

* the ingest client (``SpanlensClient``) uses the origin as is;
* the provider factories append their proxy path, e.g. ``/proxy/openai/v1``.

Priority everywhere: an explicit ``base_url`` argument, then
``SPANLENS_BASE_URL``, then the hosted default.
"""

from __future__ import annotations

import os
from typing import Optional

SPANLENS_BASE_URL_ENV = "SPANLENS_BASE_URL"

OPENAI_PROXY_PATH = "/proxy/openai/v1"
ANTHROPIC_PROXY_PATH = "/proxy/anthropic"
GEMINI_PROXY_PATH = "/proxy/gemini"


def normalize_server_origin(value: str) -> Optional[str]:
    """Trim whitespace and trailing slashes. Returns ``None`` for blanks."""
    cleaned = value.strip().rstrip("/")
    return cleaned or None


def server_origin_from_env() -> Optional[str]:
    """The self-hosted server origin from ``SPANLENS_BASE_URL``, if set."""
    return normalize_server_origin(os.environ.get(SPANLENS_BASE_URL_ENV, ""))


def resolve_proxy_base_url(
    explicit: Optional[str],
    *,
    proxy_path: str,
    hosted_default: str,
) -> str:
    """Base URL for a provider factory.

    ``explicit`` wins. Otherwise ``SPANLENS_BASE_URL`` plus ``proxy_path``
    (not appended twice when the variable already ends with it). Otherwise
    ``hosted_default``.
    """
    if explicit:
        return explicit
    origin = server_origin_from_env()
    if origin is None:
        return hosted_default
    if origin.endswith(proxy_path):
        return origin
    return f"{origin}{proxy_path}"


__all__ = [
    "ANTHROPIC_PROXY_PATH",
    "GEMINI_PROXY_PATH",
    "OPENAI_PROXY_PATH",
    "SPANLENS_BASE_URL_ENV",
    "normalize_server_origin",
    "resolve_proxy_base_url",
    "server_origin_from_env",
]
