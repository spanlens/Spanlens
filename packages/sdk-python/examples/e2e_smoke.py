"""End-to-end smoke test for the Spanlens Python SDK.

Run this once after publishing to PyPI to confirm the full loop works:

    1. Spanlens API key authenticates against the live server
    2. The proxy logs a real OpenAI call (visible in /requests)
    3. SDK trace + span records flow into the live ingest endpoint
       (visible in /traces)

Usage::

    export SPANLENS_API_KEY="sl_live_..."   # from your /projects page
    export OPENAI_API_KEY="sk-..."          # your real OpenAI key
    # Optional — only needed when using a non-default Spanlens deployment.
    # export SPANLENS_BASE_URL="https://spanlens-server.vercel.app"

    python examples/e2e_smoke.py

The script prints every request id / trace id / span id that was created
so you can grep for them in the dashboard if anything looks off.
"""

from __future__ import annotations

import os
import sys

# Both keys are required — fail fast with a clear error rather than letting
# the call to OpenAI return a 401.
SPANLENS_API_KEY = os.environ.get("SPANLENS_API_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
SPANLENS_BASE_URL = os.environ.get("SPANLENS_BASE_URL")  # optional

if not SPANLENS_API_KEY:
    print("✗ SPANLENS_API_KEY is not set.", file=sys.stderr)
    print("  Get one from https://www.spanlens.io/projects", file=sys.stderr)
    sys.exit(1)

if not OPENAI_API_KEY:
    print("✗ OPENAI_API_KEY is not set.", file=sys.stderr)
    print("  This is your real OpenAI key (sk-...). It never leaves the", file=sys.stderr)
    print("  Spanlens proxy — but the script still needs it to make a call.", file=sys.stderr)
    sys.exit(1)


def divider(title: str) -> None:
    print()
    print(f"── {title} " + "─" * (60 - len(title)))


# ── 1) Proxy mode — does Spanlens log a real OpenAI call? ────────


def test_proxy_mode() -> str | None:
    divider("1) Proxy mode (create_openai)")
    from spanlens.integrations.openai import create_openai

    # Note: we pass api_key explicitly so the proxy looks up the OpenAI
    # provider key registered against this Spanlens project. The real
    # OPENAI_API_KEY is *not* sent — the server decrypts the stored copy.
    kwargs: dict = {"api_key": SPANLENS_API_KEY}
    if SPANLENS_BASE_URL:
        kwargs["base_url"] = f"{SPANLENS_BASE_URL.rstrip('/')}/proxy/openai/v1"

    client = create_openai(**kwargs)

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Reply with exactly the word 'pong'."},
        ],
        max_tokens=8,
    )

    request_id = getattr(res, "id", None)
    content = res.choices[0].message.content if res.choices else None
    usage = res.usage

    print(f"  OpenAI response id : {request_id}")
    print(f"  Content            : {content!r}")
    print(f"  Tokens             : prompt={usage.prompt_tokens}, "
          f"completion={usage.completion_tokens}, total={usage.total_tokens}")
    print()
    print("  → Visit /requests in the dashboard. The newest row should match.")
    return request_id


# ── 2) SDK tracing mode ─────────────────────────────────────────


def test_sdk_tracing(request_id_from_proxy: str | None) -> tuple[str, list[str]]:
    divider("2) SDK tracing (start_trace + span)")
    from spanlens import SpanlensClient

    client_kwargs: dict = {"api_key": SPANLENS_API_KEY, "silent": False}
    if SPANLENS_BASE_URL:
        client_kwargs["base_url"] = SPANLENS_BASE_URL

    span_ids: list[str] = []

    with SpanlensClient(**client_kwargs) as client:
        with client.start_trace(
            "python-sdk-smoke-test",
            metadata={"source": "examples/e2e_smoke.py", "language": "python"},
        ) as trace:
            print(f"  Trace id : {trace.trace_id}")

            # Plain custom span — no LLM call, just verifies span ingest.
            with trace.span("warm-up", span_type="custom") as span:
                span_ids.append(span.span_id)
                span.end(output={"warm": True}, metadata={"step": 1})

            # LLM span — links the proxied request from step 1 (if any) so
            # the trace view in /traces shows the actual model call.
            with trace.span("llm.gpt-4o-mini", span_type="llm") as span:
                span_ids.append(span.span_id)
                span.end(
                    output="(linked to proxy request)",
                    prompt_tokens=8,
                    completion_tokens=2,
                    total_tokens=10,
                    cost_usd=0.0000015,
                    request_id=request_id_from_proxy,
                    metadata={"model": "gpt-4o-mini"},
                )

            # Trace ends automatically when the with-block exits.

        # Need to drain the background ingest pool before reporting,
        # otherwise the dashboard might not have the rows yet by the time
        # the user clicks over.
        client.close()

    for sid in span_ids:
        print(f"  Span id  : {sid}")
    print()
    print("  → Visit /traces in the dashboard. The newest trace should be")
    print("    'python-sdk-smoke-test' with 2 spans underneath it.")
    return trace.trace_id, span_ids


# ── Run ─────────────────────────────────────────────────────────


def main() -> int:
    try:
        request_id = test_proxy_mode()
    except Exception as e:
        print(f"\n✗ Proxy mode failed: {e}", file=sys.stderr)
        return 1

    try:
        trace_id, span_ids = test_sdk_tracing(request_id)
    except Exception as e:
        print(f"\n✗ SDK tracing failed: {e}", file=sys.stderr)
        return 1

    divider("Summary")
    print(f"  Proxy request id : {request_id or '(unknown)'}")
    print(f"  Trace id         : {trace_id}")
    print(f"  Span ids         : {span_ids}")
    print()
    print("  ✓ Both paths completed without error.")
    print("    Confirm the rows actually landed in the dashboard before")
    print("    declaring victory — the SDK is silent on ingest failures.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
