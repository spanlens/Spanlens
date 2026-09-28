-- DeepSeek legacy aliases — 2026-09-28, follow-up to 20260928120000.
--
-- Source: api-docs.deepseek.com/quick_start/pricing, re-read 2026-09-28 while
-- chasing the deepseek-chat / deepseek-reasoner question. The page has a
-- legacy-names note that the earlier pass of the same audit missed:
--
--   "The legacy names deepseek-v4-flash and deepseek-v4-flash-vision-exp are
--    still accepted, but the corresponding models have been retired, their
--    requests are served by the DeepSeek-V4.1-Flash model and billed at the
--    Flash price."
--
-- That changes two things.
--
--   1. deepseek-v4-flash is NOT delisted, it is re-pointed. Migration
--      20260928120000 kept it at its last published rates (0.22 / 0.66 / 0.007)
--      under the standing "a model gone from the pricing page keeps its row"
--      rule. Wrong rule for this case: the id still works and DeepSeek now
--      bills it at the Flash price, so we were over-reporting input by 47%,
--      output by 10% and cache reads by 133%. Re-pointed to 0.15 / 0.60 / 0.003.
--
--      The general lesson, now recorded in the skill: "gone from the page" and
--      "aliased onto a new model" look identical in a diff, and only the second
--      one means the price moved. Read the alias notes before freezing a row.
--
--   2. deepseek-v4-flash-vision-exp is a second live alias we have never had a
--      row for, so it logged cost_usd = NULL. Same Flash price.
--
-- deepseek-chat / deepseek-reasoner are DELETED, which is a deliberate
-- exception to the "keep the row" rule. The rule exists so historical requests
-- still price, and the justification does not hold here:
--
--   • DeepSeek publishes a legacy-alias list, and these two are absent from it.
--     Their absence is now an explicit statement, not merely an omission — the
--     same page names two other aliases and says exactly how they bill.
--   • `requests` contains zero rows for provider = 'deepseek' over all
--     retained history, so there is no past to re-price and no recompute path
--     (api/requests.ts) that can reach them.
--   • The rows claim 0.14 / 0.28 / 0.0028, which is not a price DeepSeek
--     charges for anything today. Keeping them preserves a wrong number rather
--     than a historical one.
--
-- If either id turns out to still resolve, re-add it pointed at whatever the
-- docs then say it bills as — do not restore the 0.14 / 0.28 values.

INSERT INTO model_prices (
  provider, model,
  prompt_price_per_1m, completion_price_per_1m,
  cache_read_price_per_1m, cache_write_price_per_1m
) VALUES
  -- Both are live aliases onto DeepSeek-V4.1-Flash, billed at the Flash price.
  -- Off-peak, consistent with every other DeepSeek row (see 20260821120000).
  ('deepseek', 'deepseek-v4-flash',            0.15,  0.60,  0.003,  NULL),
  ('deepseek', 'deepseek-v4-flash-vision-exp', 0.15,  0.60,  0.003,  NULL)
ON CONFLICT (provider, model) DO UPDATE
  SET prompt_price_per_1m      = EXCLUDED.prompt_price_per_1m,
      completion_price_per_1m  = EXCLUDED.completion_price_per_1m,
      cache_read_price_per_1m  = EXCLUDED.cache_read_price_per_1m,
      cache_write_price_per_1m = EXCLUDED.cache_write_price_per_1m,
      updated_at               = now();

DELETE FROM model_prices
 WHERE provider = 'deepseek'
   AND model IN ('deepseek-chat', 'deepseek-reasoner');
