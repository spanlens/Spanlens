# P3-16: awesome-llm-observability PR

**Target repo candidates** (check which exists/is active):
- https://github.com/sourcegraph/awesome-llm-observability
- Or fork-and-create if none active
- Also consider: https://github.com/dair-ai/ML-Observability-Resources

**PR title**: `Add Spanlens — open-source LLM observability (MIT)`

**Branch name**: `add-spanlens`

**Diff** (typical README.md insertion under the "Open Source" or "Tools" section, alphabetically):

```diff
+ - [Spanlens](https://github.com/spanlens/Spanlens) — Drop-in proxy for OpenAI/Anthropic/Gemini. Cost tracking, agent tracing with critical path, Prompt A/B with Welch t-test, judge↔human correlation. Fully MIT, self-hostable with one Docker command.
```

**PR description**:

```
Adding Spanlens (https://github.com/spanlens/Spanlens) — open-source LLM observability platform under MIT.

Distinguishing characteristics vs other tools already on the list:
- One-line integration via baseURL swap or SDK drop-in (no SDK wrapping per chain)
- Prompt A/B with built-in Welch's t-test on latency/cost and z-test on error rate
- Judge↔human correlation tracked as a first-class metric
- No ee/ folder — every feature is in the OSS build

Happy to revise the description if there's a house style.
```
