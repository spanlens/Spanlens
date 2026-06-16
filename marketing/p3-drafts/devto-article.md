# P3-18: dev.to article

**Submit URL**: https://dev.to/new
**Cover image suggestion**: simple branded card (1000x420)
**Tags** (max 4): `llm`, `observability`, `opensource`, `nextjs`
**Canonical URL**: leave blank (this is the canonical; Medium repost later)

---

**Title**: We Were Burning $4K/mo on OpenAI and Couldn't Tell Why

---

**Body** (markdown):

A few months back, our OpenAI bill jumped from $1,200/mo to $4,000/mo over three weeks. We hadn't shipped a new feature. Traffic was flat. The bill just… climbed.

Trying to debug it from the OpenAI dashboard was painful. We could see total daily spend, but not per-customer, not per-endpoint, not per-prompt-version. The spreadsheet I'd kludged together to track this stuff was three weeks behind.

That's the gap I started building Spanlens to fill.

## What I actually wanted to see

When I described the dashboard I wished I had, three things kept coming up:

1. **Per-customer cost**. Who's burning the budget? Sometimes the answer is "one user with a stuck retry loop." You can't fix it if you can't see it.
2. **Per-prompt-version cost**. Did v8 of our extraction prompt accidentally double the average output tokens? Without versioned tracking, you find out the next time you look at the bill.
3. **Cost-per-call with the model variant** — not just "GPT-4o" but the exact dated variant the API returns (`gpt-4o-2024-08-06`), because the prices for the variants drift over time.

The existing observability tools captured some of this but none captured all of it without a meaningful integration effort. Langfuse needed me to wrap every chain in their SDK. Helicone's proxy approach was right but the company quietly entered maintenance mode after the 2026 Mintlify acquisition.

## The thing I missed most: one line to integrate

Every observability tool's marketing page says "one-line setup." Almost none deliver. With most, you swap your SDK import for theirs, then you also wrap your chain, then you also configure callbacks, then you also set environment variables.

The proxy pattern is the only one that's actually one line. You change your `baseURL`:

```ts
const openai = new OpenAI({
  baseURL: 'https://api.spanlens.io/proxy/openai/v1',
  apiKey: process.env.SPANLENS_API_KEY,
})
```

Every call your app makes — chat completions, embeddings, vision, streaming, tool use — goes through Spanlens, which logs it and forwards to OpenAI. The original SDK stays unchanged. Streaming responses pass through via `body.tee()` so they reach your client with no buffering.

## What ended up surprising me about building this

A few engineering things that I didn't expect to matter and ended up being important:

**Streaming usage data is in a different place per provider.** OpenAI puts it in the final chunk's `usage` field. Anthropic puts it in a `message_delta` event mid-stream. Gemini puts it in the final `candidates` field. We have three separate stream parsers because we can't pretend they're the same shape.

**Cost calculation needs to match the dated model variant in the response, not the model alias you sent.** OpenAI returns `gpt-4o-2024-08-06` even if you sent `gpt-4o`. If you price-lookup against `gpt-4o` you get a stale price after a model refresh.

**Provider keys must never appear in logs.** AES-256-GCM encrypted at rest, decrypted only at proxy time, immediately discarded after the upstream call. The decryption key is environment-only. If you mishandle this, you don't get to ship to anyone serious.

**ClickHouse `DateTime64` rejects ISO strings with `Z`.** It expects space-separated, no Z. You discover this when production ingest silently fails and you can't figure out why for two days. Capture it in a helper and never use `toISOString()` directly.

## Did the bill come down?

For the workload that triggered all this: yes, by 47%. We found that:

- One classification prompt was using GPT-4o when GPT-4o-mini would have done the same job at 15x lower cost
- One customer had a retry loop that was firing 8x per logical request because of a structured-output parse failure
- Two prompt versions were silently doubling output tokens due to an instruction we'd left in

None of that was visible from the OpenAI dashboard. It became visible the first day we instrumented.

## Try it

Spanlens is open source, MIT licensed. Repo: https://github.com/spanlens/Spanlens. Hosted plans at https://www.spanlens.io. Self-host with one `docker compose up`.

If you're staring at your own bill wondering where the money went, this is the workflow that worked for me. Hope it's useful.

---

*Cross-posted to Medium.*
