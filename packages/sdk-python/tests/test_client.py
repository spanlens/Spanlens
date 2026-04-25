"""Smoke tests for the SDK entry point and configuration validation."""

from __future__ import annotations

import pytest

from spanlens import SpanlensClient


def test_client_requires_api_key():
    with pytest.raises(ValueError, match="api_key is required"):
        SpanlensClient(api_key="")


def test_client_rejects_whitespace_api_key():
    with pytest.raises(ValueError, match="api_key is required"):
        SpanlensClient(api_key="   ")


def test_client_constructs_with_api_key():
    client = SpanlensClient(api_key="sl_test_dummy")
    try:
        assert client._transport is not None
    finally:
        client.close()


def test_client_context_manager_closes_transport():
    with SpanlensClient(api_key="sl_test_dummy") as client:
        assert client._transport is not None
    # After __exit__, the transport's executor is shut down. We can't easily
    # introspect that without poking internals — just ensure no exception.


def test_client_accepts_optional_overrides():
    client = SpanlensClient(
        api_key="sl_test_dummy",
        base_url="https://example.test",
        timeout_ms=5000,
        silent=False,
        on_error=lambda _err, _ctx: None,
    )
    try:
        assert client._transport._base_url == "https://example.test"
        assert client._transport._timeout_s == 5.0
        assert client._transport._silent is False
    finally:
        client.close()


def test_client_strips_trailing_slash_from_base_url():
    client = SpanlensClient(api_key="sl_test_dummy", base_url="https://example.test/")
    try:
        assert client._transport._base_url == "https://example.test"
    finally:
        client.close()
