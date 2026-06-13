-- Fix Mistral model prices — visually verified against mistral.ai/pricing
-- via Chrome MCP on 2026-06-13.
--
-- PR #327 (earlier today) seeded prices that don't match Mistral's current
-- published lineup. Root cause: Mistral renamed/repositioned models in their
-- 2026 release (the "Medium" slot is now flagship Medium 3.5, "Small" is
-- Small 4 at a lower price tier, "Large" is the open-weights Large 3 at a
-- different price). PR #327 had the old lineup's numbers.
--
-- Customer billing impact of this fix:
--   - mistral-large-latest: charged 4x too much before (was $2/$6, actually $0.5/$1.5)
--   - mistral-medium-latest: charged 3.75x too LITTLE before (was $0.4/$2.0, actually $1.5/$7.5)
--   - mistral-small-latest: charged 2x too much (was $0.2/$0.6, actually $0.1/$0.3)
--   - codestral-latest: 1.5x too little (was $0.2/$0.6, actually $0.3/$0.9)
--   - ministral-3b/8b-latest: half the actual price
--
-- New models added: devstral-medium/small, magistral-medium/small, ministral-14b,
-- voxtral-small (text path only), codestral-embed, mistral-moderation-2603.
--
-- Intentionally NOT touched (DB has them but page doesn't show — keep as
-- historical fallback for past requests.model rows; they're harmless if no
-- new traffic hits them): pixtral-large-latest, pixtral-12b, mixtral-8x22b,
-- open-mistral-nemo.
--
-- Audio/page-based models excluded entirely (voxtral-mini-tts: per 1k chars,
-- voxtral-mini-transcribe: per minute, mistral-ocr-latest: per 1k pages) —
-- the model_prices schema only handles per-token pricing.

-- ────────────────────────────────────────────────────────────────────────
-- 1. Fix prices on existing rows
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  chat_capable
) VALUES
  ('mistral', 'mistral-large-latest',  0.50, 1.50, true),
  ('mistral', 'mistral-medium-latest', 1.50, 7.50, true),
  ('mistral', 'mistral-small-latest',  0.10, 0.30, true),
  ('mistral', 'codestral-latest',      0.30, 0.90, true),
  ('mistral', 'ministral-3b-latest',   0.10, 0.10, true),
  ('mistral', 'ministral-8b-latest',   0.15, 0.15, true)
ON CONFLICT (provider, model) DO UPDATE SET
  prompt_price_per_1m     = EXCLUDED.prompt_price_per_1m,
  completion_price_per_1m = EXCLUDED.completion_price_per_1m,
  chat_capable            = EXCLUDED.chat_capable,
  updated_at              = now();

-- ────────────────────────────────────────────────────────────────────────
-- 2. Add new models
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  chat_capable
) VALUES
  -- Devstral 2 (coding agents)
  ('mistral', 'devstral-medium-latest',     0.40, 2.00, true),
  ('mistral', 'devstral-small-latest',      0.10, 0.30, true),
  -- Magistral (reasoning / thinking)
  ('mistral', 'magistral-medium-latest',    2.00, 5.00, true),
  ('mistral', 'magistral-small-latest',     0.50, 1.50, true),
  -- Ministral 3 frontier-edge lineup
  ('mistral', 'ministral-14b-latest',       0.20, 0.20, true),
  -- Voxtral text path (audio path is per-minute, not per-token — skipped)
  ('mistral', 'voxtral-small-latest',       0.10, 0.40, true),
  -- Embeddings (input only — completion price is 0)
  ('mistral', 'codestral-embed',            0.15, 0,    true),
  -- Classifier (single-direction; input rate, no completion tokens)
  ('mistral', 'mistral-moderation-2603',    0.10, 0,    true)
ON CONFLICT (provider, model) DO UPDATE SET
  prompt_price_per_1m     = EXCLUDED.prompt_price_per_1m,
  completion_price_per_1m = EXCLUDED.completion_price_per_1m,
  chat_capable            = EXCLUDED.chat_capable,
  updated_at              = now();
