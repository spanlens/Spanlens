-- Seed pricing rows for OpenAI's embedding model family.
--
-- Why this exists: proxy/openai.ts already forwards POST /v1/embeddings to
-- OpenAI verbatim (the catch-all `.all('/*', ...)` route handles every path),
-- and parsers/openai.ts already extracts usage from the response (because the
-- parser only reads the `usage` field, not `choices`). The missing piece was
-- pricing — without rows here, lib/cost.ts.calculateCost('openai',
-- 'text-embedding-3-small', ...) returns null and the requests row lands
-- with cost_usd = NULL. RAG customers were seeing tokens but not cost.
--
-- Embeddings are input-only — completion_price stays at 0 (the calculator
-- multiplies by completion_tokens which is also 0 for embeddings). cache_read
-- pricing isn't a thing for embeddings on OpenAI as of 2026-06.
--
-- Source: https://openai.com/api/pricing (2026-06 published rates).
-- These are USD per 1M tokens, matching the rest of model_prices.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  ('openai', 'text-embedding-3-small', 0.020, 0.000, NULL, NULL),
  ('openai', 'text-embedding-3-large', 0.130, 0.000, NULL, NULL),
  ('openai', 'text-embedding-ada-002', 0.100, 0.000, NULL, NULL)
ON CONFLICT (provider, model) DO NOTHING;
