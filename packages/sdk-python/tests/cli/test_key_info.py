"""Key-info client — mocks the /api/v1/me/key-info endpoint with respx."""

import httpx
import pytest
import respx

from spanlens.cli.key_info import KeyInfoError, fetch_key_info

BASE = "https://www.spanlens.io"
URL = f"{BASE}/api/v1/me/key-info"


@respx.mock
def test_valid_full_key_with_providers() -> None:
    respx.get(URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "success": True,
                "data": {
                    "projectId": "p_1",
                    "projectName": "My Project",
                    "providers": ["openai", "anthropic"],
                    "scope": "full",
                },
            },
        )
    )
    info = fetch_key_info("sl_live_abc", BASE)
    assert info.project_name == "My Project"
    assert info.providers == ["openai", "anthropic"]
    assert info.scope == "full"


@respx.mock
def test_public_workspace_key() -> None:
    respx.get(URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "success": True,
                "data": {
                    "projectId": None,
                    "projectName": None,
                    "providers": [],
                    "scope": "public",
                },
            },
        )
    )
    info = fetch_key_info("sl_live_pub_abc", BASE)
    assert info.project_id is None
    assert info.scope == "public"
    assert info.providers == []


@respx.mock
def test_401_raises_actionable_error() -> None:
    respx.get(URL).mock(return_value=httpx.Response(401, json={"error": "nope"}))
    with pytest.raises(KeyInfoError, match="rejected this key"):
        fetch_key_info("sl_live_bad", BASE)


@respx.mock
def test_500_raises() -> None:
    respx.get(URL).mock(return_value=httpx.Response(500, text="boom"))
    with pytest.raises(KeyInfoError, match="500"):
        fetch_key_info("sl_live_abc", BASE)


@respx.mock
def test_network_error_raises() -> None:
    respx.get(URL).mock(side_effect=httpx.ConnectError("refused"))
    with pytest.raises(KeyInfoError, match="Network error"):
        fetch_key_info("sl_live_abc", BASE)


@respx.mock
def test_unexpected_shape_raises() -> None:
    respx.get(URL).mock(return_value=httpx.Response(200, json={"success": True}))
    with pytest.raises(KeyInfoError, match="Unexpected response shape"):
        fetch_key_info("sl_live_abc", BASE)


@respx.mock
def test_trailing_slash_base_is_normalized() -> None:
    route = respx.get(URL).mock(
        return_value=httpx.Response(
            200,
            json={"success": True, "data": {"projectId": "p", "projectName": "n", "providers": [], "scope": "full"}},
        )
    )
    fetch_key_info("sl_live_abc", BASE + "/")
    assert route.called
