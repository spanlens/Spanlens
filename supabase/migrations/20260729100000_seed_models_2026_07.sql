-- Model price refresh — 2026-07-29.
--
-- Verified against the official pricing pages on 2026-07-29:
--   OpenAI    developers.openai.com/api/docs/pricing
--   Anthropic platform.claude.com  (Pricing + Models overview)
--   Gemini    ai.google.dev/gemini-api/docs/pricing
--   xAI       docs.x.ai/docs/models
--   Groq      groq.com/pricing
--   Mistral   mistral.ai/pricing/api
--
-- What this migration does:
--   1. Adds current flagship models that were missing entirely (their requests
--      were logging cost_usd = NULL — gotcha #2).
--   2. Fixes one wrong price (mistral-small-latest) and one wrong model id
--      (open-mixtral-8x22b).
--   3. Backfills cache_read for Gemini and xAI, which publish cached-input
--      rates that we were not modelling. Without them calculateCost() falls
--      back to the full input rate (lib/cost.ts:144) and over-charges cache
--      hits — up to 6x on Grok.
--   4. Adds the long-context (>threshold) tier for xAI. Grok bills EVERY token
--      of the request at the higher rate once the prompt reaches 200k, which is
--      exactly the semantics of long_context_threshold_tokens.
--
-- Deliberately NOT seeded here:
--   • Image / video / audio / TTS models (gpt-image-*, sora-*, gpt-realtime-*,
--     gemini-*-image, gemini-*-tts, veo-*, lyria-*). Their output token rate
--     differs by modality (e.g. gemini-3-pro-image is $12/1M text but $120/1M
--     image), and model_prices has a single completion_price_per_1m. Seeding
--     one of the two would silently mis-bill the other, which is worse than a
--     visible NULL. Needs a modality-aware column first.
--   • Cohere command-a-plus-05-2026 and the command-a-{reasoning,vision,
--     translate} variants — still sales-quoted, no public per-token price
--     (same reasoning as the 20260701120100 migration).
--
-- Idempotent: ON CONFLICT DO UPDATE on the (provider, model) unique index.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── OpenAI: GPT-5.6 flagship family ──────────────────────────────────────
  -- First OpenAI family with a published cache-WRITE rate (1.25x input, the
  -- same multiplier Anthropic uses). Long-context tier applied below.
  ('openai', 'gpt-5.6-sol',                       5.00,  30.00,  0.50,   6.250),
  ('openai', 'gpt-5.6-terra',                     2.50,  15.00,  0.25,   3.125),
  ('openai', 'gpt-5.6-luna',                      1.00,   6.00,  0.10,   1.250),
  -- ── Anthropic: Claude 5 ──────────────────────────────────────────────────
  ('anthropic', 'claude-opus-5',                  5.00,  25.00,  0.50,   6.25),
  -- NOTE: claude-sonnet-5 is at INTRODUCTORY pricing ($2/$10) through
  -- 2026-08-31. Standard pricing ($3/$15, cache 0.30/3.75) takes effect
  -- 2026-09-01 — a follow-up migration must flip these four numbers on that
  -- date or we under-report Sonnet 5 cost by 33%.
  ('anthropic', 'claude-sonnet-5',                2.00,  10.00,  0.20,   2.50),
  -- Invitation-only (Project Glasswing); same specs/pricing as claude-fable-5.
  ('anthropic', 'claude-mythos-preview',         10.00,  50.00,  1.00,  12.50),
  -- ── Gemini: current text models ──────────────────────────────────────────
  ('gemini', 'gemini-3.6-flash',                  1.50,   7.50,  0.15,   NULL),
  ('gemini', 'gemini-3.5-flash-lite',             0.30,   2.50,  0.03,   NULL),
  ('gemini', 'gemini-robotics-er-1.6-preview',    1.00,   5.00,  NULL,   NULL),
  -- Embeddings are input-only (completion stays 0). gemini-embedding-2 is
  -- multimodal and the seeded rate is the TEXT input rate; image ($0.45),
  -- audio ($6.50) and video ($12.00) input are billed higher and are not
  -- modelled (single prompt_price_per_1m column).
  ('gemini', 'gemini-embedding-2',                0.20,   0.00,  NULL,   NULL),
  ('gemini', 'gemini-embedding-001',              0.15,   0.00,  NULL,   NULL),
  -- ── xAI: Grok 4.5 ────────────────────────────────────────────────────────
  ('xai', 'grok-4.5',                             2.00,   6.00,  0.30,   NULL),
  -- ── Groq: current catalogue additions ────────────────────────────────────
  ('groq', 'qwen/qwen3.6-27b',                    0.60,   3.00,  NULL,   NULL),
  ('groq', 'openai/gpt-oss-safeguard-20b',        0.075,  0.30,  NULL,   NULL),
  -- ── Mistral: correct open-mixtral ids ────────────────────────────────────
  -- The existing 'mixtral-8x22b' row never matched real traffic: the API id is
  -- 'open-mixtral-8x22b'. Left in place as a harmless legacy alias.
  ('mistral', 'open-mixtral-8x22b',               2.00,   6.00,  NULL,   NULL),
  ('mistral', 'open-mixtral-8x7b',                0.70,   0.70,  NULL,   NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

-- ── Price correction ────────────────────────────────────────────────────────
-- mistral-small-latest now resolves to Mistral Small 4 at $0.15/$0.60. We were
-- seeded at the Small 3.x rate ($0.10/$0.30) and under-reporting by 40%.
UPDATE model_prices
   SET prompt_price_per_1m     = 0.15,
       completion_price_per_1m = 0.60,
       updated_at              = now()
 WHERE provider = 'mistral' AND model = 'mistral-small-latest';

-- ── Gemini: cached-input rates ──────────────────────────────────────────────
-- Google publishes a context-caching rate for every current Gemini model; we
-- had them all NULL. Values are the text/image/video rate (audio caching is
-- billed higher and is not modelled). The $1.00 / 1M-tokens-per-hour storage
-- fee is a separate line item Google bills directly and is out of scope.
UPDATE model_prices SET cache_read_price_per_1m = 0.15,  updated_at = now()
 WHERE provider = 'gemini' AND model = 'gemini-3.5-flash';
UPDATE model_prices SET cache_read_price_per_1m = 0.025, updated_at = now()
 WHERE provider = 'gemini' AND model IN ('gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview');
UPDATE model_prices SET cache_read_price_per_1m = 0.05,  updated_at = now()
 WHERE provider = 'gemini' AND model = 'gemini-3-flash-preview';
UPDATE model_prices SET cache_read_price_per_1m = 0.03,  updated_at = now()
 WHERE provider = 'gemini' AND model = 'gemini-2.5-flash';
UPDATE model_prices SET cache_read_price_per_1m = 0.01,  updated_at = now()
 WHERE provider = 'gemini' AND model IN ('gemini-2.5-flash-lite', 'gemini-2.5-flash-lite-preview-09-2025');
UPDATE model_prices SET cache_read_price_per_1m = 0.025, updated_at = now()
 WHERE provider = 'gemini' AND model = 'gemini-2.0-flash';

-- Pro family caches at 0.10x input on both context tiers.
UPDATE model_prices
   SET cache_read_price_per_1m      = 0.20,
       long_cache_read_price_per_1m = 0.40,
       updated_at                   = now()
 WHERE provider = 'gemini' AND model IN ('gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools');

UPDATE model_prices
   SET cache_read_price_per_1m      = 0.125,
       long_cache_read_price_per_1m = 0.25,
       updated_at                   = now()
 WHERE provider = 'gemini' AND model = 'gemini-2.5-pro';

-- ── OpenAI GPT-5.6: long-context tier ───────────────────────────────────────
-- Threshold is 272,000 tokens, same as the rest of the GPT-5.x family
-- (see the 20260522020000 migration).
UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      = 10.00,
       long_completion_price_per_1m  = 45.00,
       long_cache_read_price_per_1m  =  1.00,
       long_cache_write_price_per_1m = 12.50,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-5.6-sol';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  5.00,
       long_completion_price_per_1m  = 22.50,
       long_cache_read_price_per_1m  =  0.50,
       long_cache_write_price_per_1m =  6.25,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-5.6-terra';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  2.00,
       long_completion_price_per_1m  =  9.00,
       long_cache_read_price_per_1m  =  0.20,
       long_cache_write_price_per_1m =  2.50,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-5.6-luna';

-- ── xAI: cached input + long-context tier ───────────────────────────────────
-- docs.x.ai publishes a cached-input rate and a >=200k tier for every Grok
-- model: "requests whose prompt reaches the listed token threshold are billed
-- at the higher rate for all tokens in the request" — i.e. the whole request
-- flips to 2x, which is what long_* models.
UPDATE model_prices
   SET cache_read_price_per_1m       = 0.20,
       long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      = 2.50,
       long_completion_price_per_1m  = 5.00,
       long_cache_read_price_per_1m  = 0.40,
       updated_at                    = now()
 WHERE provider = 'xai'
   AND model IN (
     'grok-4.3',
     'grok-4.20-0309-reasoning',
     'grok-4.20-0309-non-reasoning',
     'grok-4.20-multi-agent-0309'
   );

UPDATE model_prices
   SET cache_read_price_per_1m       = 0.30,
       long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      = 4.00,
       long_completion_price_per_1m  = 12.00,
       long_cache_read_price_per_1m  = 0.60,
       updated_at                    = now()
 WHERE provider = 'xai' AND model = 'grok-4.5';

UPDATE model_prices
   SET cache_read_price_per_1m       = 0.20,
       long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      = 2.00,
       long_completion_price_per_1m  = 4.00,
       long_cache_read_price_per_1m  = 0.40,
       updated_at                    = now()
 WHERE provider = 'xai' AND model = 'grok-build-0.1';
