"""Spanlens — agent tracing, LLM usage capture, and cost observability.

Quick start::

    from spanlens import SpanlensClient

    client = SpanlensClient(api_key="sl_live_...")

    with client.start_trace("rag_pipeline") as trace:
        with trace.span("retrieval", span_type="retrieval") as span:
            docs = retrieve(query)
            span.end(output=docs)

        with trace.span("generation", span_type="llm") as span:
            from openai import OpenAI
            response = OpenAI().chat.completions.create(...)
            span.end(
                output=response.choices[0].message.content,
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                total_tokens=response.usage.total_tokens,
            )

For proxy-mode (zero-code) instrumentation, see
``spanlens.integrations.openai`` / ``anthropic`` / ``gemini``.
"""

from .client import SpanlensClient
from .observe import observe, observe_anthropic, observe_gemini, observe_openai
from .parsers import parse_anthropic_usage, parse_gemini_usage, parse_openai_usage
from .span import SpanHandle
from .trace import TraceHandle

__version__ = "0.1.0"

__all__ = [
    "SpanHandle",
    "SpanlensClient",
    "TraceHandle",
    "__version__",
    "observe",
    "observe_anthropic",
    "observe_gemini",
    "observe_openai",
    "parse_anthropic_usage",
    "parse_gemini_usage",
    "parse_openai_usage",
]
