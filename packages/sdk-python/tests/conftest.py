"""Suite-wide test fixtures."""

from __future__ import annotations

from types import ModuleType
from typing import Any, Callable

import pytest

from ._provider_http import respx_http_client


@pytest.fixture
def provider_http_client() -> Callable[..., Any]:
    """Factory for provider SDK ``http_client`` objects answered by respx::

        client = create_openai(http_client=provider_http_client(openai))
        client = create_async_anthropic(
            http_client=provider_http_client(anthropic, is_async=True)
        )
    """

    def make(sdk: ModuleType, *, is_async: bool = False) -> Any:
        return respx_http_client(sdk, is_async=is_async)

    return make
