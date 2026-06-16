# P3-15: r/MachineLearning post

**Submit URL**: https://www.reddit.com/r/MachineLearning/submit
**Type**: Text post
**Title**: `[P] Open-source LLM observability with Welch's t-test on prompt A/B and judge↔human correlation tracking`

---

[P] Project link: https://github.com/spanlens/Spanlens

Built an open-source LLM observability platform and want to share two design choices that may be useful regardless of whether you use the tool.

**1. Statistical significance on Prompt A/B**

Most prompt management tools render side-by-side latency and cost bars but leave significance testing as bring-your-own analysis. The defaults are wrong:

- Latency and cost distributions across LLM calls are unequal-variance (one prompt may have much higher tail latency). Student's t-test is incorrect; Welch's t-test is the right choice.
- Error rate is Bernoulli per call. A t-test on it is incorrect; two-proportion z-test is right.
- Eval score (LLM-as-judge or human, both on [0,1]) is continuous → Welch.

Spanlens runs these automatically and reports p-values + effect sizes inline. The "promote winner" gate requires p<0.05 with a directional improvement on the primary metric you picked at experiment setup.

Code lives in `apps/server/src/lib/stats-queries.ts` if anyone wants to audit. PRs welcome.

**2. Judge ↔ human correlation as a first-class drift metric**

The standard pattern is "score with LLM-as-judge, ignore the human labels you already have." That works until your judge silently drifts.

What we track: Pearson correlation between judge score and human annotation score, per prompt version. When it drops below threshold (default 0.7), the dashboard flags it and surfaces a re-grounding prompt — go re-annotate ~50 fresh samples to recalibrate the judge rubric.

Saw this drift firsthand in a few customer instances where the judge model was unchanged but the input distribution shifted. The judge happily kept assigning high scores while human raters thought outputs got worse. Surfacing the correlation makes that visible.

**Stack**: Next.js 14 + Hono + Postgres + ClickHouse. Fully MIT (no ee/ folder). Drop-in for OpenAI/Anthropic/Gemini SDKs, OTLP/HTTP for OTel, or raw proxy for any language.

Happy to discuss the stats setup, the trace-tree data model (parent_span_id without FK because out-of-order ingestion is normal), or how we compute critical path on non-deterministic agent traces.

---

## Reply-ready

- **Why not Mann-Whitney instead of Welch?** Mann-Whitney is more robust to outliers but loses power on roughly-normal data. We picked Welch as the default with a Mann-Whitney mode planned. PR open.
- **Multiple comparisons correction?** Bonferroni applied when multiple A/B's are running simultaneously on the same prompt name. Per-experiment p-values are uncorrected; the gate uses the corrected version.
- **Why Pearson not Spearman for judge↔human?** Both are exposed. Pearson is default since judge and human are both on [0,1] continuous. Spearman shown alongside for rank-order sanity.
