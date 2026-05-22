-- Migration: Add dated/deprecated Anthropic model variants
--
-- WHY
--   The Anthropic API returns dated IDs (e.g. `claude-opus-4-6-20250929`) in
--   the response `model` field. We log exactly what the provider returns, so
--   requests.model often contains the dated suffix even when the caller used
--   the alias. cost.ts has a prefix fallback that catches most cases, but an
--   exact-match row is more accurate and avoids surprises when prices fork
--   between the alias and a future dated variant.
--
-- WHAT'S BEING ADDED
--   • Dated variants for opus-4-6 / sonnet-4-5 / opus-4-5 / opus-4-1
--   • Deprecated `*-0` aliases that the Anthropic SDK historically emitted
--   • Dated variants of deprecated opus-4 / sonnet-4
--   • claude-3-haiku-20240307 (Haiku 3 — retired 2026-04-19 per docs but still
--     callable on Bedrock / Vertex; keep for historical replay)
--
-- Cache pricing follows the standard Anthropic 0.1× input (cache_read) and
-- 1.25× input (5-minute cache_write) ratios. Haiku 3 left without cache
-- because the original Haiku 3 launch did not support prompt caching.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── Current dated variants (active) ──────────────────────────────────────
  ('anthropic', 'claude-opus-4-6-20250929',     5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-opus-4-5-20251105',     5.00,  25.00,   0.50,   6.25),
  ('anthropic', 'claude-opus-4-1-20250805',    15.00,  75.00,   1.50,  18.75),
  ('anthropic', 'claude-sonnet-4-5-20251101',   3.00,  15.00,   0.30,   3.75),
  -- ── Deprecated (still callable until shutoff) ────────────────────────────
  ('anthropic', 'claude-opus-4-20250514',      15.00,  75.00,   1.50,  18.75),
  ('anthropic', 'claude-opus-4-0',             15.00,  75.00,   1.50,  18.75),
  ('anthropic', 'claude-sonnet-4-20250514',     3.00,  15.00,   0.30,   3.75),
  ('anthropic', 'claude-sonnet-4-0',            3.00,  15.00,   0.30,   3.75),
  -- ── Haiku 3 (retired 2026-04-19, kept for historical replay) ─────────────
  ('anthropic', 'claude-3-haiku-20240307',      0.25,   1.25,   NULL,   NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();
