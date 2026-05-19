-- Seed: model substitute-matching rules (P3.3). Idempotent — ON CONFLICT
-- on (current_provider, current_model) updates each row in place so re-running
-- this seed safely refreshes the production rules.
--
-- Source: apps/server/src/lib/model-recommend-rules.ts FALLBACK_RULES.
-- Keep these two in sync — FALLBACK_RULES is the cold-start safety net used
-- when the DB is unreachable.
INSERT INTO model_recommendations (
  current_provider, current_model,
  suggested_provider, suggested_model,
  cost_ratio, max_avg_prompt_tokens, max_avg_completion_tokens, reason
) VALUES
  -- ── OpenAI ─────────────────────────────────────────────────────────
  ('openai', 'gpt-4o',       'openai', 'gpt-4o-mini',  0.06,  500,  150, 'Short inputs/outputs fit the gpt-4o-mini envelope — ~17x cheaper with comparable accuracy on classification, extraction, and short-form generation.'),
  ('openai', 'gpt-4.1',      'openai', 'gpt-4.1-mini', 0.20,  500,  150, 'Short inputs fit the gpt-4.1-mini envelope — 5x cheaper with comparable accuracy on classification and short-form generation.'),
  ('openai', 'gpt-4-turbo',  'openai', 'gpt-4o',       0.25, 2000,  500, 'gpt-4o delivers equivalent reasoning at ~4x lower cost than gpt-4-turbo for most workloads.'),
  ('openai', 'gpt-4',        'openai', 'gpt-4o',       0.083,4000, 1000, 'Legacy gpt-4 (8k) is ~12x more expensive than gpt-4o with no quality advantage on modern workloads.'),
  -- ── Anthropic ──────────────────────────────────────────────────────
  ('anthropic', 'claude-opus-4-7',            'anthropic', 'claude-haiku-4.5', 0.20,  500,  200, 'Low token volume per call fits Haiku 4.5 — 5x cheaper with sub-second latency for short-context tasks.'),
  ('anthropic', 'claude-3-opus-20240229',     'anthropic', 'claude-haiku-4.5', 0.067, 500,  200, 'Low token volume per call fits Haiku 4.5 — ~15x cheaper with sub-second latency for short-context tasks.'),
  ('anthropic', 'claude-sonnet-4-6',          'anthropic', 'claude-haiku-4.5', 0.333, 800,  250, 'Sonnet 4.6 is overkill for short-context classification — Haiku 4.5 is ~3x cheaper with comparable accuracy at this token range.'),
  ('anthropic', 'claude-sonnet-4-5',          'anthropic', 'claude-haiku-4.5', 0.333, 800,  250, 'Short-context workloads that fit Haiku 4.5''s envelope are ~3x cheaper without measurable quality loss.'),
  ('anthropic', 'claude-3-5-sonnet-20241022', 'anthropic', 'claude-haiku-4.5', 0.333, 800,  250, 'Sonnet 3.5 is overkill for short-context classification — Haiku 4.5 is ~3x cheaper with comparable accuracy at this token range.'),
  -- ── Gemini ─────────────────────────────────────────────────────────
  ('gemini', 'gemini-2.5-pro', 'gemini', 'gemini-2.5-flash', 0.25, 1000, 300, 'Gemini 2.5 Flash is ~4x cheaper than 2.5 Pro on short requests with comparable accuracy on structured tasks.'),
  ('gemini', 'gemini-1.5-pro', 'gemini', 'gemini-1.5-flash', 0.06, 1000, 300, 'Gemini 1.5 Flash is ~17x cheaper than Pro on short requests and typically within 5% accuracy on structured tasks.'),
  ('gemini', 'gemini-2.0-pro', 'gemini', 'gemini-2.0-flash', 0.10, 1000, 300, 'Gemini 2.0 Flash delivers similar output quality at ~10x lower cost for short-context tasks.')
ON CONFLICT (current_provider, current_model) DO UPDATE
  SET suggested_provider        = EXCLUDED.suggested_provider,
      suggested_model           = EXCLUDED.suggested_model,
      cost_ratio                = EXCLUDED.cost_ratio,
      max_avg_prompt_tokens     = EXCLUDED.max_avg_prompt_tokens,
      max_avg_completion_tokens = EXCLUDED.max_avg_completion_tokens,
      reason                    = EXCLUDED.reason,
      updated_at                = now();
