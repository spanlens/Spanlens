# P3-13: HN Show HN post

**Submit URL**: https://news.ycombinator.com/submit
**Title field**: `Show HN: Spanlens – Open-source LLM observability with one-line setup`
**URL field**: `https://www.spanlens.io`
**Text field**: (paste the body below)

---

Hi HN — Haeseong here, building Spanlens (https://www.spanlens.io). It's an open-source (MIT) LLM observability tool. Repo: https://github.com/spanlens/Spanlens.

Why I built it: I was shipping LLM apps and the existing tools felt wrong for a solo dev or small team. Helicone was the closest match (proxy-first) but went quiet after the 2026 Mintlify acquisition. Langfuse is mature but heavy on SDK wrapping, and they keep an ee/ folder gating enterprise security features behind a commercial license. I wanted: one-line integration, all features in OSS, self-hostable with one Docker command, and decisions backed by numbers (not vibes).

What it does:

- baseURL swap or SDK drop-in. Same OpenAI/Anthropic/Gemini surface, every call captured. p99 overhead under 3ms because logging is async and never on the critical path.
- Per-request cost in USD against the live model price table. The bill matches what you see in the dashboard.
- Multi-step agent traces as waterfall span trees with critical path highlighted automatically. Works with LangGraph, LangChain, CrewAI, Vercel AI SDK, MCP, and raw OpenTelemetry.
- Prompt A/B with Welch's t-test on latency and cost plus a two-proportion z-test on error rate. So "v8 is better than v7" comes with a p-value.
- Judge-to-human correlation as a first-class metric. When your LLM judge starts drifting from human raters, you see it before you make a bad rollout decision.
- Fully MIT. No ee/ folder. What you self-host is what we run.

Free plan is 50K requests/mo with all features. Pro at $29/mo, Team at $149/mo. Self-hosting is free with one `docker compose up`.

Stack is Next.js 14 + Hono + Supabase Postgres + ClickHouse. TypeScript and Python SDKs. OTLP/HTTP for everything else.

Limitations I want to be upfront about:
- Younger than Langfuse — fewer pre-built evaluators in the marketplace.
- No SOC 2 yet (Type II target Q3 2026). Self-hosting is the safest path for regulated workloads right now.
- Eval marketplace is leaner; the design is "LLM-as-judge with your own rubric + human annotation" rather than a catalog of stock metrics.

Happy to answer anything — implementation, architecture (the ClickHouse fallback-replay pattern for log-loss safety especially), or the comparison vs Langfuse / Helicone / LangSmith / Braintrust / Phoenix.

Comparison pages with full feature-by-feature tables:
- https://www.spanlens.io/compare/langfuse
- https://www.spanlens.io/compare/helicone
- https://www.spanlens.io/compare/langsmith
- https://www.spanlens.io/compare/braintrust
- https://www.spanlens.io/compare/arize-phoenix

## Reply-ready material (have these tabs open when posting)

If asked **"How does the proxy not add latency?"**:
- Streaming responses pass through via body.tee(). Ingestion happens after the response is already streamed to your client. Worst case Spanlens is unreachable and the proxy degrades gracefully without breaking your request.

If asked **"What about prompt injection / PII?"**:
- Regex + ML detectors on request bodies at log time. API keys auto-masked before persistence. Flag-don't-block by default — blocking the LLM call to the user is usually worse than the security issue.

If asked **"Why not just use Langfuse?"**:
- Langfuse is great. Three differences: (1) one-line proxy vs SDK wrap on every chain, (2) no ee/ folder, (3) Prompt A/B with built-in statistical significance + judge↔human correlation. /compare/langfuse has the full table.

If asked **"Self-host how?"**:
- `git clone && docker compose up`. Stack is Next + Hono + Postgres + ClickHouse. No telemetry by default in self-hosted. All features in OSS — no ee/ folder.

If asked **"Pricing model?"**:
- /pricing has the full breakdown. TL;DR: usage-based with overage billing, never surprise-blocked mid-month. Free is 50K/mo with all features.
