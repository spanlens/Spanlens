-- Seed model_prices refresh — 2026-06-13.
--
-- What this adds:
--   1. Anthropic: 3 new model IDs from claude.com/pricing (Opus 4.8, Fable 5,
--      Mythos 5). Fable/Mythos $10 in / $50 out per MTok; Opus 4.8 same as
--      the 4.5+ family ($5 / $25). Sources verified on docs.claude.com
--      Pricing page.
--   2. Anthropic: backfill cache_write_price_per_1m on existing Opus 4.5+ /
--      Sonnet 4.5+ / Haiku 4.5 rows that were NULL. The schema has one
--      cache-write column so we store the 5-minute write rate (the default
--      + most common; 1-hour rate is roughly 2x the 5-minute rate).
--   3. OpenRouter: 170 popular models from openrouter.ai/api/v1/models,
--      filtered to mainstream vendor prefixes (gpt-4o/4.1/5/o1/o3/o4,
--      claude-opus/sonnet/haiku, gemini-2.0/2.5/3.x, llama-3/4, deepseek,
--      qwen, grok, kimi, nova, command, mistral). Free-tier and exotic
--      :nitro / :extended variants excluded.
--
-- What this intentionally does NOT touch:
--   - OpenAI (49 rows refreshed 2026-06-12; openai.com/api/pricing is a
--     marketing surface and adds no new per-token rows).
--   - Mistral (11 rows seeded earlier today in 20260612150000; the
--     published page shows materially different prices, owner verifying
--     separately before refresh).
--   - Gemini (15 rows refreshed 2026-05-26; current published prices match
--     DB. Long-context tiers already encoded via long_context_threshold_*).
--
-- Cost math impact: OpenRouter rows are fallback only. The proxy's preferred
-- path is upstream `usage.cost` (PR #328 / #334). These rows kick in only
-- when the upstream cost field is missing — provider-side edge cases.
--
-- The history trigger (20260519000000) writes every change to
-- model_prices_history, so rollback is available via a single UPDATE against
-- the pre-snapshot row in that table.

-- ────────────────────────────────────────────────────────────────────────
-- 1. Anthropic: 3 new models (Opus 4.8, Fable 5, Mythos 5)
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m,
  chat_capable
) VALUES
  ('anthropic', 'claude-opus-4-8',  5.00,  25.00, 0.50,  6.25, true),
  ('anthropic', 'claude-fable-5',  10.00,  50.00, 1.00, 12.50, true),
  ('anthropic', 'claude-mythos-5', 10.00,  50.00, 1.00, 12.50, true)
ON CONFLICT (provider, model) DO UPDATE SET
  prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
  completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
  cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
  cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
  chat_capable             = EXCLUDED.chat_capable,
  updated_at               = now();

-- ────────────────────────────────────────────────────────────────────────
-- 2. Anthropic: backfill cache_write_price_per_1m (5-minute write rate)
--    on existing rows where it's NULL. Cache-write rate is 1.25x the base
--    input rate for the 4.5+ generation per claude.com/pricing.
-- ────────────────────────────────────────────────────────────────────────
UPDATE model_prices SET cache_write_price_per_1m =  6.25, updated_at = now()
  WHERE provider = 'anthropic'
    AND model IN (
      'claude-opus-4-5', 'claude-opus-4-5-20251101',
      'claude-opus-4-6', 'claude-opus-4-7'
    )
    AND cache_write_price_per_1m IS NULL;

UPDATE model_prices SET cache_write_price_per_1m =  3.75, updated_at = now()
  WHERE provider = 'anthropic'
    AND model IN (
      'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-6'
    )
    AND cache_write_price_per_1m IS NULL;

UPDATE model_prices SET cache_write_price_per_1m =  1.25, updated_at = now()
  WHERE provider = 'anthropic'
    AND model IN (
      'claude-haiku-4-5', 'claude-haiku-4-5-20251001'
    )
    AND cache_write_price_per_1m IS NULL;

-- Earlier-generation models (4.1/4/3.x) use 1.25x the 5-min rate too.
UPDATE model_prices SET cache_write_price_per_1m = 18.75, updated_at = now()
  WHERE provider = 'anthropic'
    AND model IN (
      'claude-opus-4', 'claude-opus-4-0', 'claude-opus-4-1',
      'claude-opus-4-1-20250805', 'claude-opus-4-20250514',
      'claude-3-opus-20240229'
    )
    AND cache_write_price_per_1m IS NULL;

