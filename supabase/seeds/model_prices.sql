-- Seed: Model pricing table (USD per 1M tokens, verified against provider pricing 2026-05-22)
--
-- Cache pricing notes:
--   • Anthropic prompt caching — cache_read = 0.1 × input price · cache_write (5min ephemeral) = 1.25 × input price
--   • OpenAI prompt caching    — cached input ≈ 0.5 × input price (gpt-4o / gpt-4.1 families; varies by model in GPT-5.x; no cache_write concept)
--   • Gemini context caching   — priced by Google but our integration doesn't surface it yet, so leave NULL
--   • Tiered prices (Gemini Pro / 2.5 Computer Use) use the ≤200k token band — most production traffic fits
INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── OpenAI: GPT-5.x flagship family ───────────────────────────────────────
  ('openai', 'gpt-5.5',                          5.00,  30.00,   0.50,   NULL),
  ('openai', 'gpt-5.5-pro',                     30.00, 180.00,   NULL,   NULL),
  ('openai', 'gpt-5.4',                          2.50,  15.00,   0.25,   NULL),
  ('openai', 'gpt-5.4-mini',                     0.75,   4.50,   0.075,  NULL),
  ('openai', 'gpt-5.4-nano',                     0.20,   1.25,   0.02,   NULL),
  ('openai', 'gpt-5.4-pro',                     30.00, 180.00,   NULL,   NULL),
  ('openai', 'gpt-5.3-codex',                    1.75,  14.00,   0.175,  NULL),
  -- ── OpenAI: GPT-5 base family (single tier — no long context) ───────────
  ('openai', 'gpt-5',                            1.25,  10.00,   0.125,  NULL),
  ('openai', 'gpt-5.1',                          1.25,  10.00,   0.125,  NULL),
  ('openai', 'gpt-5.2',                          1.75,  14.00,   0.175,  NULL),
  ('openai', 'gpt-5.2-pro',                     21.00, 168.00,   NULL,   NULL),
  ('openai', 'gpt-5-mini',                       0.25,   2.00,   0.025,  NULL),
  ('openai', 'gpt-5-nano',                       0.05,   0.40,   0.005,  NULL),
  ('openai', 'gpt-5-pro',                       15.00, 120.00,   NULL,   NULL),
  ('openai', 'chat-latest',                      5.00,  30.00,   0.50,   NULL), -- ChatGPT alias
  -- ── OpenAI: Reasoning (o-series) ─────────────────────────────────────────
  ('openai', 'o4-mini',                          1.10,   4.40,   0.275,  NULL),
  ('openai', 'o3',                               2.00,   8.00,   0.50,   NULL),
  ('openai', 'o3-mini',                          1.10,   4.40,   0.55,   NULL),
  ('openai', 'o3-pro',                          20.00,  80.00,   NULL,   NULL),
  ('openai', 'o1',                              15.00,  60.00,   7.50,   NULL),
  ('openai', 'o1-mini',                          1.10,   4.40,   0.55,   NULL),
  ('openai', 'o1-pro',                         150.00, 600.00,   NULL,   NULL),
  -- ── OpenAI: GPT-4.x ──────────────────────────────────────────────────────
  ('openai', 'gpt-4o',                           2.50,  10.00,   1.25,   NULL),
  ('openai', 'gpt-4o-mini',                      0.15,   0.60,   0.075,  NULL),
  ('openai', 'gpt-4o-2024-05-13',                5.00,  15.00,   NULL,   NULL), -- dated variant
  ('openai', 'gpt-4.1',                          2.00,   8.00,   0.50,   NULL),
  ('openai', 'gpt-4.1-mini',                     0.40,   1.60,   0.10,   NULL),
  ('openai', 'gpt-4.1-nano',                     0.10,   0.40,   0.025,  NULL),
  ('openai', 'gpt-4-turbo',                     10.00,  30.00,   NULL,   NULL),
  ('openai', 'gpt-4-turbo-2024-04-09',          10.00,  30.00,   NULL,   NULL),
  ('openai', 'gpt-4-0125-preview',              10.00,  30.00,   NULL,   NULL),
  ('openai', 'gpt-4-1106-preview',              10.00,  30.00,   NULL,   NULL),
  ('openai', 'gpt-4-1106-vision-preview',       10.00,  30.00,   NULL,   NULL),
  ('openai', 'gpt-4',                           30.00,  60.00,   NULL,   NULL),
  ('openai', 'gpt-4-0613',                      30.00,  60.00,   NULL,   NULL),
  ('openai', 'gpt-4-0314',                      30.00,  60.00,   NULL,   NULL),
  ('openai', 'gpt-4-32k',                       60.00, 120.00,   NULL,   NULL),
  -- ── OpenAI: GPT-3.5 + base models ────────────────────────────────────────
  ('openai', 'gpt-3.5-turbo',                    0.50,   1.50,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-0125',               0.50,   1.50,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-1106',               1.00,   2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-0613',               1.50,   2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-0301',                     1.50,   2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-instruct',           1.50,   2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-16k-0613',           3.00,   4.00,   NULL,   NULL),
  ('openai', 'davinci-002',                      2.00,   2.00,   NULL,   NULL),
  ('openai', 'babbage-002',                      0.40,   0.40,   NULL,   NULL),
  -- ── Anthropic: Claude 4.x (aliases + dated variants) ────────────────────
  ('anthropic', 'claude-opus-4-7',               5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-opus-4-6',               5.00,  25.00,   0.50,   6.25), -- alias only; no dated form per docs
  ('anthropic', 'claude-opus-4-5',               5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-opus-4-5-20251101',      5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-opus-4-1',              15.00,  75.00,   1.50,  18.75),
  ('anthropic', 'claude-opus-4-1-20250805',     15.00,  75.00,   1.50,  18.75),
  ('anthropic', 'claude-opus-4',                15.00,  75.00,   1.50,  18.75), -- deprecated
  ('anthropic', 'claude-opus-4-0',              15.00,  75.00,   1.50,  18.75), -- deprecated alias
  ('anthropic', 'claude-opus-4-20250514',       15.00,  75.00,   1.50,  18.75), -- deprecated dated
  ('anthropic', 'claude-sonnet-4-6',             3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-sonnet-4-5',             3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-sonnet-4-5-20250929',    3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-sonnet-4',               3.00,  15.00,   0.30,   3.75), -- deprecated
  ('anthropic', 'claude-sonnet-4-0',             3.00,  15.00,   0.30,   3.75), -- deprecated alias
  ('anthropic', 'claude-sonnet-4-20250514',      3.00,  15.00,   0.30,   3.75), -- deprecated dated
  ('anthropic', 'claude-haiku-4-5',              1.00,   5.00,   0.10,   1.25),
  ('anthropic', 'claude-haiku-4-5-20251001',     1.00,   5.00,   0.10,   1.25),
  -- ── Anthropic: Claude 3.x ────────────────────────────────────────────────
  ('anthropic', 'claude-3-5-sonnet-20241022',    3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-3-5-haiku-20241022',     0.80,   4.00,   0.08,   1.00),
  ('anthropic', 'claude-3-opus-20240229',       15.00,  75.00,   1.50,  18.75),
  ('anthropic', 'claude-3-haiku-20240307',       0.25,   1.25,   NULL,   NULL), -- retired 2026-04-19
  -- ── Gemini 3.x ───────────────────────────────────────────────────────────
  ('gemini', 'gemini-3.5-flash',                       1.50,   9.00,   NULL, NULL),
  ('gemini', 'gemini-3.1-pro-preview',                 2.00,  12.00,   NULL, NULL), -- ≤200k tier; >200k is 4.00/18.00
  ('gemini', 'gemini-3.1-pro-preview-customtools',     2.00,  12.00,   NULL, NULL),
  ('gemini', 'gemini-3.1-flash-lite',                  0.25,   1.50,   NULL, NULL),
  ('gemini', 'gemini-3.1-flash-lite-preview',          0.25,   1.50,   NULL, NULL),
  ('gemini', 'gemini-3-flash-preview',                 0.50,   3.00,   NULL, NULL),
  -- ── Gemini 2.5 ───────────────────────────────────────────────────────────
  ('gemini', 'gemini-2.5-pro',                         1.25,  10.00,   NULL, NULL), -- ≤200k tier; >200k is 2.50/15.00
  ('gemini', 'gemini-2.5-flash',                       0.30,   2.50,   NULL, NULL),
  ('gemini', 'gemini-2.5-flash-lite',                  0.10,   0.40,   NULL, NULL),
  ('gemini', 'gemini-2.5-flash-lite-preview-09-2025',  0.10,   0.40,   NULL, NULL),
  ('gemini', 'gemini-2.5-computer-use-preview-10-2025', 1.25, 10.00,   NULL, NULL), -- ≤200k tier; >200k is 2.50/15.00
  -- ── Gemini 2.0 / 1.5 ─────────────────────────────────────────────────────
  ('gemini', 'gemini-2.0-flash',                       0.10,   0.40,   NULL, NULL), -- deprecated 2026-06-01
  ('gemini', 'gemini-2.0-flash-lite',                  0.075,  0.30,   NULL, NULL), -- deprecated 2026-06-01
  ('gemini', 'gemini-1.5-pro',                         1.25,   5.00,   NULL, NULL),
  ('gemini', 'gemini-1.5-flash',                       0.075,  0.30,   NULL, NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

-- ── Long context (tiered) pricing ───────────────────────────────────────────
-- See lib/cost.ts: when promptTokens > long_context_threshold_tokens the
-- long_* columns override the short-tier prices on the same row.
--
--   OpenAI threshold = 272,000 tokens (per the pricing-page tooltip on the Long context header)
--   Gemini threshold = 200,000 tokens (Pro family explicit ≤/> split)
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
