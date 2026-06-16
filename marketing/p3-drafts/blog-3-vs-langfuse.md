# P3-22b: Blog post 3 — Spanlens vs Langfuse

**Slug**: `spanlens-vs-langfuse-which-llm-observability-tool`
**Tags**: `llm`, `observability`, `langfuse`, `comparison`, `opensource`

---

# Spanlens vs Langfuse: Which LLM Observability Tool Is Right for You? (2026)

Both Spanlens and Langfuse are open-source LLM observability platforms with self-hosting support. Both work with OpenAI, Anthropic, and Gemini. So which one should you pick? This piece is an honest comparison from the team building Spanlens — including the cases where Langfuse is the better choice.

## TL;DR

| If you want… | Pick |
|---|---|
| One-line integration on an existing codebase | **Spanlens** |
| Full MIT licensing with no enterprise feature gate | **Spanlens** |
| Built-in Welch t-test + z-test on Prompt A/B | **Spanlens** |
| Critical-path highlighting on agent traces | **Spanlens** |
| Largest open-source ecosystem and pre-built evaluators | **Langfuse** |
| Native OpenTelemetry as the primary integration | **Langfuse** |
| Datasets-as-a-product workflow | **Langfuse** |

Full feature-by-feature: https://www.spanlens.io/compare/langfuse

## The integration model difference

This is the biggest practical decision. Langfuse is SDK + OTel first. Spanlens is proxy + SDK first.

**Langfuse pattern**:
```ts
import { CallbackHandler } from 'langfuse-langchain'
const handler = new CallbackHandler({ ... })
const result = await chain.invoke({ ... }, { callbacks: [handler] })
```

You wrap your chains. Works fine for greenfield. Painful when you have 30 LLM call sites across an existing codebase, because you have to add the callback to each one.

**Spanlens pattern**:
```ts
const openai = new OpenAI({
  baseURL: 'https://api.spanlens.io/proxy/openai/v1',
  apiKey: process.env.SPANLENS_API_KEY,
})
```

One line. Every call site, including ones inside dependencies you didn't write, is captured.

If you're starting fresh, the Langfuse model is fine. If you're instrumenting an existing app, the Spanlens proxy is dramatically less work.

## The MIT-with-asterisk vs full-MIT

Langfuse 3.0 moved all features to MIT — a good move. But they still keep an `ee/` folder gating enterprise security and compliance add-ons (SCIM provisioning, audit logs, project RBAC, data retention configuration, prompt-body masking) behind a commercial license.

Spanlens has no `ee/` folder. What you self-host is exactly what we run on hosted. For most teams this never matters; if you're in a regulated industry and need audit logs or SCIM in the self-hosted build, it matters a lot.

## Prompt A/B: significance testing built in

Both tools support prompt versioning. Both support experiments. The difference is at the analysis layer.

Langfuse experiments produce side-by-side metrics. The judgment call ("is v8 actually better than v7?") is bring-your-own statistical analysis. For most teams this becomes a manual spreadsheet exercise that doesn't get done.

Spanlens runs the statistical test for you:

- Latency and cost — Welch's t-test (unequal variance is the norm)
- Error rate — two-proportion z-test (Bernoulli)
- Eval score — Welch's t-test

p-values and effect sizes appear inline. The "promote winner" gate requires p<0.05 with a directional improvement on the metric you picked. No spreadsheet.

## Where Langfuse genuinely wins

We don't think every team should pick Spanlens. Cases where Langfuse is the better fit:

**You already have an OpenTelemetry pipeline.** Langfuse is OTel-native by design. Spanlens supports OTLP/HTTP ingest too, but Langfuse's OTel pedigree is deeper and the integrations they ship are more mature.

**You need a rich eval marketplace.** Langfuse has a catalog of pre-built evaluators (toxicity, helpfulness, hallucination detection) you can chain. Spanlens has a leaner design where you bring your own rubric and use LLM-as-judge + human annotation. If you want stock eval metrics out of the box, Langfuse is ahead.

**Community size matters to you.** Langfuse has been public since 2023 with thousands of GitHub stars and a large community. Spanlens shipped in early 2026. If proven OSS adoption is your top criterion, Langfuse is ahead.

**Datasets-as-a-product workflow.** Langfuse's dataset model is more developed — versioning, splits, sampling strategies. If your team thinks in terms of dataset-driven development, Langfuse fits that model better today.

## Migration if you're switching

If you're moving from Langfuse to Spanlens, the [migration guide](https://www.spanlens.io/docs/migrate/from-langfuse) takes ~30 minutes. The two models are different enough that you can't drop-in replace, but the data shape (traces, observations, scores) maps cleanly.

If you're moving from Spanlens to Langfuse, we'll help. Open an issue and we'll write the export tool for your data shape.

## Try Spanlens

Spanlens is open source MIT, free 50K req/mo. https://github.com/spanlens/Spanlens. Self-host with `docker compose up`. Comparison page with the full feature table: https://www.spanlens.io/compare/langfuse.