UPDATE model_prices SET cache_write_price_per_1m =  3.75, updated_at = now()
  WHERE provider = 'anthropic'
    AND model IN (
      'claude-sonnet-4', 'claude-sonnet-4-0', 'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022'
    )
    AND cache_write_price_per_1m IS NULL;

UPDATE model_prices SET cache_write_price_per_1m =  1.00, updated_at = now()
  WHERE provider = 'anthropic'
    AND model = 'claude-3-5-haiku-20241022'
    AND cache_write_price_per_1m IS NULL;

-- ────────────────────────────────────────────────────────────────────────
-- 3. OpenRouter: 170 popular models
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  chat_capable
) VALUES
  ('openrouter', 'amazon/nova-2-lite-v1', 0.3, 2.5, true),
  ('openrouter', 'amazon/nova-lite-v1', 0.06, 0.24, true),
  ('openrouter', 'amazon/nova-micro-v1', 0.035, 0.14, true),
  ('openrouter', 'amazon/nova-premier-v1', 2.5, 12.5, true),
  ('openrouter', 'amazon/nova-pro-v1', 0.8, 3.2, true),
  ('openrouter', 'anthropic/claude-3-haiku', 0.25, 1.25, true),
  ('openrouter', 'anthropic/claude-3.5-haiku', 0.8, 4, true),
  ('openrouter', 'anthropic/claude-haiku-4.5', 1, 5, true),
  ('openrouter', 'anthropic/claude-opus-4', 15, 75, true),
  ('openrouter', 'anthropic/claude-opus-4.1', 15, 75, true),
  ('openrouter', 'anthropic/claude-opus-4.5', 5, 25, true),
  ('openrouter', 'anthropic/claude-opus-4.6', 5, 25, true),
  ('openrouter', 'anthropic/claude-opus-4.6-fast', 30, 150, true),
  ('openrouter', 'anthropic/claude-opus-4.7', 5, 25, true),
  ('openrouter', 'anthropic/claude-opus-4.7-fast', 30, 150, true),
  ('openrouter', 'anthropic/claude-opus-4.8', 5, 25, true),
  ('openrouter', 'anthropic/claude-opus-4.8-fast', 10, 50, true),
  ('openrouter', 'anthropic/claude-sonnet-4', 3, 15, true),
  ('openrouter', 'anthropic/claude-sonnet-4.5', 3, 15, true),
  ('openrouter', 'anthropic/claude-sonnet-4.6', 3, 15, true),
  ('openrouter', 'cohere/command-a', 2.5, 10, true),
  ('openrouter', 'cohere/command-r-08-2024', 0.15, 0.6, true),
  ('openrouter', 'cohere/command-r-plus-08-2024', 2.5, 10, true),
  ('openrouter', 'cohere/command-r7b-12-2024', 0.0375, 0.15, true),
  ('openrouter', 'deepseek/deepseek-chat', 0.2002, 0.8001, true),
  ('openrouter', 'deepseek/deepseek-chat-v3-0324', 0.2, 0.77, true),
  ('openrouter', 'deepseek/deepseek-chat-v3.1', 0.21, 0.79, true),
  ('openrouter', 'deepseek/deepseek-r1', 0.7, 2.5, true),
  ('openrouter', 'deepseek/deepseek-r1-0528', 0.5, 2.15, true),
  ('openrouter', 'deepseek/deepseek-r1-distill-llama-70b', 0.8, 0.8, true),
  ('openrouter', 'deepseek/deepseek-r1-distill-qwen-32b', 0.29, 0.29, true),
  ('openrouter', 'deepseek/deepseek-v3.1-terminus', 0.27, 0.95, true),
  ('openrouter', 'deepseek/deepseek-v3.2', 0.2288, 0.3432, true),
  ('openrouter', 'deepseek/deepseek-v3.2-exp', 0.27, 0.41, true),
  ('openrouter', 'google/gemini-2.5-flash', 0.3, 2.5, true),
  ('openrouter', 'google/gemini-2.5-flash-image', 0.3, 2.5, true),
  ('openrouter', 'google/gemini-2.5-flash-lite', 0.1, 0.4, true),
  ('openrouter', 'google/gemini-2.5-flash-lite-preview-09-2025', 0.1, 0.4, true),
  ('openrouter', 'google/gemini-2.5-pro', 1.25, 10, true),
  ('openrouter', 'google/gemini-2.5-pro-preview', 1.25, 10, true),
  ('openrouter', 'google/gemini-2.5-pro-preview-05-06', 1.25, 10, true),
  ('openrouter', 'google/gemini-3-flash-preview', 0.5, 3, true),
  ('openrouter', 'google/gemini-3-pro-image-preview', 2, 12, true),
  ('openrouter', 'google/gemini-3.1-flash-image-preview', 0.5, 3, true),
  ('openrouter', 'google/gemini-3.1-flash-lite', 0.25, 1.5, true),
  ('openrouter', 'google/gemini-3.1-flash-lite-preview', 0.25, 1.5, true),
  ('openrouter', 'google/gemini-3.1-pro-preview', 2, 12, true),
  ('openrouter', 'google/gemini-3.1-pro-preview-customtools', 2, 12, true),
  ('openrouter', 'google/gemini-3.5-flash', 1.5, 9, true),
  ('openrouter', 'meta-llama/llama-3-70b-instruct', 0.51, 0.74, true),
  ('openrouter', 'meta-llama/llama-3-8b-instruct', 0.14, 0.14, true),
  ('openrouter', 'meta-llama/llama-3.1-70b-instruct', 0.4, 0.4, true),
  ('openrouter', 'meta-llama/llama-3.1-8b-instruct', 0.02, 0.03, true),
  ('openrouter', 'meta-llama/llama-3.2-11b-vision-instruct', 0.345, 0.345, true),
  ('openrouter', 'meta-llama/llama-3.2-1b-instruct', 0.027, 0.201, true),
  ('openrouter', 'meta-llama/llama-3.2-3b-instruct', 0.0509, 0.335, true),
  ('openrouter', 'meta-llama/llama-3.3-70b-instruct', 0.1, 0.32, true),
  ('openrouter', 'meta-llama/llama-4-maverick', 0.15, 0.6, true),
  ('openrouter', 'meta-llama/llama-4-scout', 0.1, 0.3, true),
  ('openrouter', 'mistralai/codestral-2508', 0.3, 0.9, true),
  ('openrouter', 'mistralai/mistral-large', 2, 6, true),
  ('openrouter', 'mistralai/mistral-large-2407', 2, 6, true),
  ('openrouter', 'mistralai/mistral-large-2512', 0.5, 1.5, true),
  ('openrouter', 'mistralai/mistral-medium-3', 0.4, 2, true),
  ('openrouter', 'mistralai/mistral-medium-3-5', 1.5, 7.5, true),
  ('openrouter', 'mistralai/mistral-medium-3.1', 0.4, 2, true),
  ('openrouter', 'mistralai/mistral-small-24b-instruct-2501', 0.05, 0.08, true),
  ('openrouter', 'mistralai/mistral-small-2603', 0.15, 0.6, true),
  ('openrouter', 'mistralai/mistral-small-3.1-24b-instruct', 0.351, 0.555, true),
  ('openrouter', 'mistralai/mistral-small-3.2-24b-instruct', 0.075, 0.2, true),
  ('openrouter', 'moonshotai/kimi-k2', 0.57, 2.3, true),
  ('openrouter', 'moonshotai/kimi-k2-0905', 0.6, 2.5, true),
  ('openrouter', 'moonshotai/kimi-k2-thinking', 0.6, 2.5, true),
  ('openrouter', 'moonshotai/kimi-k2.5', 0.375, 2.025, true),
  ('openrouter', 'moonshotai/kimi-k2.6', 0.68, 3.41, true),
  ('openrouter', 'moonshotai/kimi-k2.7-code', 0.95, 4, true),
  ('openrouter', 'openai/gpt-4.1', 2, 8, true),
  ('openrouter', 'openai/gpt-4.1-mini', 0.4, 1.6, true),
  ('openrouter', 'openai/gpt-4.1-nano', 0.1, 0.4, true),
  ('openrouter', 'openai/gpt-4o', 2.5, 10, true),
  ('openrouter', 'openai/gpt-4o-2024-05-13', 5, 15, true),
  ('openrouter', 'openai/gpt-4o-2024-08-06', 2.5, 10, true),
  ('openrouter', 'openai/gpt-4o-2024-11-20', 2.5, 10, true),
  ('openrouter', 'openai/gpt-4o-mini', 0.15, 0.6, true),
  ('openrouter', 'openai/gpt-4o-mini-2024-07-18', 0.15, 0.6, true),
  ('openrouter', 'openai/gpt-4o-mini-search-preview', 0.15, 0.6, true),
  ('openrouter', 'openai/gpt-4o-search-preview', 2.5, 10, true),
  ('openrouter', 'openai/gpt-5', 1.25, 10, true),
  ('openrouter', 'openai/gpt-5-chat', 1.25, 10, true),
  ('openrouter', 'openai/gpt-5-codex', 1.25, 10, true),
  ('openrouter', 'openai/gpt-5-image', 10, 10, true),
  ('openrouter', 'openai/gpt-5-image-mini', 2.5, 2, true),
  ('openrouter', 'openai/gpt-5-mini', 0.25, 2, true),
  ('openrouter', 'openai/gpt-5-nano', 0.05, 0.4, true),
  ('openrouter', 'openai/gpt-5-pro', 15, 120, true),
  ('openrouter', 'openai/gpt-5.1', 1.25, 10, true),
  ('openrouter', 'openai/gpt-5.1-chat', 1.25, 10, true),
  ('openrouter', 'openai/gpt-5.1-codex', 1.25, 10, true),
  ('openrouter', 'openai/gpt-5.1-codex-max', 1.25, 10, true),
  ('openrouter', 'openai/gpt-5.1-codex-mini', 0.25, 2, true),
  ('openrouter', 'openai/gpt-5.2', 1.75, 14, true),
  ('openrouter', 'openai/gpt-5.2-chat', 1.75, 14, true),
  ('openrouter', 'openai/gpt-5.2-codex', 1.75, 14, true),
  ('openrouter', 'openai/gpt-5.2-pro', 21, 168, true),
  ('openrouter', 'openai/gpt-5.3-chat', 1.75, 14, true),
  ('openrouter', 'openai/gpt-5.3-codex', 1.75, 14, true),
  ('openrouter', 'openai/gpt-5.4', 2.5, 15, true),
  ('openrouter', 'openai/gpt-5.4-image-2', 8, 15, true),
  ('openrouter', 'openai/gpt-5.4-mini', 0.75, 4.5, true),
  ('openrouter', 'openai/gpt-5.4-nano', 0.2, 1.25, true),
  ('openrouter', 'openai/gpt-5.4-pro', 30, 180, true),
  ('openrouter', 'openai/gpt-5.5', 5, 30, true),
  ('openrouter', 'openai/gpt-5.5-pro', 30, 180, true),
  ('openrouter', 'openai/o1', 15, 60, true),
  ('openrouter', 'openai/o1-pro', 150, 600, true),
  ('openrouter', 'openai/o3', 2, 8, true),
  ('openrouter', 'openai/o3-deep-research', 10, 40, true),
  ('openrouter', 'openai/o3-mini', 1.1, 4.4, true),
  ('openrouter', 'openai/o3-mini-high', 1.1, 4.4, true),
  ('openrouter', 'openai/o3-pro', 20, 80, true),
  ('openrouter', 'openai/o4-mini', 1.1, 4.4, true),
  ('openrouter', 'openai/o4-mini-deep-research', 2, 8, true),
  ('openrouter', 'openai/o4-mini-high', 1.1, 4.4, true),
  ('openrouter', 'qwen/qwen-2.5-72b-instruct', 0.36, 0.4, true),
  ('openrouter', 'qwen/qwen-2.5-7b-instruct', 0.04, 0.1, true),
  ('openrouter', 'qwen/qwen-2.5-coder-32b-instruct', 0.66, 1, true),
  ('openrouter', 'qwen/qwen3-14b', 0.1, 0.24, true),
  ('openrouter', 'qwen/qwen3-235b-a22b', 0.455, 1.82, true),
  ('openrouter', 'qwen/qwen3-235b-a22b-2507', 0.09, 0.1, true),
  ('openrouter', 'qwen/qwen3-235b-a22b-thinking-2507', 0.1, 0.1, true),
  ('openrouter', 'qwen/qwen3-30b-a3b', 0.12, 0.5, true),
  ('openrouter', 'qwen/qwen3-30b-a3b-instruct-2507', 0.04815, 0.19305, true),
  ('openrouter', 'qwen/qwen3-30b-a3b-thinking-2507', 0.08, 0.4, true),
  ('openrouter', 'qwen/qwen3-32b', 0.08, 0.28, true),
  ('openrouter', 'qwen/qwen3-8b', 0.05, 0.4, true),
  ('openrouter', 'qwen/qwen3-coder', 0.22, 1.8, true),
  ('openrouter', 'qwen/qwen3-coder-30b-a3b-instruct', 0.07, 0.27, true),
  ('openrouter', 'qwen/qwen3-coder-flash', 0.195, 0.975, true),
  ('openrouter', 'qwen/qwen3-coder-next', 0.11, 0.8, true),
  ('openrouter', 'qwen/qwen3-coder-plus', 0.65, 3.25, true),
  ('openrouter', 'qwen/qwen3-max', 0.78, 3.9, true),
  ('openrouter', 'qwen/qwen3-max-thinking', 0.78, 3.9, true),
  ('openrouter', 'qwen/qwen3-next-80b-a3b-instruct', 0.09, 1.1, true),
  ('openrouter', 'qwen/qwen3-next-80b-a3b-thinking', 0.0975, 0.78, true),
  ('openrouter', 'qwen/qwen3-vl-235b-a22b-instruct', 0.2, 0.88, true),
  ('openrouter', 'qwen/qwen3-vl-235b-a22b-thinking', 0.26, 2.6, true),
  ('openrouter', 'qwen/qwen3-vl-30b-a3b-instruct', 0.13, 0.52, true),
  ('openrouter', 'qwen/qwen3-vl-30b-a3b-thinking', 0.13, 1.56, true),
  ('openrouter', 'qwen/qwen3-vl-32b-instruct', 0.104, 0.416, true),
  ('openrouter', 'qwen/qwen3-vl-8b-instruct', 0.08, 0.5, true),
  ('openrouter', 'qwen/qwen3-vl-8b-thinking', 0.117, 1.365, true),
  ('openrouter', 'qwen/qwen3.5-122b-a10b', 0.26, 2.08, true),
  ('openrouter', 'qwen/qwen3.5-27b', 0.195, 1.56, true),
  ('openrouter', 'qwen/qwen3.5-35b-a3b', 0.14, 1, true),
  ('openrouter', 'qwen/qwen3.5-397b-a17b', 0.39, 2.34, true),
  ('openrouter', 'qwen/qwen3.5-9b', 0.1, 0.15, true),
  ('openrouter', 'qwen/qwen3.5-flash-02-23', 0.065, 0.26, true),
  ('openrouter', 'qwen/qwen3.5-plus-02-15', 0.26, 1.56, true),
  ('openrouter', 'qwen/qwen3.5-plus-20260420', 0.3, 1.8, true),
  ('openrouter', 'qwen/qwen3.6-27b', 0.2885, 3.17, true),
  ('openrouter', 'qwen/qwen3.6-35b-a3b', 0.15, 1, true),
  ('openrouter', 'qwen/qwen3.6-flash', 0.1875, 1.125, true),
  ('openrouter', 'qwen/qwen3.6-max-preview', 1.04, 6.24, true),
  ('openrouter', 'qwen/qwen3.6-plus', 0.325, 1.95, true),
  ('openrouter', 'qwen/qwen3.7-max', 1.25, 3.75, true),
  ('openrouter', 'qwen/qwen3.7-plus', 0.32, 1.28, true),
  ('openrouter', 'x-ai/grok-4.20', 1.25, 2.5, true),
  ('openrouter', 'x-ai/grok-4.20-multi-agent', 2, 6, true),
  ('openrouter', 'x-ai/grok-4.3', 1.25, 2.5, true),
  ('openrouter', 'x-ai/grok-build-0.1', 1, 2, true)
ON CONFLICT (provider, model) DO UPDATE SET
  prompt_price_per_1m     = EXCLUDED.prompt_price_per_1m,
  completion_price_per_1m = EXCLUDED.completion_price_per_1m,
  chat_capable            = EXCLUDED.chat_capable,
  updated_at              = now();
