"""FastAPI / Starlette (and any ASGI) auto-instrumentation middleware.

One line turns every HTTP request into a Spanlens trace with a root span::

    from fastapi import FastAPI
    from spanlens import SpanlensMiddleware

    app = FastAPI()
    app.add_middleware(SpanlensMiddleware, api_key=os.environ["SPANLENS_API_KEY"])

Each request opens a trace + a root span named ``"<METHOD> <path>"``. On a
clean response the span/trace end ``completed``; on a 5xx or an unhandled
exception they end ``error`` (the exception is re-raised untouched). Sampling,
tail-based error capture, and fire-and-forget transport are inherited from the
underlying :class:`~spanlens.client.SpanlensClient`, so sampled-out successful
requests produce zero network overhead while errors are always captured.

The middleware exposes the trace to your handlers via ``request.state.spanlens``
so nested LLM calls can be linked to this trace::

    @app.post("/chat")
    async def chat(request: Request):
        sl = request.state.spanlens              # {trace, span, headers, ...}
        res = await observe_openai(sl["trace"], "answer", call_openai)
        # or pass sl["headers"] straight to the proxy client's extra_headers

This is pure ASGI — it does not import FastAPI/Starlette, so importing it never
pulls in a web framework. It works with any ASGI app (FastAPI, Starlette,
Litestar, Quart, ...).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional, Sequence

from .client import SpanlensClient
from .trace import TraceHandle
from .types import SpanType

# Routes that are noise for tracing — health probes, framework docs, static
# metadata. Matched by exact path or as a prefix (so /docs and /docs/oauth2 both
# skip). Override with the ``skip_paths`` argument.
_DEFAULT_SKIP_PATHS: tuple[str, ...] = (
    "/health",
    "/healthz",
    "/livez",
    "/readyz",
    "/ping",
    "/metrics",
    "/favicon.ico",
    "/docs",
    "/redoc",
    "/openapi.json",
)

ASGIApp = Callable[[dict[str, Any], Callable[[], Awaitable[dict[str, Any]]], Callable[[dict[str, Any]], Awaitable[None]]], Awaitable[None]]

# A callable that derives the trace/span name from the ASGI scope.
NameFactory = Callable[[dict[str, Any]], str]


def _default_name(scope: dict[str, Any]) -> str:
    method = scope.get("method", "GET")
    path = scope.get("path", "") or "/"
    return f"{method} {path}"


def _safe_str(exc: BaseException) -> str:
    """str(exc) that can never raise — a broken __str__/__repr__ on a handler's
    exception must not replace the original exception on its way back up (the
    middleware's re-raise-untouched invariant)."""
    try:
        return str(exc)
    except Exception:
        return repr(type(exc))


class SpanlensMiddleware:
    """ASGI middleware that records one trace + root span per HTTP request.

    Args:
        app: The wrapped ASGI application (supplied by ``add_middleware``).
        client: An existing :class:`SpanlensClient`. Provide this to share one
            client (and its connection pool) across your app. If omitted, one
            is built from ``api_key`` / ``base_url`` / ``sample_rate``.
        api_key: Spanlens API key, used only when ``client`` is not given.
        base_url: Override the ingest base URL (when building a client here).
        sample_rate: Trace sample rate in ``[0, 1]`` (when building a client here).
        skip_paths: Paths to leave un-instrumented (exact or prefix match).
            Defaults to health/metrics/docs routes.
        span_type: Span type for the root span (default ``"custom"``).
        name_factory: ``scope -> str`` to customise the trace/span name.
            Defaults to ``"<METHOD> <path>"``.
        capture_query_string: When True, store the raw request query string in
            the trace metadata. OFF by default because query strings routinely
            carry secrets/PII (OAuth ``code``/``state``, password-reset or
            magic-link ``token``, signed-URL signatures). Mirrors the
            ``x-spanlens-log-body`` opt-out precedent for proxy bodies.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        client: Optional[SpanlensClient] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        sample_rate: Optional[float] = None,
        skip_paths: Optional[Sequence[str]] = None,
        span_type: SpanType = "custom",
        name_factory: Optional[NameFactory] = None,
        capture_query_string: bool = False,
    ) -> None:
        self.app = app

        if client is None:
            if not api_key:
                raise ValueError(
                    "[spanlens] SpanlensMiddleware needs either client= or api_key=. "
                    "Pass an existing SpanlensClient, or api_key=os.environ['SPANLENS_API_KEY']."
                )
            client = SpanlensClient(
                api_key=api_key,
                base_url=base_url,
                sample_rate=sample_rate,
            )
        self._client = client
        self._skip_paths: tuple[str, ...] = (
            tuple(skip_paths) if skip_paths is not None else _DEFAULT_SKIP_PATHS
        )
        self._span_type: SpanType = span_type
        self._name_factory: NameFactory = name_factory or _default_name
        self._capture_query: bool = capture_query_string

    def _should_skip(self, path: str) -> bool:
        for skip in self._skip_paths:
            if path == skip or path.startswith(skip + "/"):
                return True
        return False

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        # Only HTTP requests get traced; websockets/lifespan pass straight through.
        if scope.get("type") != "http" or self._should_skip(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        # Building the trace must never crash the request. If anything here
        # throws (it shouldn't — the client is fire-and-forget), fall back to an
        # un-instrumented passthrough.
        trace: Optional[TraceHandle] = None
        span = None
        try:
            method = scope.get("method", "GET")
            path = scope.get("path", "") or "/"
            name = self._name_factory(scope)
            metadata: dict[str, Any] = {"method": method, "path": path}
            # Query strings often carry secrets/PII, so they are NOT captured
            # unless the caller opts in with capture_query_string=True.
            if self._capture_query:
                query = scope.get("query_string", b"")
                if query:
                    metadata["query"] = query.decode("latin-1")

            trace = self._client.start_trace(name, metadata=metadata)
            span = trace.span(
                name,
                span_type=self._span_type,
                input={"method": method, "path": path},
            )
            # Expose to handlers: request.state.spanlens
            state = scope.setdefault("state", {})
            state["spanlens"] = {
                "trace": trace,
                "span": span,
                "trace_id": trace.trace_id,
                "span_id": span.span_id,
                "headers": span.trace_headers(),
            }
        except Exception:
            # Instrumentation setup failed — run the app un-traced.
            await self.app(scope, receive, send)
            return

        status_code: Optional[int] = None

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = message.get("status")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            # Unhandled exception in the handler — record error, then re-raise
            # so the framework's own error handling still runs. _safe_str keeps a
            # broken __str__ from replacing the original exception on re-raise.
            self._safe_end(span, trace, status="error", error_message=_safe_str(exc))
            raise

        # A 5xx status without an exception (e.g. a returned error response) is
        # still an error for tracing purposes.
        is_error = status_code is not None and status_code >= 500
        self._safe_end(
            span,
            trace,
            status="error" if is_error else "completed",
            output={"status_code": status_code},
        )

    @staticmethod
    def _safe_end(
        span: Any,
        trace: Optional[TraceHandle],
        *,
        status: str,
        output: Any = None,
        error_message: Optional[str] = None,
    ) -> None:
        """End the span + trace, swallowing any error so tracing never breaks
        the response path."""
        try:
            if span is not None:
                if error_message is not None:
                    span.end(status=status, error_message=error_message)
                else:
                    span.end(status=status, output=output)
            if trace is not None:
                if error_message is not None:
                    trace.end(status=status, error_message=error_message)
                else:
                    trace.end(status=status)
        except Exception:
            pass


def install_spanlens_middleware(
    app: Any,
    **kwargs: Any,
) -> None:
    """Convenience wrapper for ``app.add_middleware(SpanlensMiddleware, **kwargs)``.

    Example::

        from spanlens import install_spanlens_middleware
        install_spanlens_middleware(app, api_key=os.environ["SPANLENS_API_KEY"])
    """
    app.add_middleware(SpanlensMiddleware, **kwargs)


__all__ = ["SpanlensMiddleware", "install_spanlens_middleware"]
