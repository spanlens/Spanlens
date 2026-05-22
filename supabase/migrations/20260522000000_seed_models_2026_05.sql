-- Migration: Add missing models to model_prices (verified against provider docs 2026-05-22)
--
-- Background — gotcha #2 in CLAUDE.md:
--   When a request comes in for a model that's not in this table, lib/cost.ts
--   returns NULL → requests.cost_usd stays NULL → dashboard shows no cost for
--   those calls. As of 2026-05 the seed was missing the entire current
--   flagship lineup from all three providers (GPT-5.x, Claude Opus 4.5/4.6,
--   Gemini 3.x). This migration backfills.
--
-- Sources:
--   OpenAI:    https://platform.openai.com/docs/pricing
--   Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
--   Gemini:    https://ai.google.dev/gemini-api/docs/pricing
--
-- Cache pricing conventions (unchanged from prior seed):
--   Anthropic — cache_read = 0.1 × input, cache_write (5min ephemeral) = 1.25 × input
--   OpenAI    — cached input ≈ 0.5 × input (varies by model family); no write concept
--   Gemini    — context caching is priced but our integration doesn't surface it
--              yet, so leave cache columns NULL (calculateCost falls back to the
--              regular prompt price). Update when caching ships.
--
-- Tiered prices (Gemini 2.5 Pro, 3.1 Pro, 2.5 Computer Use): the seed stores a
-- single per-token price, so we use the ≤200k-token tier — the band most
-- production traffic falls into. If we ever model tiered pricing properly,
-- expand the schema instead of guessing here.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── OpenAI: GPT-5.x flagship family (2026-05) ────────────────────────────
  ('openai', 'gpt-5.5',           5.00,  30.00,   0.50,   NULL),
  ('openai', 'gpt-5.5-pro',      30.00, 180.00,   NULL,   NULL),
  ('openai', 'gpt-5.4',           2.50,  15.00,   0.25,   NULL),
  ('openai', 'gpt-5.4-mini',      0.75,   4.50,   0.075,  NULL),
  ('openai', 'gpt-5.4-nano',      0.20,   1.25,   0.02,   NULL),
  ('openai', 'gpt-5.4-pro',      30.00, 180.00,   NULL,   NULL),
  ('openai', 'gpt-5.3-codex',     1.75,  14.00,   0.175,  NULL),
  -- ── Anthropic: Opus 4.1 / 4.5 / 4.6 + Sonnet 4.5 ────────────────────────
  ('anthropic', 'claude-opus-4-6',              5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-opus-4-5',              5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-opus-4-1',             15.00,  75.00,   1.50,  18.75),
  ('anthropic', 'claude-opus-4',               15.00,  75.00,   1.50,  18.75), -- deprecated, kept for historical replay
  ('anthropic', 'claude-sonnet-4-5',            3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-sonnet-4',              3.00,  15.00,   0.30,   3.75), -- deprecated
  -- ── Gemini 3.x + 2.5 stragglers + 2.0-flash-lite ────────────────────────
  ('gemini', 'gemini-3.5-flash',                       1.50,  9.00,   NULL, NULL),
  ('gemini', 'gemini-3.1-pro-preview',                 2.00, 12.00,   NULL, NULL), -- ≤200k tier; >200k is 4.00/18.00
  ('gemini', 'gemini-3.1-pro-preview-customtools',     2.00, 12.00,   NULL, NULL),
  ('gemini', 'gemini-3.1-flash-lite',                  0.25,  1.50,   NULL, NULL),
  ('gemini', 'gemini-3.1-flash-lite-preview',          0.25,  1.50,   NULL, NULL),
  ('gemini', 'gemini-3-flash-preview',                 0.50,  3.00,   NULL, NULL),
  ('gemini', 'gemini-2.5-flash-lite-preview-09-2025',  0.10,  0.40,   NULL, NULL),
  ('gemini', 'gemini-2.0-flash-lite',                  0.075, 0.30,   NULL, NULL), -- deprecated 2026-06-01, kept for historical data
  ('gemini', 'gemini-2.5-computer-use-preview-10-2025', 1.25, 10.00,  NULL, NULL)  -- ≤200k tier; >200k is 2.50/15.00
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

-- Models still NOT covered (no public pricing page entry as of 2026-05-22):
--   OpenAI o-series: o1, o1-pro, o3, o3-pro, o3-deep-research, o4-mini, o4-mini-deep-research
--   OpenAI legacy:   gpt-5, gpt-5.1, gpt-5.2, gpt-5-mini, gpt-5-nano, gpt-5-chat-latest, gpt-5-codex
--                    gpt-4.5-preview, computer-use-preview, codex-mini-latest
-- These appear in the OpenAI Playground model dropdown but have been removed
-- from the public pricing table. Customers hitting them will still get cost=NULL.
-- Add them once OpenAI exposes prices again, or once we see real production
-- traffic for them.
