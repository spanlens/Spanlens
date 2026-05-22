-- Migration: Fix wrong Anthropic dated IDs added in 20260522030000
--
-- Per the canonical model overview page
-- (https://platform.claude.com/docs/en/about-claude/models/overview, verified
-- 2026-05-22), the legacy Claude API IDs are:
--
--   Opus 4.6   → claude-opus-4-6                   (no dated suffix exists)
--   Sonnet 4.5 → claude-sonnet-4-5-20250929         (NOT 20251101)
--   Opus 4.5   → claude-opus-4-5-20251101           (NOT 20251105)
--
-- The previous migration added the dated suffixes shifted by one model — the
-- 20250929 date actually belongs to Sonnet 4.5, and 20251101 to Opus 4.5.
-- Opus 4.6 doesn't have a dated suffix at all (only the alias).
--
-- The wrong rows are harmless (no real API call will ever return those exact
-- model strings, so cost.ts prefix-fallback still resolves the cost correctly)
-- but they pollute the table. Clean up + add correct rows.

DELETE FROM model_prices
 WHERE provider = 'anthropic'
   AND model IN (
     'claude-opus-4-6-20250929',
     'claude-sonnet-4-5-20251101',
     'claude-opus-4-5-20251105'
   );

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  ('anthropic', 'claude-sonnet-4-5-20250929',   3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-opus-4-5-20251101',     5.00,  25.00,   0.50,   6.25)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();
