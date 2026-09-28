-- Model price refresh — 2026-09-28.
--
-- Verified against the official pricing pages on 2026-09-28:
--   OpenAI    developers.openai.com/api/docs/pricing
--   Anthropic platform.claude.com  (Pricing + Models overview)
--   Gemini    ai.google.dev/gemini-api/docs/pricing?hl=en
--   xAI       docs.x.ai/docs/models
--   Groq      console.groq.com/docs/models
--   Mistral   mistral.ai/pricing/api
--   DeepSeek  api-docs.deepseek.com/quick_start/pricing
--   Cohere    cohere.com/pricing + docs.cohere.com/docs/models
--
-- Busiest refresh since this routine started: a new OpenAI generation (GPT-6),
-- three new Anthropic models, and two silent 2x over-reports.
--
-- Why this migration exists — customer impact, worst first:
--
--   1. gemini-robotics-er-2-preview and -streaming-preview are both on
--      INTRODUCTORY pricing through 2026-12-31 (1.00 / 5.00 / cache 0.10) and
--      we were charging the post-2027 rates (2.00 / 10.00 / 0.20). Exactly the
--      gemini-3.6-flash mistake of 2026-08, on two more rows: the seed took the
--      "starting January 1, 2027" column. Every Robotics ER 2 request since
--      2026-08-11 was over-reported by 2x on every axis.
--
--   2. gpt-5.6-sol was CUT and we did not follow it down. Input 5.00 -> 4.00,
--      output 30.00 -> 20.00, cache read 0.50 -> 0.40, cache write 6.25 -> 5.00,
--      and the long tier with it (10/45/1.00/12.50 -> 8/30/0.80/10.00). That is
--      a 20% input and 33% output over-report on OpenAI's most-used flagship.
--      Its siblings did NOT move — terra and luna are unchanged — which is the
--      same "a family does not move together" trap that hid the 2026-08 terra
--      and luna cuts. Diff every member, every run.
--
--   3. Eleven models had no row at all, so their requests logged
--      cost_usd = NULL and rendered as a gap in the dashboard:
--
--        gpt-6-astra / gpt-6-sol / gpt-6-luna   OpenAI's new flagship family,
--                                               all three with a 272k tier.
--        gpt-rosalind-research                  new Life Sciences specialized row.
--        omni-moderation-latest                 listed Free; seeded at 0, not
--                                               left out, so it renders $0.00
--                                               instead of "no data".
--        claude-opus-5-5                        4 / 20, cache read 0.20.
--        claude-fable-5-1 (+ claude-mythos-5-1) 10 / 50, cache read 0.25.
--        gemini-3.8-flash                       same introductory window as 3.6
--                                               and 3.7.
--        grok-4.7                               identical rates to grok-4.6.
--        qwen/qwen3.8-27b                       replaces qwen3.6-27b on Groq.
--        deepseek-flash                         replaces deepseek-v4-flash.
--        zai-glm-5-3                            new on Mistral.
--
--   4. Anthropic broke the 0.1x cache rule. Cache reads have been derivable as
--      0.1x base input for every Claude model until now. They are not any more:
--      Fable 5.1 and Mythos 5.1 read at 0.025x (0.25 on a 10.00 base) and
--      Opus 5.5 at 0.05x (0.20 on a 4.00 base). Deriving instead of reading the
--      column would over-charge cache hits by 4x and 2x respectively. A test
--      pins all three.
--
-- OpenAI Daybreak aliases, now seeded:
--   The pricing page states plainly that gpt-daybreak-blue-latest and
--   gpt-daybreak-red-latest currently point at gpt-5.6-sol and gpt-5.6-cyber.
--   They were previously left out because a moving pointer goes stale silently,
--   and a stale price is worse than a gap. Seeding them wins anyway: the gap is
--   certain and affects every request today, while the staleness is bounded by
--   this routine running on the 1st and 15th. The obligation to re-verify both
--   targets each run is recorded in the skill, and a test pins each alias to
--   the row it mirrors so an internal edit cannot desync them. If OpenAI
--   repoints either alias, that is caught by the audit, not by CI.
--
-- DeepSeek, two changes:
--   deepseek-v4-flash is gone, replaced by deepseek-flash at a LOWER rate
--   (0.15 / 0.60 / 0.003 off-peak vs 0.22 / 0.66 / 0.007). Separate id, so the
--   old row stays and prices history; the new row is added.
--   The peak window also narrowed: still 01:00-04:00 and 06:00-10:00 UTC, but
--   now "Monday through Friday, excluding Chinese public holidays" rather than
--   every day. Off-peak therefore covers ~79% of the year instead of ~71%,
--   which makes the standing off-peak choice (see 20260821120000) more correct,
--   not less. Peak-hour requests remain 50% under-reported until this table
--   grows a time-of-day dimension.
--
-- Deliberately NOT seeded:
--   - gpt-5.4-cyber: every price cell in its row is still blank.
--   - Gemini modality-split models, output billed per image / second /
--     character and not expressible as one completion_price_per_1m. New this
--     month: gemini-3.8-live, gemini-3.8-live-extended-thinking,
--     gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts, gemini-omni-1.1-flash
--     ($9.00/1M text vs $17.50/1M video output), gemini-3.5-transcribe and
--     gemini-3.5-transcribe-live (per-minute audio alternative), lyria-3.5.
--     Standing reason, unchanged from 20260811120000.
--   - gemini-embedding-2's non-text input rates; the row carries text only.
--   - Groq: whisper (per audio hour), Orpheus (per 1M characters),
--     minimaxai/minimax-m2.7 (Contact Sales).
--   - Mistral: OCR 4.1 (per 1000 pages), Voxtral TTS (per 1k characters),
--     Voxtral Mini Transcribe Realtime (per minute), the Classifier API
--     fine-tunes (priced per fine-tune, no stable id).
--   - Cohere command-a-plus and the command-a-{reasoning,vision,translate}
--     variants: still no public per-token price.
--
-- Two ids could not be read off a page and follow the vendor's own convention.
-- Both are additive, so the worst case is a row that never matches rather than
-- a wrong price, but the next refresh should confirm them:
--   - claude-mythos-5-1: the pricing page lists "Claude Mythos 5.1" but the
--     models overview omits invitation-only ids. Follows claude-mythos-5 and
--     the documented claude-fable-5-1.
--   - zai-glm-5-3: Mistral's pricing page stopped rendering API ids this month
--     (it showed them in 2026-08, which is where zai-glm-5-2 came from).
--     Prices are identical to GLM 5.2.
--
-- Dropped off their provider's pricing page since 2026-08-21; rows are KEPT so
-- historical requests still price, and listed here so the next refresh does not
-- re-add them as "missing":
--   - gemini:   gemini-robotics-er-1.6-preview,
--               gemini-2.5-flash-lite-preview-09-2025
--   - groq:     qwen/qwen3.6-27b (superseded by qwen3.8-27b)
--   - deepseek: deepseek-v4-flash (superseded by deepseek-flash)
--   - mistral:  magistral-*, devstral-*, pixtral-* (unchanged since 2026-08)
--
-- Back on a pricing page but now UNPRICED, so the rows stay at their last
-- published rates and cannot be improved:
--   - groq:   llama-3.3-70b-versatile, llama-3.1-8b-instant. Delisted entirely
--             in 2026-08, listed again now as "Contact Sales".
--   - cohere: command-a-03-2025, command-r7b-12-2024.
--
-- DATED OBLIGATION — 2027-01-01, now five rows rather than two:
--   gemini-3.6-flash, gemini-3.7-flash, gemini-3.8-flash  -> 1.50 / 7.50 / 0.15
--   gemini-robotics-er-2-preview                          -> 2.00 / 10.00 / 0.20
--   gemini-robotics-er-2-streaming-preview                -> 2.00 / 10.00
--   Missing it under-reports all five by 50%; applying it early over-reports by
--   2x. Pinned on both sides by tests in model-prices-cache.test.ts.
--
-- Idempotent: ON CONFLICT DO UPDATE on the (provider, model) unique index.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- OpenAI: the GPT-6 generation. All three publish a 272k tier (set below).
  ('openai', 'gpt-6-astra',                 10.00,  50.00,   1.00,  12.500),
  ('openai', 'gpt-6-sol',                    2.00,  10.00,   0.20,   2.500),
  ('openai', 'gpt-6-luna',                   0.10,   0.50,   0.01,   0.125),
  -- OpenAI: gpt-5.6-sol was cut. terra and luna did not move.
  ('openai', 'gpt-5.6-sol',                  4.00,  20.00,   0.40,   5.000),
  -- OpenAI: new Specialized rows. omni-moderation-latest is listed Free, and 0
  -- is the honest number — a missing row would render as "no data", not $0.00.
  ('openai', 'gpt-rosalind-research',        5.00,  25.00,   0.50,   NULL),
  ('openai', 'omni-moderation-latest',       0.00,   0.000,  NULL,   NULL),
  -- OpenAI Daybreak aliases; mirror gpt-5.6-sol and gpt-5.6-cyber exactly.
  -- Re-verify both targets every refresh: these repoint without notice.
  ('openai', 'gpt-daybreak-blue-latest',     4.00,  20.00,   0.40,   5.000),
  ('openai', 'gpt-daybreak-red-latest',     12.50,  75.00,   1.25,  15.625),
  -- Anthropic: cache reads are NOT 0.1x on these three.
  -- Fable/Mythos 5.1 read at 0.025x base; Opus 5.5 at 0.05x.
  ('anthropic', 'claude-fable-5-1',         10.00,  50.00,   0.25,  12.50),
  ('anthropic', 'claude-mythos-5-1',        10.00,  50.00,   0.25,  12.50),
  ('anthropic', 'claude-opus-5-5',           4.00,  20.00,   0.20,   5.00),
  -- Gemini: 3.8-flash joins 3.6 and 3.7 on introductory pricing through
  -- 2026-12-31. Flash has no long-context tier; that split is Pro-only.
  ('gemini', 'gemini-3.8-flash',             0.75,   3.75,   0.075, NULL),
  -- Gemini: Robotics ER 2 was seeded with the 2027 rates by mistake.
  ('gemini', 'gemini-robotics-er-2-preview',           1.00,  5.00,  0.10,  NULL),
  ('gemini', 'gemini-robotics-er-2-streaming-preview', 1.00,  5.00,  NULL,  NULL),
  -- xAI: grok-4.7 ships at grok-4.6's rates, including the 0.50 cache read.
  ('xai', 'grok-4.7',                        2.00,   6.00,   0.50,   NULL),
  -- Groq: qwen3.8-27b replaces qwen3.6-27b, at a higher rate.
  ('groq', 'qwen/qwen3.8-27b',               0.80,   4.00,   NULL,   NULL),
  -- DeepSeek: off-peak rates (see header, and 20260821120000 for the choice).
  ('deepseek', 'deepseek-flash',             0.15,   0.60,   0.003,  NULL),
  -- Mistral: GLM 5.3, same rates as GLM 5.2. Id follows the 5.2 convention.
  ('mistral', 'zai-glm-5-3',                 1.40,   4.40,   NULL,   NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

-- ── OpenAI GPT-6: 272k long-context tier, every axis exactly 2x ─────────────
UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      = 20.00,
       long_completion_price_per_1m  = 75.00,
       long_cache_read_price_per_1m  =  2.00,
       long_cache_write_price_per_1m = 25.00,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-6-astra';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  4.00,
       long_completion_price_per_1m  = 15.00,
       long_cache_read_price_per_1m  =  0.40,
       long_cache_write_price_per_1m =  5.00,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-6-sol';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  0.20,
       long_completion_price_per_1m  =  0.75,
       long_cache_read_price_per_1m  =  0.02,
       long_cache_write_price_per_1m =  0.25,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-6-luna';

-- ── OpenAI gpt-5.6-sol: the long tier followed the cut down ─────────────────
-- Was 10.00 / 45.00 / 1.00 / 12.50 (migration 20260729100000).
UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  8.00,
       long_completion_price_per_1m  = 30.00,
       long_cache_read_price_per_1m  =  0.80,
       long_cache_write_price_per_1m = 10.00,
       updated_at                    = now()
 WHERE provider = 'openai' AND model IN ('gpt-5.6-sol', 'gpt-daybreak-blue-latest');

-- ── xAI grok-4.7: reaching 200k re-rates the WHOLE request at 2x ────────────
UPDATE model_prices
   SET long_context_threshold_tokens = 200000,
       long_prompt_price_per_1m      =  4.00,
       long_completion_price_per_1m  = 12.00,
       long_cache_read_price_per_1m  =  1.00,
       updated_at                    = now()
 WHERE provider = 'xai' AND model = 'grok-4.7';

-- omni-moderation-latest is served by /v1/moderations, not chat completions.
UPDATE model_prices
   SET chat_capable = FALSE,
       updated_at   = now()
 WHERE provider = 'openai' AND model = 'omni-moderation-latest';
