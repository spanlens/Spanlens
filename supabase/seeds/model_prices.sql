-- Seed: Model pricing table (USD per 1M tokens, verified against provider pricing 2026-05)
--
-- Cache pricing notes:
--   • Anthropic prompt caching — cache_read = 0.1 × input price · cache_write (5min ephemeral) = 1.25 × input price
--   • OpenAI prompt caching    — cached input ≈ 0.5 × input price (gpt-4o / gpt-4.1 families; no cache_write concept)
--   • Models without official cache pricing use NULL → calculateCost() falls back to charging the regular prompt price.
INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── OpenAI ────────────────────────────────────────────────────────────────
  ('openai', 'gpt-4o',           2.50,  10.00,   1.25,   NULL),
  ('openai', 'gpt-4o-mini',      0.15,   0.60,   0.075,  NULL),
  ('openai', 'gpt-4.1',          2.00,   8.00,   0.50,   NULL),
  ('openai', 'gpt-4.1-mini',     0.40,   1.60,   0.10,   NULL),
  ('openai', 'gpt-4.1-nano',     0.10,   0.40,   0.025,  NULL),
  ('openai', 'gpt-4-turbo',     10.00,  30.00,   NULL,   NULL),
  ('openai', 'gpt-4',           30.00,  60.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo',    0.50,   1.50,   NULL,   NULL),
  -- ── Anthropic ─────────────────────────────────────────────────────────────
  ('anthropic', 'claude-opus-4-7',              5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-sonnet-4-6',            3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-haiku-4-5',             1.00,   5.00,   0.10,   1.25),
  ('anthropic', 'claude-haiku-4-5-20251001',    1.00,   5.00,   0.10,   1.25),
  ('anthropic', 'claude-3-5-sonnet-20241022',   3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-3-5-haiku-20241022',    0.80,   4.00,   0.08,   1.00),
  ('anthropic', 'claude-3-opus-20240229',      15.00,  75.00,   1.50,  18.75),
  -- ── Gemini (caching not yet exposed in our integration) ──────────────────
  ('gemini', 'gemini-2.5-pro',        1.25, 10.00,   NULL, NULL),
  ('gemini', 'gemini-2.5-flash',      0.30,  2.50,   NULL, NULL),
  ('gemini', 'gemini-2.5-flash-lite', 0.10,  0.40,   NULL, NULL),
  ('gemini', 'gemini-2.0-flash',      0.10,  0.40,   NULL, NULL), -- deprecated 2026-06-01, kept for historical data
  ('gemini', 'gemini-1.5-pro',        1.25,  5.00,   NULL, NULL),
  ('gemini', 'gemini-1.5-flash',      0.075, 0.30,   NULL, NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();
