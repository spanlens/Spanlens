---
name: model-price-refresh
description: >-
  Audit every LLM provider's official pricing page against the `model_prices`
  table and ship the diff as a migration. Use this whenever the user asks
  whether our providers' models are up to date, mentions a specific model
  missing from cost tracking, reports `cost_usd` coming back null or looking
  wrong, asks to "refresh prices" / "check the latest models" / "add <model>",
  or when a scheduled price-refresh routine fires. Also use it proactively
  before adding any single model by hand — the table has three mirrors and a
  provider-scoped key, and editing one place silently desyncs the others.
---

# Model price refresh

Spanlens prices every proxied request from the `model_prices` table. A model
that isn't in the table logs `cost_usd = NULL`, which the dashboard renders as
missing data — the customer sees a gap, not an error. A model that's in the
table at a stale rate is worse: the number looks fine and is quietly wrong.

Providers ship new flagship models faster than you'd expect (Gemini shipped
3.5-flash → 3.6-flash inside a month in mid-2026), so this drifts continuously.

## What you're keeping in sync

Prices live in **three** places, and they serve different purposes. All three
have to move together or you get correct-looking-but-wrong behavior:

| Where | Purpose | Consequence if stale |
|---|---|---|
| `model_prices` table (via `supabase/migrations/`) | Runtime source of truth | Wrong or missing cost on every request |
| `supabase/seeds/model_prices.sql` | Reference mirror + local `db reset` | Local/CI prices diverge from prod |
| `FALLBACK_PRICES` in `apps/server/src/lib/model-prices-cache.ts` | Cold-start map, read before the first DB refresh lands | Wrong prices for the first seconds after every deploy |

