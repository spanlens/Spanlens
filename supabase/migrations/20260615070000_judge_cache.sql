-- P3-18: judge result cache.
--
-- Today the same (response_text, evaluator_config) re-evaluation re-charges
-- every time — running the same eval twice on the same prompt version against
-- the same production sample pays the judge LLM twice. judge_cache memoises
-- the outcome keyed by (org, evaluator_config_hash, response_hash) so a hit
-- returns the stored score/reasoning at $0.
--
-- evaluator_config_hash is a deterministic SHA-256 over the JSON-serialised
-- judge config (criterion + provider + model + scale + score_config_id +
-- rubric + anchors). Editing the evaluator naturally invalidates its cache
-- entries — no manual invalidation API needed.
--
-- response_hash is SHA-256 over the response text being judged.
--
-- cache_hits on eval_runs lets the dashboard show "12 cached, $0.04 saved"
-- and the SDK can read it in CI.

CREATE TABLE IF NOT EXISTS public.judge_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  evaluator_config_hash text NOT NULL,
  response_hash text NOT NULL,
  -- Mirror of JudgeOutcome value columns. Exactly one of score / value_string /
  -- value_boolean is non-null per row depending on the score_config data_type.
  score numeric,
  value_number numeric,
  value_string text,
  value_boolean boolean,
  value_raw_number numeric,
  reasoning text,
  -- Original (uncached) call's cost / tokens — informational, the cache hit
  -- itself bills $0 to the org. Lets dashboards report cumulative savings.
  original_cost_usd numeric NOT NULL DEFAULT 0,
  original_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- (org, config_hash, response_hash) is the natural cache key. UNIQUE so the
  -- lookup is a single equality on the index and the runner's "insert on
  -- miss" path uses ON CONFLICT DO NOTHING idempotently.
  CONSTRAINT judge_cache_key_uniq UNIQUE (organization_id, evaluator_config_hash, response_hash)
);

ALTER TABLE public.judge_cache ENABLE ROW LEVEL SECURITY;

-- Index for the TTL cleanup cron (delete WHERE created_at < now() - interval '30 days').
CREATE INDEX IF NOT EXISTS judge_cache_created_at_idx ON public.judge_cache (created_at);

-- P3-18: per-run cache-hit tally. Additive NOT NULL DEFAULT 0 so existing
-- rows are valid and the dashboard's pre-feature view shows 0 hits unchanged.
ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS cache_hits integer NOT NULL DEFAULT 0;
