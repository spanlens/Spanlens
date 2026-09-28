"""The provider helpers against the real ``openai`` and ``anthropic`` SDKs.

Most tests feed the helpers hand-built responses. These go through the
installed provider SDK end to end: ``create_*()`` builds the client,
``observe_*()`` wraps the call, the SDK sends a real HTTP request (answered
by respx through ``tests/_provider_http.py``) and parses a real response
model. A provider major release that changes URLs, headers, response models
or stream objects fails here rather than in a user's app. ``openai`` 3 and
``anthropic`` 1, for example, replaced ``httpx`` with ``httpx2``.

The tests run against whichever versions are installed. The release
workflow installs the newest ones.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from types import ModuleType
from typing import Any, Callable

import httpx
import pytest
import respx

from spanlens import SpanlensClient, observe_anthropic, observe_openai
from spanlens.integrations.anthropic import create_anthropic, create_async_anthropic
from spanlens.integrations.openai import create_async_openai, create_openai

BASE_URL = "https://test.spanlens.local"
OPENAI_PROXY = f"{BASE_URL}/proxy/openai/v1"
ANTHROPIC_PROXY = f"{BASE_URL}/proxy/anthropic"
PROXY_KEY = "sl_test_proxy_key"
MESSAGES = [{"role": "user", "content": "hi"}]

CHAT_COMPLETION = {
    "id": "chatcmpl-1",
    "object": "chat.completion",
    "created": 1,
    "model": "gpt-4o-mini",
    "choices": [
        {
            "index": 0,
            "finish_reason": "stop",
            "message": {"role": "assistant", "content": "hello back"},
        }
    ],
    "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
}

RESPONSE = {
    "id": "resp_1",
    "object": "response",
    "created_at": 1,
    "model": "gpt-4o-mini",
    "status": "completed",
    "output": [
        {
            "type": "message",
            "id": "msg_1",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": "hello back", "annotations": []}],
        }
    ],
    "parallel_tool_calls": True,
    "tool_choice": "auto",
    "tools": [],
    "usage": {
        "input_tokens": 3,
        "output_tokens": 4,
        "total_tokens": 7,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens_details": {"reasoning_tokens": 0},
    },
}

MESSAGE = {
    "id": "msg_1",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-5",
    "content": [{"type": "text", "text": "hello back"}],
    "stop_reason": "end_turn",
    "stop_sequence": None,
    "usage": {"input_tokens": 9, "output_tokens": 4},
}


@pytest.fixture
def openai_sdk() -> ModuleType:
    return pytest.importorskip("openai")


@pytest.fixture
def anthropic_sdk() -> ModuleType:
    return pytest.importorskip("anthropic")


def _mock_ingest() -> respx.Route:
    """Mock every ingest endpoint and return the span PATCH route."""
    ok = httpx.Response(200, json={})
    respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=ok)
    respx.post(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")).mock(
        return_value=ok
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(return_value=ok)
    return respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")).mock(
        return_value=ok
    )


def _span_end(route: respx.Route) -> dict[str, Any]:
    bodies = [json.loads(call.request.content) for call in route.calls]
    ends = [body for body in bodies if "status" in body]
    assert len(ends) == 1, bodies
    return ends[0]


def _spanlens() -> SpanlensClient:
    return SpanlensClient(api_key="sl_test_ingest", base_url=BASE_URL, silent=False)


def _sse(events: list[tuple[str, Any]]) -> httpx.Response:
    """A ``text/event-stream`` response. An empty event name omits the
    ``event:`` line, as OpenAI does."""
    chunks = []
    for event, data in events:
        payload = data if isinstance(data, str) else json.dumps(data)
        prefix = f"event: {event}\n" if event else ""
        chunks.append(f"{prefix}data: {payload}\n\n")
    return httpx.Response(
        200, headers={"content-type": "text/event-stream"}, content="".join(chunks).encode()
    )


def _assert_linked(request: httpx.Request, trace_id: str) -> None:
    """The proxy links its request row to the span through these headers."""
    assert request.headers["x-trace-id"] == trace_id
    assert request.headers["x-span-id"]
    assert request.headers["x-spanlens-prompt-version"] == "greeter@2"
    assert request.headers["x-spanlens-log-body"] == "full"


# ── OpenAI ──────────────────────────────────────────────────────


@respx.mock
def test_openai_chat_completion_is_proxied_and_traced(
    openai_sdk: ModuleType, provider_http_client: Callable[..., Any]
) -> None:
    span_patch = _mock_ingest()
    upstream = respx.post(f"{OPENAI_PROXY}/chat/completions").mock(
        return_value=httpx.Response(200, json=CHAT_COMPLETION)
    )
    client = create_openai(
        api_key=PROXY_KEY,
        base_url=OPENAI_PROXY,
        max_retries=0,
        http_client=provider_http_client(openai_sdk),
    )

    with _spanlens() as spanlens, spanlens.start_trace("compat") as trace:
        res = observe_openai(
            trace,
            "chat",
            lambda headers: client.chat.completions.create(
                model="gpt-4o-mini", messages=MESSAGES, extra_headers=headers
            ),
            prompt_version="greeter@2",
            log_body="full",
        )

    assert res.choices[0].message.content == "hello back"
    sent = upstream.calls[0].request
    assert sent.headers["authorization"] == f"Bearer {PROXY_KEY}"
    assert json.loads(sent.content)["messages"] == MESSAGES
    _assert_linked(sent, trace.trace_id)

    end = _span_end(span_patch)
    assert end["status"] == "completed"
    assert (end["prompt_tokens"], end["completion_tokens"], end["total_tokens"]) == (5, 2, 7)
    assert end["metadata"] == {"model": "gpt-4o-mini", "provider": "openai"}
    # The response model is recorded as its JSON view, not a repr.
    assert end["output"]["choices"][0]["message"]["content"] == "hello back"


@respx.mock
async def test_async_openai_chat_completion_is_proxied_and_traced(
    openai_sdk: ModuleType, provider_http_client: Callable[..., Any]
) -> None:
    span_patch = _mock_ingest()
    upstream = respx.post(f"{OPENAI_PROXY}/chat/completions").mock(
        return_value=httpx.Response(200, json=CHAT_COMPLETION)
    )
    client = create_async_openai(
        api_key=PROXY_KEY,
        base_url=OPENAI_PROXY,
        max_retries=0,
        http_client=provider_http_client(openai_sdk, is_async=True),
    )

    with _spanlens() as spanlens, spanlens.start_trace("compat") as trace:
        res = await observe_openai(
            trace,
            "chat",
            lambda headers: client.chat.completions.create(
                model="gpt-4o-mini", messages=MESSAGES, extra_headers=headers
            ),
            prompt_version="greeter@2",
            log_body="full",
        )
    await client.close()

    assert res.choices[0].message.content == "hello back"
    _assert_linked(upstream.calls[0].request, trace.trace_id)
    end = _span_end(span_patch)
    assert end["total_tokens"] == 7
    assert end["output"]["choices"][0]["message"]["content"] == "hello back"


@respx.mock
def test_openai_responses_api_usage_is_parsed(
    openai_sdk: ModuleType, provider_http_client: Callable[..., Any]
) -> None:
    span_patch = _mock_ingest()
    respx.post(f"{OPENAI_PROXY}/responses").mock(return_value=httpx.Response(200, json=RESPONSE))
    client = create_openai(
        api_key=PROXY_KEY,
        base_url=OPENAI_PROXY,
        max_retries=0,
        http_client=provider_http_client(openai_sdk),
    )

    with _spanlens() as spanlens, spanlens.start_trace("compat") as trace:
        observe_openai(
            trace,
            "responses",
            lambda headers: client.responses.create(
                model="gpt-4o-mini", input="hi", extra_headers=headers
            ),
        )

    end = _span_end(span_patch)
    assert (end["prompt_tokens"], end["completion_tokens"], end["total_tokens"]) == (3, 4, 7)
    assert end["metadata"]["model"] == "gpt-4o-mini"


@respx.mock
def test_openai_stream_is_returned_unconsumed(
    openai_sdk: ModuleType, provider_http_client: Callable[..., Any]
) -> None:
    """A stream must reach the caller intact and never be recorded (or
    iterated) as the span output."""
    span_patch = _mock_ingest()
    chunk = {"id": "c1", "object": "chat.completion.chunk", "created": 1, "model": "gpt-4o-mini"}
    respx.post(f"{OPENAI_PROXY}/chat/completions").mock(
        return_value=_sse(
            [
                ("", {**chunk, "choices": [{"index": 0, "delta": {"content": "hel"}}]}),
                ("", {**chunk, "choices": [{"index": 0, "delta": {"content": "lo"}}]}),
                ("", {**chunk, "choices": [], "usage": CHAT_COMPLETION["usage"]}),
                ("", "[DONE]"),
            ]
        )
    )
    client = create_openai(
        api_key=PROXY_KEY,
        base_url=OPENAI_PROXY,
        max_retries=0,
        http_client=provider_http_client(openai_sdk),
    )

    with _spanlens() as spanlens, spanlens.start_trace("compat") as trace:
        stream = observe_openai(
            trace,
            "stream",
            lambda headers: client.chat.completions.create(
                model="gpt-4o-mini",
                messages=MESSAGES,
                stream=True,
                stream_options={"include_usage": True},
                extra_headers=headers,
            ),
        )
        chunks = list(stream)

    assert isinstance(stream, Iterator)
    assert "".join(c.choices[0].delta.content for c in chunks if c.choices) == "hello"
    assert chunks[-1].usage.total_tokens == 7
    end = _span_end(span_patch)
    assert end["status"] == "completed"
    assert "output" not in end


# ── Anthropic ───────────────────────────────────────────────────


@respx.mock
def test_anthropic_message_is_proxied_and_traced(
    anthropic_sdk: ModuleType, provider_http_client: Callable[..., Any]
) -> None:
    span_patch = _mock_ingest()
    upstream = respx.post(f"{ANTHROPIC_PROXY}/v1/messages").mock(
        return_value=httpx.Response(200, json=MESSAGE)
    )
    client = create_anthropic(
        api_key=PROXY_KEY,
        base_url=ANTHROPIC_PROXY,
        max_retries=0,
        http_client=provider_http_client(anthropic_sdk),
    )

    with _spanlens() as spanlens, spanlens.start_trace("compat") as trace:
        msg = observe_anthropic(
            trace,
            "messages",
            lambda headers: client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=64,
                messages=MESSAGES,
                extra_headers=headers,
            ),
            prompt_version="greeter@2",
            log_body="full",
        )

    assert msg.content[0].text == "hello back"
    sent = upstream.calls[0].request
    assert sent.headers["x-api-key"] == PROXY_KEY
    _assert_linked(sent, trace.trace_id)

    end = _span_end(span_patch)
    assert (end["prompt_tokens"], end["completion_tokens"], end["total_tokens"]) == (9, 4, 13)
    assert end["metadata"] == {"model": "claude-sonnet-4-5", "provider": "anthropic"}
    assert end["output"]["content"][0]["text"] == "hello back"


@respx.mock
async def test_async_anthropic_message_is_proxied_and_traced(
    anthropic_sdk: ModuleType, provider_http_client: Callable[..., Any]
) -> None:
    span_patch = _mock_ingest()
    upstream = respx.post(f"{ANTHROPIC_PROXY}/v1/messages").mock(
        return_value=httpx.Response(200, json=MESSAGE)
    )
    client = create_async_anthropic(
        api_key=PROXY_KEY,
        base_url=ANTHROPIC_PROXY,
        max_retries=0,
        http_client=provider_http_client(anthropic_sdk, is_async=True),
    )

    with _spanlens() as spanlens, spanlens.start_trace("compat") as trace:
        msg = await observe_anthropic(
            trace,
            "messages",
            lambda headers: client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=64,
                messages=MESSAGES,
                extra_headers=headers,
            ),
            prompt_version="greeter@2",
            log_body="full",
        )
    await client.close()

    assert msg.content[0].text == "hello back"
    _assert_linked(upstream.calls[0].request, trace.trace_id)
    end = _span_end(span_patch)
    assert end["total_tokens"] == 13
    assert end["output"]["content"][0]["text"] == "hello back"


@respx.mock
def test_anthropic_stream_is_returned_unconsumed(
    anthropic_sdk: ModuleType, provider_http_client: Callable[..., Any]
) -> None:
    span_patch = _mock_ingest()
    start = {
        **MESSAGE,
        "content": [],
        "stop_reason": None,
        "usage": {"input_tokens": 9, "output_tokens": 1},
    }
    respx.post(f"{ANTHROPIC_PROXY}/v1/messages").mock(
        return_value=_sse(
            [
                ("message_start", {"type": "message_start", "message": start}),
                (
                    "content_block_start",
                    {
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {"type": "text", "text": ""},
                    },
                ),
                (
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": "hello back"},
                    },
                ),
                ("content_block_stop", {"type": "content_block_stop", "index": 0}),
                (
                    "message_delta",
                    {
                        "type": "message_delta",
                        "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                        "usage": {"output_tokens": 4},
                    },
                ),
                ("message_stop", {"type": "message_stop"}),
            ]
        )
    )
    client = create_anthropic(
        api_key=PROXY_KEY,
        base_url=ANTHROPIC_PROXY,
        max_retries=0,
        http_client=provider_http_client(anthropic_sdk),
    )

    with _spanlens() as spanlens, spanlens.start_trace("compat") as trace:
        stream = observe_anthropic(
            trace,
            "stream",
            lambda headers: client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=64,
                messages=MESSAGES,
                stream=True,
                extra_headers=headers,
            ),
        )
        events = list(stream)

    assert isinstance(stream, Iterator)
    assert [e.type for e in events][0] == "message_start"
    assert events[2].delta.text == "hello back"
    end = _span_end(span_patch)
    assert end["status"] == "completed"
    assert "output" not in end
