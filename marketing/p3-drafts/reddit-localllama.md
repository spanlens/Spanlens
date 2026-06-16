# P3-14: r/LocalLLaMA post

**Submit URL**: https://www.reddit.com/r/LocalLLaMA/submit
**Type**: Text post
**Title**: `Built an open-source observability layer for Ollama + cloud LLMs — one line, MIT`

---

Hey r/LocalLLaMA — open-sourced Spanlens this year (https://github.com/spanlens/Spanlens). MIT, drop-in proxy, observability for Ollama + cloud providers in the same dashboard.

The thing that got me building: I was bouncing between Ollama for local dev and Claude/OpenAI for prod, and there was no single view of cost (cloud) and latency (Ollama). Every "let's check what's happening" turned into checking 3 dashboards.

What's in v0.6.1:
- baseURL swap = every Ollama/OpenAI/Anthropic/Gemini call logged. p99 overhead <3ms.
- Local Ollama and cloud calls live in the same trace tree if your agent uses both
- Agent tracing with critical path on the slowest dependency chain (LangGraph, CrewAI, raw)
- Prompt A/B with Welch t-test on latency/cost — useful when comparing local model vs cloud for the same task
- Self-host with one `docker compose up`. Stack is Next + Hono + Postgres + ClickHouse.

Honestly was inspired by Helicone's design (proxy-first beats wrap-every-SDK) but wanted full MIT (no ee/ folder) and built-in stats on A/B.

Comparison vs the usual: https://www.spanlens.io/compare

If anyone's running Ollama in prod and wants to compare a local 70B vs a Claude Sonnet call on cost-per-quality, that's exactly the workflow this targets. Would love feedback on what's missing for local-first stacks.

Hosted free tier is 50K req/mo if you don't want to self-host.

---

## Reply-ready

Common Q's I expect:
- **Does it work with vLLM / TGI?** Yes — any OpenAI-compatible endpoint (vLLM has one). Just point its baseURL at Spanlens.
- **Quantization-level tracking?** Captured if the model returns it in metadata. Ollama tags work.
- **Anti-Ollama vibes?** Zero. The recommender will actively suggest swapping cloud→Ollama for cost-sensitive workloads where eval scores are flat.
