-- Model price refresh — 2026-11-06.
--
-- Verified against the official pricing pages on 2026-11-06:
--   OpenAI    developers.openai.com/api/docs/pricing.md
--   Anthropic platform.claude.com (Pricing + Models overview)
--   Gemini    aistudio.google.com/docs/pricing?hl=en   <-- MOVED, see below
--   xAI       docs.x.ai/docs/models
--   Groq      console.groq.com/docs/models
--   Mistral   mistral.ai/pricing/api -> 301 -> docs.mistral.ai/inference/pricing
--   DeepSeek  api-docs.deepseek.com/quick_start/pricing
--   Cohere    cohere.com/pricing
--
-- First refresh to land since 2026-09-28. The twice-monthly routine DID run on
-- 10-01, 10-15 and 11-01 and audited correctly each time, but it could not open
-- a PR: git push to this repo is refused at its gateway (403, the Claude GitHub
-- App is not installed for the org). Five weeks of drift therefore accumulated
-- behind a routine that was working. That is a delivery failure, not an audit
-- failure, and it is tracked separately from this migration.
--
-- Why this migration exists — customer impact, worst first:
--
--   1. mistral-large-latest has been UNDER-reporting by 29% on both axes.
--      `mistral-large-latest` is a moving pointer and it moved: Mistral Large 3
--      became Large 4, taking the price from 0.50 / 1.50 to 0.70 / 2.10. We
--      kept the Large 3 numbers, so every Large request showed the customer
--      less than they were billed. This is exactly the `*-latest` trap the
--      skill tells us to re-check every run, and it is the only wrong rate in
--      the whole table this time.
--
--   2. Every Mistral cache hit has been billed at the full input rate.
--      calculateCost() falls back to `prompt` when cache_read is NULL, and all
--      of our Mistral rows were NULL because Mistral did not publish cached
--      rates. It does now, for the whole catalogue. Nine rows get their real
--      cached rate here; before this, a cached Large request over-charged the
--      cache portion by 10x (0.70 instead of 0.07).
--
--   3. Ten models had no row at all, so their requests logged cost_usd = NULL
--      and rendered as a gap. Three of them are current flagships:
--
--        claude-sonnet-5-5   2.00 / 10.00 / cache 0.10  <- current Sonnet
--        gemini-4-argon      2.00 / 10.00 / cache 0.10  <- current Gemini
--        claude-haiku-5-5    tiered, see below          <- current Haiku
--        gpt-6.1-sol, gpt-6.1-terra, gpt-6-cyber,
--        gpt-6-rosalind, gpt-rosalind-discovery,
--        gpt-6-astra-law, zai-glm-5-3-flash
--
-- claude-haiku-5-5 is Anthropic's first PROMPT-LENGTH tier, and it maps onto
-- the existing long_* columns only because the semantics happen to match. Both
-- were checked against the page rather than assumed:
--   • The page says "over 100,000 tokens", and cost.ts branches on
--     `usage.promptTokens > prices.longThreshold` — strictly greater, so a
--     prompt of exactly 100,000 stays on the lower tier. Same boundary.
--   • The page says "A request's prompt length counts all of its input tokens,
--     including cache reads and cache writes", and cost.ts deliberately
--     branches on `usage.promptTokens` (total input, cache included) rather
--     than the non-cached subset. Same base.
-- It is a flat 5x step on every axis, not the 2x/1.5x shape OpenAI uses. Both
-- sides of the boundary are pinned by a test.
--
-- THE TRAP THIS TIME — gpt-6.1-sol vs gpt-6-sol:
--   input 2.00, output 10.00 and cache write 2.50 are IDENTICAL on both. They
--   differ on exactly one axis: cache read is 0.10 on 6.1 and 0.20 on 6. Copy
--   the gpt-6-sol row for the new model and every cache hit is charged double,
--   with nothing else looking wrong. Pinned by a test.
--
-- Gemini's pricing page MOVED from ai.google.dev/gemini-api/docs/pricing to
-- aistudio.google.com/docs/pricing, and its structure changed: prices now live
-- in tab panels that are not rendered into `innerText`. The extraction snippet
-- in references/providers.md has been updated to read `textContent` instead,
-- which reaches the inactive panels. A run that uses the old snippet gets empty
-- tables and may conclude, wrongly, that nothing changed.
--
-- OpenAI now publishes TWO cache-write durations, "30m write" and "12h write".
-- model_prices has one cache_write_price_per_1m. We carry the 30m figure,
-- which is what every existing row already held (gpt-6-astra 12.50 = the 30m
-- column), so this is a documentation of the existing choice, not a change.
--
-- Deliberately NOT seeded:
--   - gpt-daybreak-blue-latest / gpt-daybreak-red-latest: see the standing
--     risk note below. Their rows are left untouched, not updated.
--   - Gemini modality-split models: gemini-omni-1.2-flash,
--     gemini-nano-banana-2.1, the 3.8-live family, 3.5-transcribe and
--     3.5-transcribe-live, the TTS models, the image models, lyria. Output
--     billed per image / second / character cannot be one
--     completion_price_per_1m. Standing reason since 20260811120000.
--   - Groq meta-models/muse-spark-open and minimaxai/minimax-m2.7
--     ("ContactSales"), Whisper (per audio hour), Orpheus (per character).
--   - Mistral OCR 4.1 / OCR 3 (per 1000 pages), the Voxtral audio family (per
--     minute / per 1k characters), Timestral and Shieldstral (self-hosted,
--     open weights), and the voice-agent per-minute rates.
--   - Mistral now resells "DeepSeek V4.1 Flash 1017" at its own rate
--     (0.30 / 0.007 / 1.20, different from DeepSeek's own 0.15 / 0.003 / 0.60).
--     No Mistral-side API id is visible for it, and guessing one risks
--     colliding with the deepseek provider rows. Left out until an id appears.
--   - Cohere: cohere.com/pricing no longer publishes a per-token rate for any
--     current model. The FAQ's legacy rates still match our kept rows.
--
-- Confirmed since last time: zai-glm-5-3 was seeded on 2026-09-28 with an id
-- inferred from zai-glm-5-2, flagged as unverified. The id is now visible in
-- the page's own link targets (/models/zai-glm-5-3). The guess was right.
--
-- Unchanged and re-verified rate-for-rate: all of xAI (grok-4.7 is still the
-- newest), all of Groq, all of DeepSeek (deepseek-flash 0.15 / 0.60 / 0.003
-- and deepseek-v4-pro 0.66 / 1.98 / 0.022 off-peak, peak window still
-- Mon-Fri 01:00-04:00 and 06:00-10:00 UTC excluding Chinese public holidays),
-- every OpenAI row we already carry, and every Anthropic row we already carry.
--
-- Dropped off their provider's page since 2026-09-28; rows KEPT so historical
-- requests still price, and listed so the next refresh does not re-add them:
--   - gemini:  gemini-3.7-flash, gemini-3.5-flash, gemini-2.0-flash,
--              gemini-2.0-flash-lite, gemini-2.5-computer-use-preview-10-2025
--   - mistral: mistral-medium-latest (Medium 3.5 is gone from the catalogue;
--              the generalist list is now Large 4 / Small 4 / Ministral 3)
--
-- DATED OBLIGATIONS, all re-verified on the page today:
--   2026-11-30  gpt-5.6-sol leaves promotional pricing. The page says only
--               "available until November 30, 2026" and does NOT say what it
--               reverts to. Re-read the page on or after 12-01; do not guess.
--   2026-12-01  gemini-4-argon doubles on every axis: 2.00 / 10.00 / 0.10 ->
--               4.00 / 20.00 / 0.20. Seeded here with the CURRENT column.
--   2026-12-31  gpt-6-astra-law leaves promotional pricing.
--   2027-01-01  gemini-3.6-flash and gemini-3.8-flash -> 1.50 / 7.50 / 0.15;
--               both Robotics ER 2 rows -> 2.00 / 10.00 / 0.20. gemini-3.7-flash
--               was also on that list but has left the page, so its 2027
--               behaviour is now unknown; its row is unchanged.
--
-- STANDING RISK — the Daybreak aliases are no longer documented:
--   gpt-daybreak-blue-latest and gpt-daybreak-red-latest were seeded on
--   2026-09-28 because the pricing page stated plainly which models they point
--   at. That statement is GONE: the page no longer mentions either id. They are
--   moving pointers whose target we can no longer read, holding gpt-5.6-sol and
--   gpt-5.6-cyber rates from September. If OpenAI has repointed blue at the
--   current flagship, we now over-report its input by 2x and its cache reads by
--   4x (gpt-6.1-sol is 2.00 / 0.10 against the 4.00 / 0.40 we hold).
--   They are NOT deleted here. The rule for deleting a row needs two things:
--   the provider's own alias list omitting the id, and `requests` holding no
--   history for it. The first is arguably met; the second could not be checked
--   because the Supabase MCP returned "You do not have permission" for every
--   query in this session, so production could not be read at all. Deleting a
--   row that history depends on, on an unverified assumption, is worse than
--   leaving a stale one that is flagged. This is the top review question.
--
-- Idempotent: ON CONFLICT DO UPDATE on the (provider, model) unique index.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- ── Anthropic: current flagships, both previously unpriced ───────────────
  -- Sonnet 5.5 reads cache at 0.05x base, not the usual 0.1x (page footnote 2,
  -- which now covers Opus 5.5 and Sonnet 5.5).
  ('anthropic', 'claude-sonnet-5-5',        2.00,  10.00,   0.10,   2.500),
  -- Haiku 5.5 carries the <=100k figures here; the >100k tier is set below.
  ('anthropic', 'claude-haiku-5-5',         0.10,   0.50,   0.01,   0.125),
  -- ── OpenAI: the GPT-6.1 family and the specialist tables ────────────────
  -- gpt-6.1-sol matches gpt-6-sol on input, output AND cache write. The only
  -- difference is cache read: 0.10 here, 0.20 there. Do not copy the 6 row.
  ('openai', 'gpt-6.1-sol',                 2.00,  10.00,   0.10,   2.500),
  ('openai', 'gpt-6.1-terra',               1.00,   5.00,   0.05,   1.250),
  -- Cyber table publishes no long-context tier, same as the other Cyber rows.
  ('openai', 'gpt-6-cyber',                20.00, 100.00,   2.00,  25.000),
  -- Life Sciences table. gpt-rosalind-research is already seeded and unchanged.
  ('openai', 'gpt-6-rosalind',             15.00,  75.00,   1.50,  18.750),
  ('openai', 'gpt-rosalind-discovery',      5.00,  25.00,   0.50,   NULL),
  -- Legal table. Promotional "at least through December 31, 2026".
  ('openai', 'gpt-6-astra-law',            10.00,  50.00,   1.00,   NULL),
  -- ── Gemini: the new flagship, on promotional pricing until 2026-11-30 ───
  -- Implicit caching only; no explicit cache, and no >200k tier for this model.
  -- Not offered on the free tier, so every request to it is billable.
  ('gemini', 'gemini-4-argon',              2.00,  10.00,   0.10,   NULL),
  -- ── Mistral: one real correction, plus the cached rates it now publishes ─
  -- mistral-large-latest followed Large 3 -> Large 4. Was 0.50 / 1.50.
  ('mistral', 'mistral-large-latest',       0.70,   2.10,   0.07,   NULL),
  ('mistral', 'zai-glm-5-3-flash',          0.15,   0.50,   0.03,   NULL),
  -- Cache-read backfill. These prices are otherwise unchanged; the point of
  -- the row is the cache_read column, which was NULL and therefore billed
  -- every cache hit at the full input rate.
  ('mistral', 'mistral-small-latest',       0.15,   0.60,   0.015,  NULL),
  ('mistral', 'ministral-3b-latest',        0.10,   0.10,   0.01,   NULL),
  ('mistral', 'ministral-8b-latest',        0.15,   0.15,   0.015,  NULL),
  ('mistral', 'ministral-14b-latest',       0.20,   0.20,   0.02,   NULL),
  ('mistral', 'codestral-latest',           0.30,   0.90,   0.03,   NULL),
  ('mistral', 'zai-glm-5-3',                1.40,   4.40,   0.14,   NULL),
  ('mistral', 'mistral-embed',              0.10,   0.000,  0.01,   NULL),
  ('mistral', 'codestral-embed',            0.15,   0.000,  0.015,  NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

-- ── Anthropic Haiku 5.5: prompt-length tier at 100k, flat 5x on every axis ──
-- Not the 2x input / 1.5x output shape OpenAI uses. See the header for why the
-- long_* columns express this correctly (strict >, cache tokens counted).
UPDATE model_prices
   SET long_context_threshold_tokens = 100000,
       long_prompt_price_per_1m      = 0.50,
       long_completion_price_per_1m  = 2.50,
       long_cache_read_price_per_1m  = 0.05,
       long_cache_write_price_per_1m = 0.625,
       updated_at                    = now()
 WHERE provider = 'anthropic' AND model = 'claude-haiku-5-5';

-- ── OpenAI GPT-6.1: 272k tier, 2x on input and cache, 1.5x on output ────────
UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  4.00,
       long_completion_price_per_1m  = 15.00,
       long_cache_read_price_per_1m  =  0.20,
       long_cache_write_price_per_1m =  5.00,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-6.1-sol';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  2.00,
       long_completion_price_per_1m  =  7.50,
       long_cache_read_price_per_1m  =  0.10,
       long_cache_write_price_per_1m =  2.50,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-6.1-terra';

UPDATE model_prices
   SET long_context_threshold_tokens = 272000,
       long_prompt_price_per_1m      =  30.00,
       long_completion_price_per_1m  = 112.50,
       long_cache_read_price_per_1m  =   3.00,
       long_cache_write_price_per_1m =  37.50,
       updated_at                    = now()
 WHERE provider = 'openai' AND model = 'gpt-6-rosalind';
