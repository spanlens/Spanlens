-- ─────────────────────────────────────────────────────────────────────────────
-- Cache token pricing (Anthropic prompt caching · OpenAI prompt caching)
--
-- WHY: Both Anthropic and OpenAI charge different prices for cached input tokens
-- vs. fresh input tokens. Until now Spanlens lumped everything into prompt_tokens
-- × prompt_price, which OVERCOUNTS cost by 2–10× for cache-heavy workloads.
--
-- SEMANTIC:
--   • `prompt_tokens`       = TOTAL input tokens (including any cached portion)
--                             — unchanged semantic, all existing aggregations
--                             keep working.
--   • `cache_read_tokens`   = subset of prompt_tokens that hit a cache
--                             (Anthropic: cache_read_input_tokens
--                              OpenAI:    prompt_tokens_details.cached_tokens)
--   • `cache_write_tokens`  = subset of prompt_tokens that CREATED a cache entry
--                             (Anthropic: cache_creation_input_tokens
--                              OpenAI:    no equivalent yet)
--
-- COST FORMULA (applied in lib/cost.ts):
--   non_cached      = prompt_tokens - cache_read_tokens - cache_write_tokens
--   total_cost_usd  = non_cached         × prompt_price
--                   + cache_read_tokens  × cache_read_price
--                   + cache_write_tokens × cache_write_price
--                   + completion_tokens  × completion_price
--
-- HISTORICAL DATA: untouched. Backfill not attempted because raw breakdown was
-- never recorded — request_body / response_body don't reliably contain
-- usage.cached_tokens / usage.cache_read_input_tokens fields for past rows
-- (especially streaming). Going forward, every new request stores the
-- breakdown.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE model_prices
  ADD COLUMN IF NOT EXISTS cache_read_price_per_1m  NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS cache_write_price_per_1m NUMERIC(10, 6);

COMMENT ON COLUMN model_prices.cache_read_price_per_1m  IS
  'USD per 1M cached input tokens (read). NULL = model does not support cache or pricing unknown.';
COMMENT ON COLUMN model_prices.cache_write_price_per_1m IS
  'USD per 1M cache-creation input tokens. NULL = model does not support cache writes or pricing unknown.';

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN requests.cache_read_tokens  IS
  'Number of input tokens that hit a prompt cache (subset of prompt_tokens). 0 if not applicable.';
COMMENT ON COLUMN requests.cache_write_tokens IS
  'Number of input tokens written to a prompt cache, charged at write price (subset of prompt_tokens). 0 if not applicable.';
