"""Python examples published on spanlens.io/docs/sdk must actually run.

The "Streaming inside observe()" Python tab once used a signature the SDK
never had (``async with observe(trace, {...}) as span``) and raised
``TypeError`` on the first line. This test pulls the snippet straight out of
``apps/web/app/docs/sdk/page.tsx`` and executes it against a fake OpenAI
streaming client plus respx-mocked ingest, so the page can't drift from the
SDK again. Skipped when the web app is not next to the SDK (e.g. an sdist).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterator

import httpx
import pytest
import respx

from spanlens import SpanlensClient

BASE_URL = "https://test.spanlens.local"
DOCS_PAGE = (
    Path(__file__).resolve().parents[3] / "apps" / "web" / "app" / "docs" / "sdk" / "page.tsx"
)

pytestmark = pytest.mark.skipif(
    not DOCS_PAGE.is_file(), reason="docs page not available outside the monorepo"
)


def _python_tab(anchor_id: str) -> str:
    """Return the ``py={`...`}`` snippet of the first LangTabs after ``anchor_id``."""
    src = DOCS_PAGE.read_text(encoding="utf-8")
    anchor = src.index(f'id="{anchor_id}"')
    start = src.index("py={`", anchor) + len("py={`")
    end = src.index("`}", start)
    snippet = src[start:end]
    assert "${" not in snippet, "JS interpolation inside a Python snippet"
    return snippet


def _chunk(content: str | None = None, usage: Any = None) -> SimpleNamespace:
    choices = [] if content is None else [SimpleNamespace(delta=SimpleNamespace(content=content))]
    return SimpleNamespace(choices=choices, usage=usage)


class _FakeCompletions:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Iterator[SimpleNamespace]:
        self.calls.append(kwargs)
        usage = SimpleNamespace(prompt_tokens=5, completion_tokens=2, total_tokens=7)
        # With stream_options.include_usage the last chunk has no choices.
        return iter([_chunk("Hello"), _chunk(" world"), _chunk(None, usage)])


def _mock_ingest() -> None:
    respx.post(f"{BASE_URL}/ingest/traces").mock(return_value=httpx.Response(200, json={}))
    respx.post(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+/spans$")).mock(
        return_value=httpx.Response(200, json={})
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/spans/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )
    respx.patch(re.compile(rf"^{re.escape(BASE_URL)}/ingest/traces/[\w-]+$")).mock(
        return_value=httpx.Response(200, json={})
    )


def _span_bodies(method: str, fragment: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for route in respx.routes:
        for call in route.calls:
            if call.request.method == method and fragment in str(call.request.url):
                out.append(json.loads(call.request.content.decode()))
    return out


@respx.mock
def test_streaming_inside_observe_python_example_runs() -> None:
    _mock_ingest()
    snippet = _python_tab("observe-streaming")
    completions = _FakeCompletions()
    messages = [{"role": "user", "content": "Summarize"}]

    with SpanlensClient(api_key="sl_test_dummy", base_url=BASE_URL, silent=False) as client:
        with client.start_trace("docs-example") as trace:
            namespace: dict[str, Any] = {
                "trace": trace,
                "messages": messages,
                "openai_client": SimpleNamespace(
                    chat=SimpleNamespace(completions=completions)
                ),
            }
            exec(compile(snippet, "docs/sdk#observe-streaming", "exec"), namespace)

    assert namespace["text"] == "Hello world"
    # The example links the call to the span through the proxy headers.
    headers = completions.calls[0]["extra_headers"]
    assert {"x-trace-id", "x-span-id"} <= set(headers)

    span_post = [b for b in _span_bodies("POST", "/spans") if "span_type" in b][0]
    assert span_post["span_type"] == "llm"
    assert span_post["input"] == messages

    patches = _span_bodies("PATCH", "/ingest/spans/")
    assert any(p.get("total_tokens") == 7 for p in patches)
    assert any(p.get("output") == "Hello world" for p in patches)
