"""LlamaIndex Python callback handler for Spanlens tracing.

Records LLM / retrieval / embedding / tool / agent spans from any LlamaIndex
query engine, agent, or workflow. The handler subclasses
``llama_index.core.callbacks.BaseCallbackHandler`` when LlamaIndex is
installed; otherwise it falls back to a plain class that exposes the same
methods so unit tests can drive it without LlamaIndex being on the path.

Unlike LangChain (which has a per-event method on the base class), LlamaIndex
funnels everything through ``on_event_start`` / ``on_event_end`` and uses a
``CBEventType`` enum to discriminate. This handler maps each event type to a
Spanlens span type so the resulting trace tree mirrors the query topology
1:1 — QUERY span at the root, RETRIEVE / SYNTHESIZE / LLM / etc. underneath.

Example::

    from spanlens import SpanlensClient
    from spanlens.integrations.llama_index import SpanlensCallbackHandler
    from llama_index.core import Settings, VectorStoreIndex

    client = SpanlensClient(api_key=os.environ["SPANLENS_API_KEY"])
    handler = SpanlensCallbackHandler(client=client)

    Settings.callback_manager.add_handler(handler)

    index = VectorStoreIndex.from_documents(documents)
    query_engine = index.as_query_engine()
    response = query_engine.query("What is RAG?")
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Optional

from ..client import SpanlensClient
from ..span import SpanHandle
from ..trace import TraceHandle

if TYPE_CHECKING:  # pragma: no cover - type-only
    pass


# Try to subclass LlamaIndex's BaseCallbackHandler when it's available so
# the framework's callback manager dispatches into us correctly. Falls back
# to a plain object base class so the handler is testable without LlamaIndex
# installed and so we don't add llama-index as a hard dependency.
try:
    from llama_index.core.callbacks.base_handler import (  # type: ignore[import-not-found]
        BaseCallbackHandler as _LIBase,
    )
    from llama_index.core.callbacks.schema import (  # type: ignore[import-not-found]
        CBEventType,
        EventPayload,
    )

    _LLAMA_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised via the fallback test
    _LIBase = object  # type: ignore[assignment,misc]

    # Mirror the enum values we care about so the handler is still usable
    # via duck-typing in unit tests that pass string literals.
    class CBEventType(str):  # type: ignore[no-redef]
        CHUNKING = "chunking"
        NODE_PARSING = "node_parsing"
        EMBEDDING = "embedding"
        LLM = "llm"
        QUERY = "query"
        RETRIEVE = "retrieve"
        SYNTHESIZE = "synthesize"
        TREE = "tree"
        SUB_QUESTION = "sub_question"
        TEMPLATING = "templating"
        FUNCTION_CALL = "function_call"
        RERANKING = "reranking"
        EXCEPTION = "exception"
        AGENT_STEP = "agent_step"

    class EventPayload(str):  # type: ignore[no-redef]
        MESSAGES = "messages"
        PROMPT = "formatted_prompt"
        COMPLETION = "completion"
        RESPONSE = "response"
        QUERY_STR = "query_str"
        NODES = "nodes"
        EMBEDDINGS = "embeddings"
        TOP_K = "top_k"
        MODEL_NAME = "model_name"
        FUNCTION_CALL = "function_call"
        FUNCTION_OUTPUT = "function_call_response"
        TOOL = "tool"
        EXCEPTION = "exception"

    _LLAMA_AVAILABLE = False


_DEFAULT_MAX_INPUT_BYTES = 16_384
_DEFAULT_MAX_OUTPUT_BYTES = 16_384

# CBEventType → Spanlens span_type. Anything not in this map falls through
# to 'custom' so we don't lose visibility on framework events we haven't
# explicitly handled yet.
_EVENT_TYPE_TO_SPAN_TYPE: dict[str, str] = {
    "llm": "llm",
    "embedding": "embedding",
    "retrieve": "retrieval",
    "reranking": "retrieval",
    "function_call": "tool",
    "agent_step": "custom",
    "query": "custom",
    "synthesize": "custom",
    "sub_question": "custom",
    "templating": "custom",
    "chunking": "custom",
    "node_parsing": "custom",
    "tree": "custom",
    "exception": "custom",
}

# Events that don't add useful trace information by default. Users can
# override via the ``event_starts_to_ignore`` / ``event_ends_to_ignore``
# constructor arguments. TEMPLATING and CHUNKING are noisy preparation
# steps; ignoring them shrinks the span tree to the meaningful work.
_DEFAULT_IGNORED_EVENTS: tuple[str, ...] = (
    "chunking",
    "node_parsing",
    "templating",
)


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
        "original_bytes": len(encoded),
    }


def _extract_input(event_type: str, payload: Optional[dict[str, Any]]) -> Any:
    """Pick the most informative input from a LlamaIndex event payload.

    LlamaIndex payloads vary by event type — pull what the user will want
    to see in the dashboard. Returns ``None`` to skip recording input when
    no useful data is available.
    """
    if not payload:
        return None
    # LLM events carry messages or a formatted prompt
    if "messages" in payload:
        return payload["messages"]
    if "formatted_prompt" in payload:
        return payload["formatted_prompt"]
    # QUERY / RETRIEVE / RERANKING carry the query string
    if "query_str" in payload:
        return payload["query_str"]
    # FUNCTION_CALL carries the call signature
    if "function_call" in payload:
        return payload["function_call"]
    if "tool" in payload:
        return payload["tool"]
    if event_type == "embedding" and "embeddings" in payload:
        # Don't dump entire embedding vectors into the trace; just record count
        embs = payload["embeddings"]
        try:
            return {"embedding_count": len(embs)}
        except TypeError:
            return None
    return None


def _extract_output(event_type: str, payload: Optional[dict[str, Any]]) -> Any:
    """Pick the most informative output from a LlamaIndex event end payload."""
    if not payload:
        return None
    if "response" in payload:
        return payload["response"]
    if "completion" in payload:
        return payload["completion"]
    if "function_call_response" in payload:
        return payload["function_call_response"]
    if "nodes" in payload:
        # Retrieved nodes — record count + top scores rather than full text
        nodes = payload["nodes"]
        try:
            out: dict[str, Any] = {"node_count": len(nodes)}
            scores = []
            for n in nodes[:5]:
                score = getattr(n, "score", None)
                if score is not None:
                    scores.append(float(score))
            if scores:
                out["top_scores"] = scores
            return out
        except (TypeError, AttributeError):
            return None
    return None


def _extract_llm_usage(payload: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Extract token counts + model from an LLM event payload.

    Tolerates the several response shapes LlamaIndex exposes (LiteLLM, OpenAI,
    Anthropic, ...) without raising. Returns a dict suitable for spreading
    into ``SpanHandle.end()``.
    """
    out: dict[str, Any] = {}
    if not payload:
        return out

    # Model name lives at payload[MODEL_NAME] in some LlamaIndex versions
    # and on the response object's `raw` in others.
    model_name = payload.get("model_name")

    # Token usage is buried under response.raw.usage for OpenAI-compatible
    # backends or response.additional_kwargs for others. We dig defensively.
    response = payload.get("response") or payload.get("completion")
    usage: dict[str, Any] = {}
    if response is not None:
        # Try response.raw.usage (OpenAI-style)
        raw = getattr(response, "raw", None)
        if isinstance(raw, dict):
            usage = raw.get("usage") or {}
            model_name = model_name or raw.get("model")
        elif raw is not None:
            usage_obj = getattr(raw, "usage", None)
            if usage_obj is not None:
                # Pydantic models expose .model_dump() / .dict()
                if hasattr(usage_obj, "model_dump"):
                    usage = usage_obj.model_dump()
                elif hasattr(usage_obj, "dict"):
                    usage = usage_obj.dict()  # type: ignore[assignment]
                else:
                    usage = {
                        "prompt_tokens": getattr(usage_obj, "prompt_tokens", 0),
                        "completion_tokens": getattr(usage_obj, "completion_tokens", 0),
                        "total_tokens": getattr(usage_obj, "total_tokens", 0),
                    }
            model_name = model_name or getattr(raw, "model", None)

    if usage:
        prompt = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
        completion = usage.get("completion_tokens") or usage.get("output_tokens") or 0
        total = usage.get("total_tokens") or (int(prompt) + int(completion))
        out["prompt_tokens"] = int(prompt)
        out["completion_tokens"] = int(completion)
        out["total_tokens"] = int(total)

    if isinstance(model_name, str):
        out["metadata"] = {"model": model_name}

    return out


