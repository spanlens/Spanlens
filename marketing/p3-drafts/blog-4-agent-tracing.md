# P3-22c: Blog post 4 — Agent tracing

**Slug**: `agent-tracing-debug-multi-agent-llm-workflows`
**Tags**: `llm`, `agents`, `observability`, `langchain`, `langgraph`

---

# AI Agent Tracing: How to Debug Multi-Agent LLM Workflows in Production

A typical agent goes wrong in one of three ways: it costs more than expected, it takes longer than expected, or it produces the wrong answer. From the outside they look the same. From inside the trace, they're three very different problems.

This post walks through how to capture, read, and debug agent traces in production — using Spanlens but the patterns apply to any tracing tool.

## The trace shape

Every agent trace has four layers. Each layer answers a different debugging question.

```
trace (root)
├── agent_step (classify)
│   └── llm (gpt-4o-mini)
├── agent_step (retrieve)
│   ├── tool (kb_search)
│   └── tool (web_search)
├── agent_step (synthesize)
│   └── llm (gpt-4o)
└── agent_step (format)
    └── llm (gpt-4o-mini)
```

- **trace** answers: how long, how much, did it succeed
- **agent_step** answers: which logical step was slow / wrong
- **llm** answers: which model call had the cost or latency surprise
- **tool** answers: did the LLM-generated arguments make sense and did the tool return what was expected

When something goes wrong, start at the trace and walk down to the layer that has the answer.

## Cost spike: walk down by cost

A trace cost 50x what you expected. Process:

1. Open the trace, sort children by `cost_usd desc`
2. The top agent_step is probably the culprit
3. Inside it, look at the LLM call. Check:
   - Model variant (did you accidentally call GPT-4o where you meant GPT-4o-mini?)
   - Input token count (did you forget to truncate context?)
   - Output token count (did `max_tokens` get unset and the model ran away?)

The dashboard usually shows this in under a minute. Without tracing it's a 2-hour debugging session.

## Latency spike: walk the critical path

A trace took 30s when it normally takes 4s. Process:

1. Open the trace, look at the critical path (it's highlighted automatically in Spanlens; in other tools you compute it manually)
2. The critical path tells you which spans contributed to total wall-clock time. Spans not on the critical path are irrelevant for latency.
3. For each critical-path span, check:
   - Was it a network timeout? (look at the status)
   - Was it a retry? (look at the retry_count or the parent's retry_count)
   - Was it a slow upstream provider? (compare with same-prompt-version baseline)

Most latency spikes turn out to be one provider call that hit a 10s timeout. Fixing it usually means a shorter timeout + a faster fallback model.

## Wrong answer: walk by tool output

The agent produced the wrong final answer. Process:

1. Find the trace by user feedback or by anomaly detection (if you have evals running)
2. Walk down the span tree, reading the input/output of each step
3. Where did the answer first go wrong? Usually it's one of:
   - The classify step picked the wrong route (LLM call problem)
   - The retrieve step pulled the wrong documents (tool call problem)
   - The synthesize step ignored part of the retrieved context (LLM call problem with too much context)

The trace shows which one. Fixing it depends on which:
- Wrong classify → add this case to your eval dataset, tighten the routing prompt
- Wrong retrieval → tune retrieval parameters, add a re-ranker
- Ignored context → trim context before synthesis, or split into multiple synthesis steps

## Why critical path matters

For an agent that runs 4 sub-tasks in parallel and 1 sequentially after, total time is `max(parallel_4) + sequential_1`. The 3 sub-tasks that aren't the slowest in the parallel batch don't matter for latency — optimizing them is zero effect on wall-clock.

This is why "the slowest span" is not the same as "the critical path span." The slowest span might be entirely shadowed by a parallel branch. The critical path identifies the spans that actually drive total time.

Some tools (Spanlens, Datadog APM) compute critical path automatically. Most LLM observability tools render the waterfall and leave it to you. If you're not computing critical path, you're optimizing the wrong spans.

## Capturing it: three patterns

Spanlens supports all three. Pick by your existing stack.

```ts
// LangChain / LangGraph (callback)
import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'
const handler = createSpanlensCallbackHandler({ client })
await graph.invoke(input, { callbacks: [handler] })

// Drop-in (any LangChain-based framework, including CrewAI)
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI() // capture spans for every chat completion

// OpenTelemetry (raw OTLP)
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
// point your existing OTel exporter at /v1/traces
```

## Try it

Spanlens is open source MIT, free 50K req/mo. https://github.com/spanlens/Spanlens.

Agent tracing guide: https://www.spanlens.io/agent-tracing.
LangGraph integration: https://www.spanlens.io/docs/integrations/langgraph.
CrewAI integration: https://www.spanlens.io/docs/integrations/crewai.
