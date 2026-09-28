"""HTTP clients for the provider SDKs that respx can answer.

respx intercepts the ``httpx`` package only: it patches
``httpx.Client._transport_for_url`` and the ``httpcore`` connection pools.
``openai>=3`` and ``anthropic>=1`` no longer use ``httpx``. They build their
default client from ``httpx2`` (a separate package on top of ``httpcore2``),
which respx never sees, so a test that only registers respx routes sends the
provider call to the real network.

``respx_http_client()`` returns a client of whichever HTTP package the
installed SDK uses, with a mock transport that hands every request to the
respx router. Routes, call counts and ``route.calls[i].request`` keep working
the same way for ``openai`` 1.x/2.x (``httpx``) and 3.x (``httpx2``), and for
``anthropic`` 0.x and 1.x. ``anthropic>=1`` rejects ``httpx`` clients
outright, so passing a plain ``httpx.Client()`` is not an option there.
"""

from __future__ import annotations

import importlib
from types import ModuleType
from typing import Any, Callable

import httpx
import respx

_HTTP_PACKAGES = ("httpx", "httpx2")
_BODY_ENCODING_HEADERS = (b"content-encoding", b"content-length")


def default_client_classes(sdk: ModuleType) -> tuple[type, type]:
    """``sdk``'s sync and async default HTTP client classes. Releases older
    than the ``DefaultHttpxClient`` aliases only accept ``httpx`` clients."""
    sync_cls = getattr(sdk, "DefaultHttpxClient", None)
    async_cls = getattr(sdk, "DefaultAsyncHttpxClient", None)
    if sync_cls is None or async_cls is None:
        return httpx.Client, httpx.AsyncClient
    return sync_cls, async_cls


def http_library(sdk: ModuleType) -> ModuleType:
    """The HTTP package (``httpx`` or ``httpx2``) ``sdk`` builds its client on."""
    sync_cls, _ = default_client_classes(sdk)
    for cls in sync_cls.__mro__:
        root = cls.__module__.partition(".")[0]
        if root in _HTTP_PACKAGES:
            return importlib.import_module(root)
    raise RuntimeError(f"{sync_cls!r} is not built on any of {_HTTP_PACKAGES}")


def respx_http_client(
    sdk: ModuleType,
    *,
    is_async: bool = False,
    router: respx.Router = respx.mock,
) -> Any:
    """A default HTTP client (sync or async) for ``sdk`` whose requests are
    answered by ``router``, the global respx router by default.

    Pass it as ``http_client=`` to the provider SDK or to
    ``create_openai()`` / ``create_anthropic()`` and friends."""
    lib = http_library(sdk)
    transport = lib.MockTransport(_respx_handler(lib, router))
    sync_cls, async_cls = default_client_classes(sdk)
    return (async_cls if is_async else sync_cls)(transport=transport)


def _respx_handler(lib: ModuleType, router: respx.Router) -> Callable[[Any], Any]:
    """Translate a request of ``lib`` into an ``httpx.Request`` for respx,
    and respx's ``httpx.Response`` back into a response of ``lib``.

    The transports read the request body before calling the handler, for
    sync and async clients alike, so ``request.content`` is always ready."""

    def handle(request: Any) -> Any:
        mocked = router.handler(
            httpx.Request(
                request.method,
                str(request.url),
                headers=list(request.headers.raw),
                content=request.content,
            )
        )
        # ``read()`` returns the decoded body, so the headers that describe
        # the encoded one would make the client decode it a second time.
        headers = [
            (name, value)
            for name, value in mocked.headers.raw
            if name.lower() not in _BODY_ENCODING_HEADERS
        ]
        return lib.Response(
            mocked.status_code,
            headers=headers,
            content=mocked.read(),
            request=request,
        )

    return handle
