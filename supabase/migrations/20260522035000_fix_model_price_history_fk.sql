-- Migration: Fix model_price_history FK so model_prices DELETE works
--
-- THE BUG
--   20260519000000 created model_price_history with
--     model_price_id UUID NOT NULL REFERENCES model_prices(id) ON DELETE CASCADE
--   AND an AFTER DELETE trigger that inserts OLD.id into history.
--
--   On DELETE FROM model_prices:
--     1. AFTER trigger fires
--     2. Trigger tries to INSERT into history with model_price_id = <deleted id>
--     3. FK rejects: the parent row no longer exists → SQLSTATE 23503
--
--   This blocked migration 20260522040000 (cleanup of 3 wrong Anthropic
--   dated IDs) — the DELETE never succeeded.
--
-- THE FIX
--   History rows are an immutable audit trail. They should NOT FK back to
--   the live table — if they did and CASCADE ran, the audit would lose its
--   record exactly when you need it most (when something was deleted).
--   Drop the FK; keep model_price_id as a plain UUID column.
--
--   Now the trigger can safely insert history rows tracking deletions.
--
-- The retry of 20260522040000's intent (DELETE wrong + INSERT correct) is
-- folded into this migration so a fresh DB reset produces the same final
-- state as a sequential apply.

ALTER TABLE model_price_history
  DROP CONSTRAINT IF EXISTS model_price_history_model_price_id_fkey;

-- Retry the cleanup from 20260522040000 — safe now that DELETE doesn't
-- trip the FK on the history side.
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
