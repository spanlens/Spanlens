-- Migration: Add the rest of OpenAI's "All models" listing
--
-- WHY
--   The 20260522000000 migration only added the flagship GPT-5.4/5.5 row,
--   missing everything under the "All models" expander on the pricing page:
--     • GPT-5 base family (gpt-5, 5.1, 5.2, plus mini/nano/pro variants)
--     • Reasoning models (o1, o1-mini, o1-pro, o3, o3-mini, o3-pro, o4-mini)
--     • Dated variants still callable (gpt-4o-2024-05-13, gpt-4-turbo-2024-04-09,
--       gpt-4-0125-preview, gpt-4-1106-preview, gpt-4-1106-vision-preview,
--       gpt-4-0613, gpt-4-0314, gpt-4-32k)
--     • Legacy GPT-3.5 variants and base models (davinci-002, babbage-002)
--   Without these, any customer call hitting them returned cost_usd = NULL on
--   the requests row (CLAUDE.md gotcha #2).
--
-- TIERING
--   None of the "All models" entries have an OpenAI-published long-context
--   tier on the pricing page — only the flagship 5.4/5.5 quadrants do. So
--   these rows are single-tier (long_context_threshold_tokens stays NULL).

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── GPT-5 base family (no long tier) ──────────────────────────────────────
  ('openai', 'gpt-5',                          1.25,   10.00,   0.125,  NULL),
  ('openai', 'gpt-5.1',                        1.25,   10.00,   0.125,  NULL),
  ('openai', 'gpt-5.2',                        1.75,   14.00,   0.175,  NULL),
  ('openai', 'gpt-5.2-pro',                   21.00,  168.00,   NULL,   NULL),
  ('openai', 'gpt-5-mini',                     0.25,    2.00,   0.025,  NULL),
  ('openai', 'gpt-5-nano',                     0.05,    0.40,   0.005,  NULL),
  ('openai', 'gpt-5-pro',                     15.00,  120.00,   NULL,   NULL),
  -- ── Reasoning models (o-series) ──────────────────────────────────────────
  ('openai', 'o4-mini',                        1.10,    4.40,   0.275,  NULL),
  ('openai', 'o3',                             2.00,    8.00,   0.50,   NULL),
  ('openai', 'o3-mini',                        1.10,    4.40,   0.55,   NULL),
  ('openai', 'o3-pro',                        20.00,   80.00,   NULL,   NULL),
  ('openai', 'o1',                            15.00,   60.00,   7.50,   NULL),
  ('openai', 'o1-mini',                        1.10,    4.40,   0.55,   NULL),
  ('openai', 'o1-pro',                       150.00,  600.00,   NULL,   NULL),
  -- ── Dated GPT-4 variants (still callable; pin same prices as their families) ──
  ('openai', 'gpt-4o-2024-05-13',              5.00,   15.00,   NULL,   NULL),
  ('openai', 'gpt-4-turbo-2024-04-09',        10.00,   30.00,   NULL,   NULL),
  ('openai', 'gpt-4-0125-preview',            10.00,   30.00,   NULL,   NULL),
  ('openai', 'gpt-4-1106-preview',            10.00,   30.00,   NULL,   NULL),
  ('openai', 'gpt-4-1106-vision-preview',     10.00,   30.00,   NULL,   NULL),
  ('openai', 'gpt-4-0613',                    30.00,   60.00,   NULL,   NULL),
  ('openai', 'gpt-4-0314',                    30.00,   60.00,   NULL,   NULL),
  ('openai', 'gpt-4-32k',                     60.00,  120.00,   NULL,   NULL),
  -- ── Legacy GPT-3.5 variants ──────────────────────────────────────────────
  ('openai', 'gpt-3.5-turbo-0125',             0.50,    1.50,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-1106',             1.00,    2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-0613',             1.50,    2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-0301',                   1.50,    2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-instruct',         1.50,    2.00,   NULL,   NULL),
  ('openai', 'gpt-3.5-turbo-16k-0613',         3.00,    4.00,   NULL,   NULL),
  -- ── Base models ──────────────────────────────────────────────────────────
  ('openai', 'davinci-002',                    2.00,    2.00,   NULL,   NULL),
  ('openai', 'babbage-002',                    0.40,    0.40,   NULL,   NULL),
  -- ── Specialized: ChatGPT chat-latest (alias kept for completeness) ───────
  ('openai', 'chat-latest',                    5.00,   30.00,   0.50,   NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();