The seed file has drifted from the migrations before (2026-07: it still carried
Mistral's pre-Large-3 prices and was missing three Anthropic models). Assume it's
behind until you've diffed it.

## Workflow

### 1. Read the current state

Query production rather than trusting the repo, because the repo mirrors lag:

```sql
select provider, model,
       prompt_price_per_1m::float8, completion_price_per_1m::float8,
       cache_read_price_per_1m::float8, cache_write_price_per_1m::float8,
       long_context_threshold_tokens
from model_prices
order by provider, model;
```

Use the Supabase MCP (`execute_sql`) against the `spanlens` project. Skip
`provider = 'openrouter'` for the detailed pass — it's a meta-provider with
100+ churning rows, and its proxy prefers the cost OpenRouter reports itself.

### 2. Pull each provider's official pricing

Read `references/providers.md` for the URL, the extraction technique that
actually works for each page, and the per-provider traps. Several pricing pages
are JS-rendered tab groups where a plain fetch returns nothing useful — that
file has the browser snippets that pair headings with their price tables.

Providers currently in scope: `openai`, `anthropic`, `gemini`, `mistral`,
`groq`, `deepseek`, `xai`, `cohere` (+ `azure`, which owns no rows and borrows
OpenAI's, and `openrouter`).

Check `apps/server/src/proxy/` for the authoritative list — a new proxy file
means a new provider to audit.

### 3. Diff, and classify what you find

Sort findings by what they cost the customer, not by provider:

- **Missing model** → requests log `cost_usd = NULL`. Highest priority.
- **Wrong price** → silently mis-billed. Equally urgent, harder to notice.
- **Missing `cache_read`** → `calculateCost()` falls back to the full input
  rate (see `lib/cost.ts`), so every cache hit over-charges. Gemini and xAI both
  publish cached-input rates; check whether the column is actually populated
  rather than assuming.
- **Missing long-context tier** → requests above the threshold under-charge.
  OpenAI GPT-5.x is 272k; Gemini Pro and xAI are 200k. xAI is unusual: crossing
  the threshold re-rates the *entire* request at 2x, not just the excess.
- **Model gone from the pricing page** → keep the row so historical requests
  still price, and note it. Don't delete.

### 4. Check for name collisions before adding anything

This is the step that's easy to skip and expensive to miss. The price cache is
keyed `"<provider>:<model>"` precisely because model names are **not** unique
across providers — `qwen/qwen3-32b` is $0.29/1M on Groq and $0.08/1M on
OpenRouter. Adding a model that already exists under a different provider is
fine now, but you should know you're doing it, and the fallback map has a
stricter rule (below).

```sql
select model, count(*) n,
       string_agg(provider||': '||prompt_price_per_1m::float8, ' | ' order by provider) v
from model_prices group by model having count(*) > 1 order by model;
```

Run this **after** drafting the migration, mentally applying your additions.
`FALLBACK_PRICES` is keyed by model alone, so it must stay unambiguous: never
put a vendor-prefixed OpenRouter id in it. A test enforces this.

### 5. Decide what NOT to add

`model_prices` has a single `completion_price_per_1m`, but image/video/audio
models bill output by modality — `gemini-3-pro-image` is $12/1M for text and
$120/1M for images. Picking either number silently mis-bills the other case,
which is worse than a visible NULL. Leave them out and say so in the migration
header until there's a modality-aware column.

Same for models with no published per-token price (Cohere's `command-a-plus`
and the specialized `command-a-*` variants are sales-quoted).

### 6. Write the migration

New file, `supabase/migrations/YYYYMMDDHHMMSS_seed_models_YYYY_MM.sql`. Never
edit an existing migration — a pre-commit hook blocks it.

Make it idempotent so a re-run is harmless:

```sql
INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  ('openai', 'gpt-5.6-sol', 5.00, 30.00, 0.50, 6.25)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();
```

Long-context tiers go in follow-up `UPDATE` statements (see the
20260729100000 migration for the shape).

Write the header comment as a record of *why*, not a list of *what* — the diff
already shows what. Verification date, the pages you checked, what you
deliberately left out and on what reasoning, and any dated price change coming.

### 7. Mirror into the seed and the fallback map

Apply the same changes to `supabase/seeds/model_prices.sql` and
`FALLBACK_PRICES`. While you're in there, diff the whole provider block against
what you just read from the DB — that's how the 2026-07 Mistral drift surfaced.

`FALLBACK_PRICES` doesn't need every model; it needs the ones that would hurt
if they priced wrong for a few seconds after deploy. Current flagships,
high-volume models, anything a customer is actively running.

### 8. Verify

```bash
pnpm --filter server typecheck && pnpm --filter server lint && pnpm --filter server test
```

Price corrections **will** break tests that hardcode the old numbers — that's
the test doing its job, not a problem to route around. Update the expected value
*and* the comment that explains the arithmetic, so the next reader can check it.
Known ones: `proxy-mistral.test.ts` and `proxy-openai-compat-providers.test.ts`
both assert specific per-1M rates.

When you change a tier boundary or add a new pricing dimension, add a test that
pins both sides of it. A price table with no test is a price table that will
quietly regress.

### 9. Ship

Conventional commit (`fix(db):` for corrections, `feat(db):` for pure
additions). In the PR body, lead with customer impact — which models were
logging NULL, which rate was wrong and by how much — then the follow-ups.

After merge, `deploy-server.yml` runs `supabase db push` automatically. Confirm
the rows actually landed by querying production; don't infer it from a green
workflow.

## Recurring obligations

Some price changes are scheduled rather than discovered. When you find one,
write it into the migration header **and** tell the user to calendar it —
a comment alone won't fire.

Currently pending:

- **2026-09-01** — `claude-sonnet-5` introductory pricing ($2/$10, cache
  0.20/2.50) expires. Standard is $3/$15, cache 0.30/3.75. Missing this
  under-reports Sonnet 5 by 33%.

## Reference

- `references/providers.md` — per-provider pricing URLs, extraction techniques
  for the JS-rendered pages, and known traps
- `supabase/migrations/20260729100000_seed_models_2026_07.sql` — worked example
  covering additions, a correction, cache backfill, and tier setup
- `apps/server/src/lib/cost.ts` — resolution order (exact before prefix,
  provider-scoped before fallback) and the `azure → openai` mapping
