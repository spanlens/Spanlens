-- Model price refresh — 2026-08-21.
--
-- Verified against the official pricing pages on 2026-08-21:
--   OpenAI    developers.openai.com/api/docs/pricing
--   Anthropic platform.claude.com  (Pricing + Models overview)
--   Gemini    ai.google.dev/gemini-api/docs/pricing?hl=en
--   xAI       docs.x.ai/docs/models
--   Groq      console.groq.com/docs/models
--   Mistral   mistral.ai/pricing/api
--   DeepSeek  api-docs.deepseek.com/quick_start/pricing
--   Cohere    cohere.com/pricing + docs.cohere.com/docs/models
--
-- Why this migration exists — customer impact, worst first:
--
--   1. gemini-3.6-flash was over-reporting by exactly 2x on all three axes.
--      Google's flash pricing is $0.75 / $3.75 / cache $0.075 THROUGH
--      2026-12-31; the $1.50 / $7.50 / $0.15 numbers the 2026-08-11 seed used
--      are the rates that start 2027-01-01. Flash is a high-volume family, so
--      this is the largest dollar error in the audit.
--
--   2. DeepSeek replaced flat pricing with a time-of-day schedule, and both
--      tiers are more expensive than what we had. That means we were UNDER-
--      reporting: the customer's DeepSeek invoice was larger than the number
--      our dashboard showed them, which is the worse direction to be wrong in.
--
--        model              off-peak (17h)          peak (7h)
--        deepseek-v4-flash  0.22 / 0.66 / 0.007     0.44 / 1.32 / 0.014
--        deepseek-v4-pro    0.66 / 1.98 / 0.022     1.32 / 3.96 / 0.044
--
--      Peak is 01:00-04:00 and 06:00-10:00 UTC and is exactly 2x off-peak.
--      model_prices has one price per axis and no time dimension, so one of
--      the two has to be wrong for part of the day. Seeding OFF-PEAK is
--      correct for 17 of 24 hours (~15% mean absolute error against uniform
--      traffic); seeding peak would be correct for 7 (~71%). The residual is a
--      50% under-report during peak hours. The real fix is a time-of-day
--      dimension on this table; revisit if DeepSeek volume grows.
--
--   3. Five models had no row at all, so their requests logged cost_usd = NULL
--      and rendered as a gap in the dashboard (gotcha #2):
--        - gemini-3.7-flash   Google's new flash flagship, same introductory
--                             pricing window as 3.6-flash.
--        - grok-4.6           xAI's new flagship. Note the cache rate is
--                             $0.50, NOT grok-4.5's $0.30; copying the 4.5
--                             row would have mispriced every cache hit.
--        - gpt-5.5-cyber      Cyber table. Input/cached/output are published;
--                             cache WRITE is blank on the page, so NULL.
--        - gpt-5-search-api   Specialized models table.
--        - zai-glm-5-2        new in Mistral's Specialized section.
--
-- NOT a price change, but the reason this migration is urgent:
--   Anthropic CANCELLED the 2026-09-01 Sonnet 5 increase. The pricing page now
--   reads: "The $2/$10 ... announced at launch as introductory pricing through
--   August 31, 2026, is now the standard price. The previously scheduled
--   increase to $3/$15 ... on September 1, 2026 will not occur."
--   (note id: claude-sonnet-5-introductory-pricing)
--   The DB rows were already correct at 2.00/10.00/0.20/2.50 and are untouched
--   here. What was wrong was every *instruction to change them*: the seed
--   mirror, FALLBACK_PRICES and the refresh skill's pending-obligations list
--   all told the next reader to raise Sonnet 5 on 2026-09-01. This refresh
--   routine runs on the 1st and 15th, so it would have fired on exactly that
--   date and over-reported every Sonnet 5 request by 50%. All three are
--   corrected in the same PR.
--
-- Deliberately NOT seeded:
--   - gpt-5.4-cyber: every price cell in the Cyber table is blank for this
--     row. There is no honest number to put in, and a NULL cost is a visible
--     gap rather than a silent wrong answer.
--   - Gemini modality-split models: output billed per image, per second or per
--     character cannot be expressed by a single completion_price_per_1m.
--     gemini-*-image, gemini-*-tts, gemini-3.1-flash-live-preview,
--     gemini-3.5-live-translate-preview, and gemini-omni-flash-preview
--     ($9.00/1M text vs $17.50/1M video output). Standing reason, unchanged
--     from 20260811120000.
--   - gemini-embedding-2's non-text input rates (image $0.45, audio $6.50,
--     video $12.00). The row carries the text rate ($0.20) only.
--   - xAI Imagine (per image / per second) and Voice (per minute / per char).
--   - groq/compound and groq/compound-mini: billed at the underlying model's
--     rates, no rate of their own. minimaxai/minimax-m2.7: "Contact Sales".
--     Groq's Whisper (per hour) and Orpheus (per 1M characters) are not
--     per-token.
--   - Cohere command-a-plus-05-2026 and command-a-{reasoning,vision,translate}:
--     still no public per-token price.
--
-- Dropped off their provider's pricing page since 2026-08-11; rows are KEPT so
-- historical requests still price, and listed here so the next refresh does not
-- re-add them as "missing":
--   - groq:     llama-3.3-70b-versatile, llama-3.1-8b-instant,
--               moonshotai/kimi-k2-instruct-0905 (catalogue shrank to 11)
--   - deepseek: deepseek-chat, deepseek-reasoner. Gone from the docs entirely.
--               These were compatibility aliases onto the current v4 model. If
--               they still resolve, they are now under-reported, but the page
--               no longer says WHICH v4 they point at and flash vs pro is a 3x
--               spread, so guessing risks making it worse. Rows left at their
--               old values; verify with a live API key.
--   - cohere:   command-a-03-2025 and command-r7b-12-2024 no longer show a
--               per-token price. Rows kept at their last published rates.
--
-- NEW dated obligation, 2027-01-01: gemini-3.6-flash and gemini-3.7-flash both
-- step up to 1.50 / 7.50 / 0.15. Missing it under-reports both by 50%. Pinned
-- by a test in model-prices-cache.test.ts so CI catches drift in either
-- direction.
--
-- Idempotent: ON CONFLICT DO UPDATE on the (provider, model) unique index.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- Gemini: introductory flash pricing through 2026-12-31.
  -- 3.6-flash was seeded with the 2027 rates by mistake; 3.7-flash is new.
  -- Neither publishes a long-context tier (that split is Pro-only).
  ('gemini', 'gemini-3.6-flash',        0.75,   3.75,   0.075,  NULL),
  ('gemini', 'gemini-3.7-flash',        0.75,   3.75,   0.075,  NULL),
  -- DeepSeek: off-peak rates (see header for the peak/off-peak choice).
  ('deepseek', 'deepseek-v4-flash',     0.22,   0.66,   0.007,  NULL),
  ('deepseek', 'deepseek-v4-pro',       0.66,   1.98,   0.022,  NULL),
  -- xAI: new flagship. Cache is 0.50, not grok-4.5's 0.30.
  ('xai', 'grok-4.6',                   2.00,   6.00,   0.50,   NULL),
  -- OpenAI: Cyber + Specialized rows that were logging NULL.
  -- gpt-5.5-cyber publishes no cache-write rate (blank cell on the page).
  ('openai', 'gpt-5.5-cyber',          12.50,  75.00,   1.25,   NULL),
  ('openai', 'gpt-5-search-api',        1.25,  10.00,   0.125,  NULL),
  -- Mistral: GLM 5.2, new in the Specialized section.
  ('mistral', 'zai-glm-5-2',            1.40,   4.40,   NULL,   NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

-- xAI grok-4.6: crossing 200k re-rates the ENTIRE request at 2x, not just the
-- overage, which is exactly how long_context_threshold_tokens is applied, so it
-- maps cleanly. All three axes double: 2.00 -> 4.00, 6.00 -> 12.00,
-- 0.50 -> 1.00.
UPDATE model_prices
   SET long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      =  4.00,
       long_completion_price_per_1m  = 12.00,
       long_cache_read_price_per_1m  =  1.00,
       updated_at                    = now()
 WHERE provider = 'xai' AND model = 'grok-4.6';
