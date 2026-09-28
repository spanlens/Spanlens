"""Suite-wide test setup.

Real network access is blocked. When ``openai`` 3 moved from ``httpx`` to
``httpx2``, respx stopped intercepting its requests, and tests quietly started
calling the real ``api.spanlens.io`` and a made-up host instead of their
mocks. They failed only because the answers happened to differ. The guard
below makes that failure mode loud and immediate: resolving or connecting to
any host other than the local machine raises inside the code under test, and
the test fails even when that code swallows the error (the ingest transport
and the provider SDKs both do).

The guard stays installed until the interpreter exits, so ingest calls that
the transport's ``atexit`` hook drains after the last test are blocked too.
"""

from __future__ import annotations

import ipaddress
import socket
import threading
from types import ModuleType
from typing import Any, Callable, Iterator

import pytest

from ._provider_http import respx_http_client


class RealNetworkAccessError(RuntimeError):
    """Raised when a test tries to reach a host other than the local machine."""


_attempts: list[str] = []
_attempts_lock = threading.Lock()
_reported = 0
_originals: dict[str, Any] = {}


def _host_text(host: Any) -> str:
    if isinstance(host, (bytes, bytearray)):
        return bytes(host).decode("ascii", "replace")
    return str(host)


def _is_local_host(host: Any) -> bool:
    if host is None:  # getaddrinfo(None, port): the local wildcard address
        return True
    name = _host_text(host).strip("[]").rstrip(".").lower()
    if name == "localhost" or name.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(name.split("%", 1)[0])
    except ValueError:
        return False
    return address.is_loopback or address.is_unspecified


def _block(target: str) -> None:
    with _attempts_lock:
        _attempts.append(target)
    raise RealNetworkAccessError(
        f"[tests] Real network access to {target} is blocked. Mock the call "
        "(respx for httpx, tests/_provider_http.py for the provider SDKs)."
    )


def _guarded_getaddrinfo(host: Any, port: Any, *args: Any, **kwargs: Any) -> Any:
    if not _is_local_host(host):
        _block(f"{_host_text(host)}:{port}")
    return _originals["getaddrinfo"](host, port, *args, **kwargs)


def _guard_connect(name: str) -> Callable[..., Any]:
    original = _originals[name]

    def connect(sock: socket.socket, address: Any) -> Any:
        is_ip = sock.family in (socket.AF_INET, socket.AF_INET6)
        if is_ip and isinstance(address, tuple) and not _is_local_host(address[0]):
            _block(f"{_host_text(address[0])}:{address[1]}")
        return original(sock, address)

    return connect


def _install_network_guard() -> None:
    if _originals:
        return
    _originals["getaddrinfo"] = socket.getaddrinfo
    _originals["connect"] = socket.socket.connect
    _originals["connect_ex"] = socket.socket.connect_ex
    socket.getaddrinfo = _guarded_getaddrinfo
    socket.socket.connect = _guard_connect("connect")
    socket.socket.connect_ex = _guard_connect("connect_ex")


def _take_unreported() -> list[str]:
    global _reported
    with _attempts_lock:
        fresh = _attempts[_reported:]
        _reported = len(_attempts)
    return fresh


def _describe(attempts: list[str]) -> str:
    return ", ".join(sorted(set(attempts)))


def pytest_configure(config: pytest.Config) -> None:
    _install_network_guard()


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Catch attempts made outside any test, e.g. by a background ingest
    thread that outlived the last test."""
    stray = _take_unreported()
    if not stray:
        return
    message = f"[tests] Real network access attempted outside a test: {_describe(stray)}"
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is not None:
        reporter.write_line(message, red=True)
    session.exitstatus = pytest.ExitCode.TESTS_FAILED


@pytest.fixture(autouse=True)
def _no_real_network() -> Iterator[None]:
    yield
    attempts = _take_unreported()
    if attempts:
        pytest.fail(
            f"Test tried to reach the real network: {_describe(attempts)}. Every "
            "HTTP call must be mocked. (A background ingest call left over from "
            "an earlier test is reported against the test running when it fired.)",
            pytrace=False,
        )


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
