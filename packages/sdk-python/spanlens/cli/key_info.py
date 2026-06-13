"""Validate a Spanlens key against the API and introspect its providers.

Hits ``GET /api/v1/me/key-info`` exactly like ``packages/cli`` does. The
endpoint authenticates with the ``sl_live_*`` key in the ``Authorization``
header (no Supabase session) and returns which provider keys are registered
under that Spanlens key, so the wizard knows which integrations to patch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import httpx


class KeyInfoError(Exception):
    """A user-actionable failure validating the key (network or API)."""


@dataclass(frozen=True)
class KeyInfo:
    project_id: Optional[str]
    project_name: Optional[str]
    providers: List[str] = field(default_factory=list)
    scope: str = "full"


def fetch_key_info(api_key: str, api_base: str, *, timeout: float = 15.0) -> KeyInfo:
    url = f"{api_base.rstrip('/')}/api/v1/me/key-info"
    try:
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise KeyInfoError(
            f"Network error contacting {api_base}. Check your connection. ({exc})"
        ) from exc

    if response.status_code == 401:
        raise KeyInfoError(
            "Spanlens rejected this key (401). Re-copy it from the dashboard."
        )
    if response.status_code >= 400:
        raise KeyInfoError(
            f"Spanlens returned {response.status_code} from /me/key-info. Try again in a moment."
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise KeyInfoError("Unexpected (non-JSON) response from /me/key-info.") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise KeyInfoError("Unexpected response shape from /me/key-info.")

    providers = data.get("providers") or []
    if not isinstance(providers, list):
        providers = []

    return KeyInfo(
        project_id=data.get("projectId"),
        project_name=data.get("projectName"),
        providers=[str(p) for p in providers],
        scope=str(data.get("scope") or "full"),
    )


__all__ = ["KeyInfo", "KeyInfoError", "fetch_key_info"]
