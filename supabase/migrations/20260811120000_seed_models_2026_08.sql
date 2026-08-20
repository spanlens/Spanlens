-- Model price refresh — 2026-08-11.
--
-- Verified against the official pricing pages on 2026-08-11:
--   OpenAI    developers.openai.com/api/docs/pricing
--   Anthropic platform.claude.com  (Pricing + Models overview)
--   Gemini    ai.google.dev/gemini-api/docs/pricing?hl=en
--   xAI       docs.x.ai/docs/models
--   Groq      console.groq.com/docs/models  (groq.com/pricing now redirects to the homepage)
--   Mistral   mistral.ai/pricing/api
--   DeepSeek  api-docs.deepseek.com/quick_start/pricing
--   Cohere    cohere.com/pricing + docs.cohere.com/docs/models
--
-- Why this migration exists — customer impact, worst first:
--
--   1. gpt-5.6-terra and gpt-5.6-luna were CUT by OpenAI after the 2026-07-29
--      seed. We were over-reporting cost on every request to them: terra by 25%
--      and luna by 5x (input went $1.00 -> $0.20, output $6.00 -> $1.20). Both
--      tiers moved, so the long-context rows are corrected too. gpt-5.6-sol is
--      unchanged, which is why this went unnoticed — the family did not move
--      together.
--
--   2. mistral-moderation-2603 is now free. We priced it at $0.10/1M input, so
--      every moderation call was billed for something the customer isn't paying
--      Mistral for. Zero is the honest number here, not NULL: NULL renders as
--      missing data in the dashboard, and the real cost really is $0.
--
--   3. Five models were serving traffic with no row at all, so their requests
--      logged cost_usd = NULL (gotcha #2): gpt-5.6-cyber (the new Daybreak
--      flagship, and by far the most expensive OpenAI model we proxy at
--      $12.50/$75), two Gemini Robotics ER 2 previews, and Groq's two Prompt
--      Guard classifiers.
--
-- Deliberately NOT seeded:
--   • gemini-omni-flash-preview — output is $9.00/1M for text but $17.50/1M for
--     video off the same row. One completion_price_per_1m cannot express that,
--     and picking either number mis-bills the other case. Same standing reason
--     as the image/TTS/live-audio models (gemini-*-image, gemini-*-tts,
--     gemini-3.5-live-translate-preview, gpt-image-2, sora-*, gpt-realtime-*).
--   • minimaxai/minimax-m2.7 on Groq — "Contact Sales", no public per-token
--     price. Same reasoning as Cohere command-a-plus-05-2026 and the
--     command-a-{reasoning,vision,translate} variants, still unseeded.
--   • groq/compound and groq/compound-mini — billed at the underlying model's
--     rates, they have no rate of their own.
--   • Mistral OCR 4 (per 1000 pages) and the Voxtral transcribe/TTS models
--     (per minute / per 1k characters) — not per-token at all.
--   • Mistral Classifier API fine-tunes — priced per fine-tune, no stable id.
--
-- Dropped off their provider's pricing page since the last refresh; rows are
-- KEPT so historical requests still price, and noted here so the next refresh
-- doesn't re-add them as "missing":
--   • mistral: pixtral-large-latest, pixtral-12b (already flagged 2026-07-29)
--   • groq:    meta-llama/llama-4-scout-17b-16e-instruct, qwen/qwen3-32b
--   • gemini:  gemini-3.1-flash-lite-preview, gemini-1.5-pro, gemini-1.5-flash
--
-- STILL PENDING — 2026-09-01: claude-sonnet-5 introductory pricing ($2/$10,
-- cache 0.20/2.50) expires on 2026-08-31. Standard is $3/$15, cache 0.30/3.75.
-- Anthropic's pricing page lists both rows today. Not applied here because it
-- would under-report every Sonnet 5 request for the next three weeks; it needs
-- its own migration dated on or after 2026-09-01.
--
-- Idempotent: ON CONFLICT DO UPDATE on the (provider, model) unique index.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── OpenAI: price cuts on two thirds of the GPT-5.6 family ───────────────
  ('openai', 'gpt-5.6-terra',                         2.00,  12.00,  0.20,   2.500),
  ('openai', 'gpt-5.6-luna',                          0.20,   1.20,  0.02,   0.250),
  -- New "Cyber models" (Daybreak) section. No long-context tier published.
  ('openai', 'gpt-5.6-cyber',                        12.50,  75.00,  1.25,  15.625),
  -- ── Gemini: Robotics ER 2 previews ───────────────────────────────────────
  -- Successors to gemini-robotics-er-1.6-preview. The streaming variant
  -- publishes no context-caching rate; the non-streaming one caches at 0.10x.
  ('gemini', 'gemini-robotics-er-2-preview',           2.00,  10.00,  0.20,   NULL),
  ('gemini', 'gemini-robotics-er-2-streaming-preview', 2.00,  10.00,  NULL,   NULL),
  -- ── Groq: Prompt Guard classifiers ───────────────────────────────────────
  -- Preview tier, but customers already route moderation traffic through them.
  ('groq', 'meta-llama/llama-prompt-guard-2-22m',      0.03,   0.03,  NULL,   NULL),
  ('groq', 'meta-llama/llama-prompt-guard-2-86m',      0.04,   0.04,  NULL,   NULL),
  -- ── Mistral: free models seeded at 0, not left NULL ──────────────────────
  -- Both are listed as "Free" on the pricing page. A 0 row prices them
  -- correctly; a missing row would render as missing data in the dashboard.
  ('mistral', 'mistral-moderation-2603',               0.00,   0.00,  NULL,   NULL),
  ('mistral', 'labs-leanstral-2603',                   0.00,   0.00,  NULL,   NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

-- ── OpenAI GPT-5.6: long-context tier follows the same cut ──────────────────
-- Threshold stays 272,000 tokens (see migration 20260522020000). Only terra and
-- luna moved; gpt-5.6-sol keeps 10.00 / 45.00 / 1.00 / 12.50 from 20260729100000.
UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  4.00,
       long_completion_price_per_1m  = 18.00,
       long_cache_read_price_per_1m  =  0.40,
       long_cache_write_price_per_1m =  5.00,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-5.6-terra';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  0.40,
       long_completion_price_per_1m  =  1.80,
       long_cache_read_price_per_1m  =  0.04,
       long_cache_write_price_per_1m =  0.50,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-5.6-luna';
