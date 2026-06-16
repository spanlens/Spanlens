# P3-22d: Blog post 5 — GPT-4o pricing

**Slug**: `gpt-4o-pricing-real-world-cost-2026`
**Tags**: `openai`, `gpt-4o`, `pricing`, `cost`, `llm`

---

# GPT-4o Pricing in 2026: Real-World Cost, Examples, and How to Track Spend

GPT-4o costs $2.50 per 1M input tokens and $10 per 1M output tokens at the standard tier. That's the number. What that actually means for your bill depends on usage shape. This post walks through five real-world scenarios with the math, then covers how to monitor and reduce GPT-4o spend in production.

## The number, in context

**GPT-4o standard tier (2026)**:
- Input: $2.50 per 1M tokens
- Output: $10 per 1M tokens
- Cached input: $1.25 per 1M (automatic for prompts >1024 tokens with shared prefixes)
- Batch API: 50% off both input and output (24-hour latency)

**Context window**: 128K tokens
**Max output**: 16K tokens

## Five real-world cost scenarios

### Scenario 1: Casual chatbot

500 input tokens, 300 output tokens per request, 5,000 requests per month.

```
Input:  (500 × 5,000 / 1,000,000) × $2.50 = $6.25
Output: (300 × 5,000 / 1,000,000) × $10.00 = $15.00
Total: $21.25/month
```

Verdict: cheap enough to not optimize. Move on.

### Scenario 2: Production assistant

1,500 input, 800 output, 50,000 requests per month.

```
Input:  (1,500 × 50,000 / 1,000,000) × $2.50 = $187.50
Output: (800 × 50,000 / 1,000,000) × $10.00 = $400.00
Total: $587.50/month
```

Verdict: worth examining. Is GPT-4o-mini good enough for this task? Usually yes for assistants that follow a fixed format.

### Scenario 3: Long-context summarizer

8,000 input, 1,200 output, 20,000 requests per month.

```
Input:  (8,000 × 20,000 / 1,000,000) × $2.50 = $400.00
Output: (1,200 × 20,000 / 1,000,000) × $10.00 = $240.00
Total: $640.00/month
```

Verdict: input cost dominates. Enable prompt caching if the system prompt is shared. Cached input at $1.25 cuts input cost ~50%.

### Scenario 4: RAG with shared system prompt

3,000 input, 500 output, 100,000 requests per month.

```
Input:  (3,000 × 100,000 / 1,000,000) × $2.50 = $750.00
Output: (500 × 100,000 / 1,000,000) × $10.00 = $500.00
Total: $1,250.00/month
```

With caching (assume 2,500 of the 3,000 input tokens are cacheable):

```
Cached input:    (2,500 × 100,000 / 1,000,000) × $1.25 = $312.50
Non-cached input:  (500 × 100,000 / 1,000,000) × $2.50 = $125.00
Output: $500.00
Total: $937.50/month — save $312.50
```

Verdict: caching pays back immediately. Always enable for shared system prompts.

### Scenario 5: High-volume API

1,200 input, 600 output, 1,000,000 requests per month.

```
Input:  (1,200 × 1,000,000 / 1,000,000) × $2.50 = $3,000
Output:  (600 × 1,000,000 / 1,000,000) × $10.00 = $6,000
Total: $9,000/month
```

Verdict: every optimization matters. Check whether half this volume is routing/classification — those should be GPT-4o-mini ($0.15/$0.60) at 15-17x lower cost. Could save $4,000-5,000 of the $9,000.

## How to track GPT-4o spend in production

Three things you need to capture per request:

1. **Exact model variant**. OpenAI returns the dated name (e.g. `gpt-4o-2024-08-06`). Price changes happen by variant, not by alias.
2. **Input + output token counts**, with cache tokens broken out separately. Available in the `usage` field of every OpenAI response.
3. **A tag for the dimension you'll group by** (customer, endpoint, prompt version). Add this at request time.

In Spanlens, this happens automatically. With a one-line baseURL swap:

```ts
const openai = new OpenAI({
  baseURL: 'https://api.spanlens.io/proxy/openai/v1',
  apiKey: process.env.SPANLENS_API_KEY,
})
```

Every call lands in `/requests` with `cost_usd` already calculated. The savings recommender then surfaces candidates for the swap-to-GPT-4o-mini optimization with dollar figures attached.

## GPT-4o-mini vs GPT-4o

For tasks that don't need frontier quality, GPT-4o-mini is the answer:

| Metric | GPT-4o | GPT-4o-mini | Ratio |
|---|---|---|---|
| Input / 1M | $2.50 | $0.15 | 16.7x cheaper |
| Output / 1M | $10.00 | $0.60 | 16.7x cheaper |
| Context | 128K | 128K | same |
| Max output | 16K | 16K | same |
| TTFT | ~600ms | ~250ms | 2.4x faster |

For classification, routing, extraction, and short replies, GPT-4o-mini is usually indistinguishable on quality. Run a Welch t-test on your eval scores to confirm before switching.

## Try it

Spanlens (https://www.spanlens.io) does the GPT-4o cost capture, savings recommendation, and A/B testing automatically. Open source MIT, free 50K req/mo. https://github.com/spanlens/Spanlens.

---

**Related reading**:
- [Full GPT-4o pricing breakdown](https://www.spanlens.io/pricing/gpt-4o)
- [GPT-4o-mini pricing breakdown](https://www.spanlens.io/pricing/gpt-4o-mini)
- [LLM cost calculator](https://www.spanlens.io/tools/llm-cost-calculator)
- [Five swaps that cut LLM bills 30-60%](https://blog.spanlens.io/reduce-llm-costs-five-swaps)