class SpanlensCallbackHandler(_LIBase):  # type: ignore[valid-type,misc]
    """LlamaIndex-compatible callback handler that records LLM, retrieval,
    embedding, tool, and agent spans to Spanlens.

    Attach via ``Settings.callback_manager.add_handler(handler)`` (global) or
    by passing through the ``callback_manager`` argument when constructing a
    query engine / agent. Concurrent runs are tracked by LlamaIndex's
    per-event UUIDs, so a single handler instance is safe to share across
    parallel invocations of the same client.

    Args:
        client: Spanlens client instance.
        trace: Optional pre-existing trace to attach all spans to. When given,
            ``trace.end()`` is NOT called — the caller owns the lifecycle.
            When omitted, a new trace is created on each ``start_trace`` call
            and closed on the matching ``end_trace``.
        trace_name: Name for auto-created traces. Defaults to ``"llama_index_run"``.
        event_starts_to_ignore: CBEventType values whose start events should
            be skipped. Defaults to ``("chunking", "node_parsing",
            "templating")`` to filter out preparation noise. Pass an empty
            list to record everything.
        event_ends_to_ignore: Same as above, for end events. Defaults to the
            same set so the ignored events are silent in both directions.
        max_input_bytes: Max bytes to keep in ``span.input``. Larger payloads
            are replaced with a truncation marker dict. Default 16 KB.
        max_output_bytes: Same as above for ``span.output``. Default 16 KB.
    """

    def __init__(
        self,
        client: SpanlensClient,
        *,
        trace: Optional[TraceHandle] = None,
        trace_name: str = "llama_index_run",
        event_starts_to_ignore: Optional[list[str]] = None,
        event_ends_to_ignore: Optional[list[str]] = None,
        max_input_bytes: int = _DEFAULT_MAX_INPUT_BYTES,
        max_output_bytes: int = _DEFAULT_MAX_OUTPUT_BYTES,
    ) -> None:
        starts = (
            event_starts_to_ignore
            if event_starts_to_ignore is not None
            else list(_DEFAULT_IGNORED_EVENTS)
        )
        ends = (
            event_ends_to_ignore
            if event_ends_to_ignore is not None
            else list(_DEFAULT_IGNORED_EVENTS)
        )

        # When LlamaIndex is available the base class wants the ignore lists.
        # When it's not, we still need to keep them around for our own filter.
        if _LLAMA_AVAILABLE:
            super().__init__(  # type: ignore[call-arg]
                event_starts_to_ignore=starts,  # type: ignore[arg-type]
                event_ends_to_ignore=ends,  # type: ignore[arg-type]
            )
        else:
            super().__init__()  # type: ignore[misc]

        self._client = client
        self._external_trace = trace
        self._trace_name = trace_name
        self._event_starts_to_ignore = tuple(starts)
        self._event_ends_to_ignore = tuple(ends)
        self._max_input_bytes = max_input_bytes
        self._max_output_bytes = max_output_bytes

        # event_id (str) → SpanHandle. Concurrent runs are safe because
        # LlamaIndex hands out unique UUIDs per event.
        self._spans: dict[str, SpanHandle] = {}
        # Local trace — created on start_trace when no external trace.
        self._local_trace: Optional[TraceHandle] = None

    # ── Internal helpers ───────────────────────────────────────────────

    def _active_trace(self) -> Optional[TraceHandle]:
        return self._external_trace or self._local_trace

    # ── LlamaIndex callback API ───────────────────────────────────────

    def on_event_start(  # noqa: D401 - inherited contract
        self,
        event_type: Any,
        payload: Optional[dict[str, Any]] = None,
        event_id: str = "",
        parent_id: str = "",
        **kwargs: Any,
    ) -> str:
        """Called when LlamaIndex starts a new event (LLM call, retrieval, etc.)."""
        # Normalise the enum value to a string so we can branch on it.
        event_value = (
            event_type.value if hasattr(event_type, "value") else str(event_type)
        )
        if event_value in self._event_starts_to_ignore:
            return event_id

        trace = self._active_trace()
        if trace is None:
            # No active trace — LlamaIndex sometimes fires events before the
            # outermost start_trace (e.g. embedding documents at index time).
            # Lazy-create a local trace so we still capture the work.
            self._local_trace = self._client.start_trace(self._trace_name)
            trace = self._local_trace

        span_type = _EVENT_TYPE_TO_SPAN_TYPE.get(event_value, "custom")
        name = f"llama_index.{event_value}"
        input_value = _extract_input(event_value, payload)

        # Parent linkage: LlamaIndex may pass parent_id as the root sentinel
        # "root" (BASE_TRACE_EVENT) for top-level events. Treat any unknown
        # parent_id as "attach to trace root".
        parent_span = self._spans.get(parent_id) if parent_id else None

        span_kwargs: dict[str, Any] = {"span_type": span_type}
        if input_value is not None:
            span_kwargs["input"] = _truncate(input_value, self._max_input_bytes)

        if parent_span is not None:
            span: SpanHandle = parent_span.child(name, **span_kwargs)
        else:
            span = trace.span(name, **span_kwargs)

        if event_id:
            self._spans[event_id] = span
        return event_id

    def on_event_end(
        self,
        event_type: Any,
        payload: Optional[dict[str, Any]] = None,
        event_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Called when LlamaIndex finishes an event."""
        event_value = (
            event_type.value if hasattr(event_type, "value") else str(event_type)
        )
        if event_value in self._event_ends_to_ignore:
            return

        span = self._spans.pop(event_id, None)
        if span is None:
            return  # start was ignored or out-of-order

        end_kwargs: dict[str, Any] = {}

        # Surface exceptions as error spans with the message on metadata.
        exception = (payload or {}).get("exception") if payload else None
        if exception is not None:
            end_kwargs["status"] = "error"
            end_kwargs["error_message"] = str(exception)
        else:
            end_kwargs["status"] = "completed"

        output_value = _extract_output(event_value, payload)
        if output_value is not None:
            end_kwargs["output"] = _truncate(output_value, self._max_output_bytes)

        if event_value == "llm":
            usage = _extract_llm_usage(payload)
            for key, value in usage.items():
                # `metadata` is a dict we want to merge, not overwrite.
                if key == "metadata":
                    existing = end_kwargs.get("metadata") or {}
                    existing.update(value)
                    end_kwargs["metadata"] = existing
                else:
                    end_kwargs[key] = value

        span.end(**end_kwargs)

    def start_trace(self, trace_id: Optional[str] = None) -> None:
        """Called by LlamaIndex when an overall trace begins.

        Creates a Spanlens trace if none is active. If the caller passed in
        an ``external_trace`` to the constructor, this is a no-op — the
        caller manages that trace's lifecycle.

        The ``trace_id`` argument is LlamaIndex's internal identifier (often
        ``"query"`` or a UUID) and is intentionally not used as the trace
        name — the dashboard would show opaque IDs otherwise. We stash it on
        metadata so it's still searchable.
        """
        if self._external_trace is not None:
            return
        if self._local_trace is not None:
            # Nested start — LlamaIndex sometimes calls start_trace inside
            # an already-open trace. Keep the outer one.
            return
        metadata = {"llama_index_trace_id": trace_id} if trace_id else None
        self._local_trace = self._client.start_trace(self._trace_name, metadata=metadata)

    def end_trace(
        self,
        trace_id: Optional[str] = None,
        trace_map: Optional[dict[str, list[str]]] = None,
    ) -> None:
        """Called by LlamaIndex when the overall trace exits."""
        del trace_id, trace_map  # parameters required by the protocol, unused
        if self._external_trace is not None:
            return  # caller owns the lifecycle
        if self._local_trace is None:
            return
        # Make sure any spans left open get a `status` before the trace closes.
        for span in list(self._spans.values()):
            try:
                span.end(status="completed")
            except Exception:  # pragma: no cover - defensive
                pass
        self._spans.clear()
        self._local_trace.end(status="completed")
        self._local_trace = None
