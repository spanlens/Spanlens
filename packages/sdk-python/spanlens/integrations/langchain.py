"""LangChain Python callback handler for Spanlens tracing.

Records LLM / chain / tool / retriever spans from any LangChain or LangGraph
runnable. The handler subclasses ``langchain_core.callbacks.BaseCallbackHandler``
when ``langchain-core`` is available; otherwise it falls back to a plain class
that exposes the same ``on_*`` methods (so unit tests can drive it without
installing langchain).

LangGraph reuses LangChain's callback contract, so this handler works equally
well for plain LangChain chains, LCEL pipelines, and LangGraph compiled graphs.
The ``run_id`` / ``parent_run_id`` pair on every callback gives a span tree
that mirrors the graph topology 1:1 — graph → node → llm/tool.

Example::

    from spanlens import SpanlensClient
    from spanlens.integrations.langchain import SpanlensCallbackHandler

    client = SpanlensClient(api_key=os.environ["SPANLENS_API_KEY"])
    handler = SpanlensCallbackHandler(client=client)

    # LangChain
    chain.invoke({"input": "hi"}, config={"callbacks": [handler]})

    # LangGraph
    graph = workflow.compile()
    graph.invoke({"input": "hi"}, config={"callbacks": [handler]})
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Optional
from uuid import UUID

from ..client import SpanlensClient
from ..span import SpanHandle
from ..trace import TraceHandle

if TYPE_CHECKING:  # pragma: no cover - type-only
    pass


# Try to subclass LangChain's BaseCallbackHandler when it's available so
# duck-typed callback dispatch picks our methods up correctly. Falls back to a
# plain object base class so the handler is testable without langchain
# installed and so we don't add langchain as a hard dependency.
try:
    from langchain_core.callbacks import (
        BaseCallbackHandler as _LCBase,  # type: ignore[import-not-found]
    )
except ImportError:  # pragma: no cover - covered by tests indirectly
    _LCBase = object  # type: ignore[assignment,misc]


# Sentinel for "argument intentionally omitted" — distinct from None.
_OMIT: Any = object()

_DEFAULT_MAX_INPUT_BYTES = 16_384
_DEFAULT_MAX_OUTPUT_BYTES = 16_384


def _truncate(value: Any, max_bytes: int) -> Any:
    """JSON-encode and truncate. Returns the original value when it fits, or a
    truncation marker dict otherwise.

    Non-serializable values fall back to ``str(value)`` rather than raising —
    span ingest must never crash the caller's code.
    """
    if value is None:
        return None
    try:
        encoded = json.dumps(value, default=str)
    except (TypeError, ValueError):
        encoded = str(value)
    if len(encoded) <= max_bytes:
        return value
    return {
        "__truncated": True,
        "preview": encoded[:max_bytes],
        "originalBytes": len(encoded),
    }


def _short_name(serialized: Any, fallback: str) -> str:
    """Best-effort short name for a LangChain ``Serialized`` blob."""
    if isinstance(serialized, dict):
        ids = serialized.get("id")
        if isinstance(ids, list) and ids:
            return str(ids[-1])
        name = serialized.get("name")
        if isinstance(name, str) and name:
            return name
    return fallback


def _stringify_run_id(run_id: Any) -> Optional[str]:
    """LangChain may pass run_id as ``UUID`` or ``str``. Normalise."""
    if run_id is None:
        return None
    if isinstance(run_id, UUID):
        return str(run_id)
    return str(run_id)


def _parse_llm_result(response: Any) -> dict[str, Any]:
    """Extract token usage + model from a LangChain ``LLMResult`` shape.

    Tolerates dict / object / partial — never raises.
    """
    llm_output = (
        response.get("llm_output")
        if isinstance(response, dict)
        else getattr(response, "llm_output", None)
    )
    if not isinstance(llm_output, dict):
        return {}
    token_usage = llm_output.get("token_usage") or llm_output.get("tokenUsage")
    out: dict[str, Any] = {}
    if isinstance(token_usage, dict):
        prompt = token_usage.get("prompt_tokens") or token_usage.get("promptTokens") or 0
        completion = (
            token_usage.get("completion_tokens") or token_usage.get("completionTokens") or 0
        )
        total = (
            token_usage.get("total_tokens")
            or token_usage.get("totalTokens")
            or ((prompt or 0) + (completion or 0))
        )
        out["prompt_tokens"] = int(prompt)
        out["completion_tokens"] = int(completion)
        out["total_tokens"] = int(total)
    model_name = llm_output.get("model_name") or llm_output.get("modelName")
    if isinstance(model_name, str):
        out["metadata"] = {"model": model_name}
    return out


class SpanlensCallbackHandler(_LCBase):  # type: ignore[valid-type,misc]
    """LangChain-compatible callback handler that records LLM, chain, tool,
    and retriever spans to Spanlens.

    Attach to any LangChain chain, LLM, agent, or LangGraph compiled graph via
    the standard ``callbacks=[handler]`` configuration. Concurrent runs are
    tracked by LangChain's per-run UUIDs, so a single handler instance is safe
    to share across parallel invocations.

    Args:
        client: Spanlens client instance.
        trace: Optional pre-existing trace to attach all spans to. When given,
            ``trace.end()`` is NOT called — the caller owns the lifecycle.
            When omitted, a trace is created on the first start-event and
            closed when the root-level run ends.
        trace_name: Name for auto-created traces. Defaults to ``"langchain_run"``.
        capture_chains: Capture chain (LangGraph node, LCEL step) spans.
            Defaults to ``True``.
        capture_tools: Capture tool call spans. Defaults to ``True``.
        capture_retrieval: Capture retriever spans. Defaults to ``True``.
        max_input_bytes: Max bytes to keep in ``span.input``. Larger payloads
            are replaced with a truncation marker dict. Default 16 KB.
        max_output_bytes: Same as above for ``span.output``. Default 16 KB.
    """

    # LangChain BaseCallbackHandler checks these class attributes to decide
    # whether to call certain hooks. Default to True for everything we
    # implement; the per-event capture flags handle finer opt-out.
    raise_error: bool = False
    run_inline: bool = True
    ignore_llm: bool = False
    ignore_chat_model: bool = False
    ignore_chain: bool = False
    ignore_agent: bool = False
    ignore_retriever: bool = False
    ignore_custom_event: bool = False

    def __init__(
        self,
        client: SpanlensClient,
        *,
        trace: Optional[TraceHandle] = None,
        trace_name: str = "langchain_run",
        capture_chains: bool = True,
        capture_tools: bool = True,
        capture_retrieval: bool = True,
        max_input_bytes: int = _DEFAULT_MAX_INPUT_BYTES,
        max_output_bytes: int = _DEFAULT_MAX_OUTPUT_BYTES,
    ) -> None:
        # _LCBase.__init__() may be object.__init__() which takes no args.
        super().__init__()  # type: ignore[misc]
        self._client = client
        self._external_trace = trace
        self._trace_name = trace_name
        self._capture_chains = capture_chains
        self._capture_tools = capture_tools
        self._capture_retrieval = capture_retrieval
        self._max_input_bytes = max_input_bytes
        self._max_output_bytes = max_output_bytes

        # run_id (str) → {span, root_of_local_trace}
        self._runs: dict[str, dict[str, Any]] = {}
        # Lazy local trace — created on first start when no external trace.
        self._local_trace: Optional[TraceHandle] = None

    # ── Internal helpers ───────────────────────────────────────────────

    def _get_trace(self) -> TraceHandle:
        if self._external_trace is not None:
            return self._external_trace
        if self._local_trace is not None:
            return self._local_trace
        self._local_trace = self._client.start_trace(self._trace_name)
        return self._local_trace

    def _start_span(
        self,
        run_id: Any,
        parent_run_id: Any,
        name: str,
        span_type: str,
        input_value: Any,
    ) -> None:
        run_id_s = _stringify_run_id(run_id)
        if run_id_s is None or run_id_s in self._runs:
            return  # idempotent: defensive against duplicate start
        parent_run_id_s = _stringify_run_id(parent_run_id)
        parent_record = self._runs.get(parent_run_id_s) if parent_run_id_s else None
        was_root_before = self._external_trace is None and self._local_trace is None
        trace = self._get_trace()
        is_root = parent_record is None

        trimmed_input = (
            _truncate(input_value, self._max_input_bytes) if input_value is not None else _OMIT
        )

        kwargs: dict[str, Any] = {"span_type": span_type}
        if trimmed_input is not _OMIT:
            kwargs["input"] = trimmed_input

        span: SpanHandle = (
            trace.span(name, **kwargs) if is_root else parent_record["span"].child(name, **kwargs)
        )

        self._runs[run_id_s] = {
            "span": span,
            "root_of_local_trace": is_root and was_root_before and self._external_trace is None,
        }

    def _end_span(
        self,
        run_id: Any,
        *,
        status: str = "completed",
        output: Any = _OMIT,
        error_message: Optional[str] = None,
        extra: Optional[dict[str, Any]] = None,
    ) -> None:
        run_id_s = _stringify_run_id(run_id)
        if run_id_s is None:
            return
        record = self._runs.pop(run_id_s, None)
        if record is None:
            return  # orphan end — silent

        end_kwargs: dict[str, Any] = {"status": status}
        if output is not _OMIT:
            end_kwargs["output"] = output
        if error_message is not None:
            end_kwargs["error_message"] = error_message
        if extra:
            # Pulled out so token counts + metadata go through the typed kwargs
            # path on span.end() rather than getting dropped.
            if "prompt_tokens" in extra:
                end_kwargs["prompt_tokens"] = extra["prompt_tokens"]
            if "completion_tokens" in extra:
                end_kwargs["completion_tokens"] = extra["completion_tokens"]
            if "total_tokens" in extra:
                end_kwargs["total_tokens"] = extra["total_tokens"]
            if "metadata" in extra:
                end_kwargs["metadata"] = extra["metadata"]

        record["span"].end(**end_kwargs)

        if record["root_of_local_trace"]:
            trace = self._get_trace()
            trace.end(status=("error" if status == "error" else "completed"))
            self._local_trace = None

    # ── LLM hooks ──────────────────────────────────────────────────────

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        self._start_span(
            run_id, parent_run_id, f"llm.{_short_name(serialized, 'call')}", "llm", prompts
        )

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        self._start_span(
            run_id, parent_run_id, f"llm.{_short_name(serialized, 'call')}", "llm", messages
        )

    def on_llm_end(self, response: Any, *, run_id: Any, **_: Any) -> None:
        parsed = _parse_llm_result(response)
        output_text: Any = _OMIT
        generations = (
            response.get("generations")
            if isinstance(response, dict)
            else getattr(response, "generations", None)
        )
        try:
            text = (
                generations[0][0].get("text")
                if isinstance(generations[0][0], dict)
                else getattr(generations[0][0], "text", None)
            )
        except (TypeError, IndexError, AttributeError):
            text = None
        if isinstance(text, str):
            trimmed = _truncate(text, self._max_output_bytes)
            output_text = trimmed
        self._end_span(run_id, status="completed", output=output_text, extra=parsed)

    def on_llm_error(self, error: BaseException, *, run_id: Any, **_: Any) -> None:
        self._end_span(run_id, status="error", error_message=str(error))

    # ── Chain hooks ────────────────────────────────────────────────────

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: Any,
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        if not self._capture_chains:
            return
        self._start_span(
            run_id, parent_run_id, f"chain.{_short_name(serialized, 'run')}", "custom", inputs
        )

    def on_chain_end(self, outputs: Any, *, run_id: Any, **_: Any) -> None:
        if not self._capture_chains:
            return
        trimmed = _truncate(outputs, self._max_output_bytes) if outputs is not None else _OMIT
        self._end_span(run_id, status="completed", output=trimmed)

    def on_chain_error(self, error: BaseException, *, run_id: Any, **_: Any) -> None:
        if not self._capture_chains:
            return
        self._end_span(run_id, status="error", error_message=str(error))

    # ── Tool hooks ─────────────────────────────────────────────────────

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        if not self._capture_tools:
            return
        self._start_span(
            run_id, parent_run_id, f"tool.{_short_name(serialized, 'call')}", "tool", input_str
        )

    def on_tool_end(self, output: Any, *, run_id: Any, **_: Any) -> None:
        if not self._capture_tools:
            return
        trimmed = _truncate(output, self._max_output_bytes) if output is not None else _OMIT
        self._end_span(run_id, status="completed", output=trimmed)

    def on_tool_error(self, error: BaseException, *, run_id: Any, **_: Any) -> None:
        if not self._capture_tools:
            return
        self._end_span(run_id, status="error", error_message=str(error))

    # ── Retriever hooks ────────────────────────────────────────────────

    def on_retriever_start(
        self,
        serialized: dict[str, Any],
        query: str,
        *,
        run_id: Any,
        parent_run_id: Any = None,
        **_: Any,
    ) -> None:
        if not self._capture_retrieval:
            return
        self._start_span(
            run_id,
            parent_run_id,
            f"retrieval.{_short_name(serialized, 'query')}",
            "retrieval",
            query,
        )

    def on_retriever_end(self, documents: Any, *, run_id: Any, **_: Any) -> None:
        if not self._capture_retrieval:
            return
        # Summarise documents to keep output readable.
        summary: list[dict[str, Any]] = []
        if isinstance(documents, list):
            for d in documents:
                if isinstance(d, dict):
                    summary.append(
                        {
                            "page_content": d.get("page_content") or d.get("pageContent"),
                            "metadata": d.get("metadata"),
                        }
                    )
                else:
                    summary.append(
                        {
                            "page_content": getattr(d, "page_content", None),
                            "metadata": getattr(d, "metadata", None),
                        }
                    )
        trimmed = _truncate(summary, self._max_output_bytes)
        self._end_span(run_id, status="completed", output=trimmed)

    def on_retriever_error(self, error: BaseException, *, run_id: Any, **_: Any) -> None:
        if not self._capture_retrieval:
            return
        self._end_span(run_id, status="error", error_message=str(error))


__all__ = ["SpanlensCallbackHandler"]
