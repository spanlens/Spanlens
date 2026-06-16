# P3-22a: Blog post 2 — LLM cost tracking

**Slug**: `reduce-llm-costs-five-swaps`
**Tags**: `llm`, `cost`, `openai`, `anthropic`, `optimization`

---

# Five Swaps That Cut LLM Bills 30 to 60 Percent (Without Quality Regression)

Every team running an LLM app eventually has the cost conversation. Below are five concrete changes that almost always move the bill, in order of effort vs payoff. None of them touch user-facing behavior or sacrifice quality if measured properly.

## Swap 1: Route routing calls to a small model

This is the single biggest source of overspend we see. Teams send classification, intent detection, and routing decisions to GPT-4o (or Claude Sonnet) because that's what's wired up. Then they're paying $2.50/$10 per 1M tokens for tasks GPT-4o-mini does at $0.15/$0.60 — 15x cheaper input, 17x cheaper output, no measurable quality regression on narrow tasks.

**How to find candidates**: in your observability dashboard, sort prompt versions by `cost_usd / call`. The high-volume + short-output ones are usually routing calls.

**How to verify safely**: run a Prompt A/B with the small model variant, sample for a week, check eval scores. Spanlens defaults to Welch's t-test on the eval score — a p>0.05 result means you can switch without quality risk.

**Typical savings**: 30 to 50% of total bill depending on what fraction of calls are routing.

## Swap 2: Enable prompt caching for shared system prompts

Both OpenAI and Anthropic offer prompt caching but they price it differently:

| Provider | Cache write | Cache read | Cache TTL |
|----------|-------------|------------|-----------|
| OpenAI   | Same as input | 50% off | Auto, ~10 min |
| Anthropic | 25% more than input | 10% of input | 5 min default |

For Anthropic, the break-even is ~2-3 cache reads. For OpenAI it's ~1. If your system prompt is more than 1K tokens and shared across many requests, caching pays back immediately.

**Anthropic note**: you have to explicitly mark cache breakpoints. OpenAI does it automatically.

**Typical savings**: 20 to 40% on input cost for cache-friendly workloads.

## Swap 3: Cap max_tokens

A failed structured-output retry that runs to 4096 tokens costs 100x a successful one. Set `max_tokens` explicitly. Set it tight — most schemas don't need more than 1K.

This sounds obvious but we routinely see prod code with `max_tokens` unset. Default for most providers is "as much as the model wants," which on a confused retry can be the full context window.

**Typical savings**: variable, but it's the difference between a $5/day cost overrun and a $500/day one.

## Swap 4: Pre-summarize long context once

For an agent with a growing conversation history, summarize the older turns once and replace them with the summary. A 10-turn conversation that sends the full history every turn costs O(n²). Summarizing makes it O(n).

**Implementation**: after every 5 turns, fire a one-shot summarization call and store the result. New turns include `[summary of turns 1-5] + recent turns 6-10`. Re-summarize every 5 new turns.

**Typical savings**: 40 to 70% on multi-turn chat workloads.

## Swap 5: Gate reasoning models to the steps that need them

o1 and o3-mini are 6x to 60x more expensive than GPT-4o on output, and they include hidden reasoning tokens you're billed for but never see. Use them for hard reasoning steps only, not as a default.

A common pattern: the agent's "plan the next step" call goes to o3-mini, but every other step (read tool result, format output, classify intent) goes to GPT-4o-mini. The plan call is maybe 5% of total volume but justifies the reasoning model. The rest don't.

**Typical savings**: 50 to 80% on agent workflows that defaulted to o1.

## What to measure before and after

Before each swap, capture a 7-day baseline of:

- Average cost per request
- Eval score per prompt version
- p95 latency

After the swap, capture the same. Significance test:

- Cost — Welch's t-test (unequal variance)
- Eval score — Welch's t-test (continuous)
- Error rate — two-proportion z-test (Bernoulli)

If eval score and error rate hold, ship the swap. If either degrades materially, roll back.

## Try it

Spanlens (https://www.spanlens.io) does the cost capture, the A/B significance testing, and the savings recommender automatically. Open source MIT, free 50K req/mo. https://github.com/spanlens/Spanlens.

---

**Related reading**:
- [LLM cost tracking — the guide](https://www.spanlens.io/llm-cost-tracking)
- [GPT-4o pricing breakdown](https://www.spanlens.io/pricing/gpt-4o)
- [GPT-4o-mini pricing](https://www.spanlens.io/pricing/gpt-4o-mini)
- [Cost calculator](https://www.spanlens.io/tools/llm-cost-calculator)
