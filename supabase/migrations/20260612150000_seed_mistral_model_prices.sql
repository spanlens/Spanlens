-- Seed pricing rows for Mistral's chat completion models.
--
-- Mistral's chat completion API is OpenAI-compatible (same request shape,
-- same SSE chunk format, same usage field), so the proxy reuses the OpenAI
-- parser and stream logger. The only piece that needs Mistral-specific data
-- is the pricing — provider tag `'mistral'` flows into requests.provider
-- so the dashboard can group by it.
--
-- Source: https://mistral.ai/technology/#pricing (2026-06 published rates),
-- USD per 1M tokens. cache pricing isn't published for Mistral; left NULL
-- so calculateCost falls back to the regular prompt price for any cached
-- portion (defensive — Mistral doesn't surface cache_read_tokens today).

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  ('mistral', 'mistral-large-latest',  2.00, 6.00, NULL, NULL),
  ('mistral', 'mistral-medium-latest', 0.40, 2.00, NULL, NULL),
  ('mistral', 'mistral-small-latest',  0.20, 0.60, NULL, NULL),
  ('mistral', 'pixtral-large-latest',  2.00, 6.00, NULL, NULL),
  ('mistral', 'pixtral-12b',           0.15, 0.15, NULL, NULL),
  ('mistral', 'codestral-latest',      0.20, 0.60, NULL, NULL),
  ('mistral', 'ministral-3b-latest',   0.04, 0.04, NULL, NULL),
  ('mistral', 'ministral-8b-latest',   0.10, 0.10, NULL, NULL),
  ('mistral', 'open-mistral-nemo',     0.15, 0.15, NULL, NULL),
  ('mistral', 'mixtral-8x22b',         2.00, 6.00, NULL, NULL),
  -- Embedding (input-only — completion price stays 0)
  ('mistral', 'mistral-embed',         0.10, 0.000, NULL, NULL)
ON CONFLICT (provider, model) DO NOTHING;
