-- Migration: Add tiered (long context) pricing to model_prices
--
-- WHY
--   Some providers charge a different rate once the prompt crosses a threshold:
--     • OpenAI GPT-5.x  — short context <272k tokens, long ≥272k (≈2× short)
--     • Gemini Pro 2.5  — short ≤200k tokens, long >200k (2× short input, 1.5× output)
--     • Gemini 3.1 Pro  — short ≤200k, long >200k (2× input, 1.5× output)
--     • Gemini 2.5 Computer Use — short ≤200k, long >200k (2× input, 1.5× output)
--   Previous schema stored a single per-token price, so calls in the long tier
--   were billed at the short-tier rate — under-counting customer cost by ~50%
--   on long-context calls.
--
-- DESIGN
--   • long_context_threshold_tokens  IS NULL → flat pricing (no tiering)
--   • long_context_threshold_tokens  IS NOT NULL → long_*_price_per_1m kicks in
--     when calculateCost() sees promptTokens > threshold.
--   • Each long_* column independently NULL-able. If long tier doesn't override
--     a particular axis (e.g. cache_write rarely differs), leave NULL and the
--     calculator falls back to the regular rate for that axis.

ALTER TABLE model_prices
  ADD COLUMN long_context_threshold_tokens   INTEGER,
  ADD COLUMN long_prompt_price_per_1m        NUMERIC(10, 6),
  ADD COLUMN long_completion_price_per_1m    NUMERIC(10, 6),
  ADD COLUMN long_cache_read_price_per_1m    NUMERIC(10, 6),
  ADD COLUMN long_cache_write_price_per_1m   NUMERIC(10, 6);

COMMENT ON COLUMN model_prices.long_context_threshold_tokens IS
  'Prompt tokens at which long-context pricing kicks in (calculateCost uses promptTokens > threshold). NULL = no tiering.';
COMMENT ON COLUMN model_prices.long_prompt_price_per_1m IS
  'USD per 1M prompt tokens when promptTokens > long_context_threshold_tokens. NULL = use prompt_price_per_1m.';
COMMENT ON COLUMN model_prices.long_completion_price_per_1m IS
  'USD per 1M completion tokens when in long-context tier. NULL = use completion_price_per_1m.';
COMMENT ON COLUMN model_prices.long_cache_read_price_per_1m IS
  'USD per 1M cache-read tokens when in long-context tier. NULL = use cache_read_price_per_1m.';
COMMENT ON COLUMN model_prices.long_cache_write_price_per_1m IS
  'USD per 1M cache-write tokens when in long-context tier. NULL = use cache_write_price_per_1m.';

-- ── Backfill tiered models ───────────────────────────────────────────────────
-- OpenAI: threshold 272,000 tokens (per pricing-page tooltip on the "Long context" header).
UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      = 10.00,
       long_completion_price_per_1m  = 45.00,
       long_cache_read_price_per_1m  =  1.00
 WHERE provider = 'openai' AND model = 'gpt-5.5';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      = 60.00,
       long_completion_price_per_1m  = 270.00
 WHERE provider = 'openai' AND model = 'gpt-5.5-pro';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  5.00,
       long_completion_price_per_1m  = 22.50,
       long_cache_read_price_per_1m  =  0.50
 WHERE provider = 'openai' AND model = 'gpt-5.4';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      = 60.00,
       long_completion_price_per_1m  = 270.00
 WHERE provider = 'openai' AND model = 'gpt-5.4-pro';

-- Gemini: threshold 200,000 (≤200k = short, >200k = long)
UPDATE model_prices
   SET long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      =  2.50,
       long_completion_price_per_1m  = 15.00
 WHERE provider = 'gemini' AND model = 'gemini-2.5-pro';

UPDATE model_prices
   SET long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      =  4.00,
       long_completion_price_per_1m  = 18.00
 WHERE provider = 'gemini' AND model IN ('gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools');

UPDATE model_prices
   SET long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      =  2.50,
       long_completion_price_per_1m  = 15.00
 WHERE provider = 'gemini' AND model = 'gemini-2.5-computer-use-preview-10-2025';
