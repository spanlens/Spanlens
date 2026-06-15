-- P1-7 (3/3): pairwise (A vs B) judge mode.
--
-- A single-version run scores ONE prompt version on an absolute scale.
-- A pairwise run compares TWO versions head-to-head on the same dataset inputs
-- and asks the judge which response is better. Relative judgments are far more
-- consistent than absolute scores (the "LLM arena" method), so a B-vs-A
-- win-rate is a more trustworthy signal than "B scored 0.84 vs A's 0.81".
--
-- We deliberately reuse avg_score / score_stddev instead of new aggregate
-- columns: each comparison stores score = 1.0 when B wins, 0.0 when A wins,
-- 0.5 on a tie, so avg_score IS B's win-rate and the 95% CI from P1-7 part 1
-- applies to it for free. a_wins / b_wins / ties carry the raw tally for the
-- dashboard breakdown.
--
-- All additive (gotcha #25). mode defaults to 'single' so existing rows and the
-- single-version code path are byte-identical. Consistency CHECKs make a
-- pairwise run without its B version, or an out-of-range winner, impossible at
-- the DB level (the untyped supabaseAdmin client can't catch those in app code).

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'single';

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS prompt_version_b_id uuid REFERENCES public.prompt_versions(id) ON DELETE SET NULL;

ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS a_wins integer;
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS b_wins integer;
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS ties integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.eval_runs'::regclass AND conname = 'eval_runs_mode_check'
  ) THEN
    ALTER TABLE eval_runs ADD CONSTRAINT eval_runs_mode_check CHECK (mode IN ('single', 'pairwise'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.eval_runs'::regclass AND conname = 'eval_runs_pairwise_requires_b'
  ) THEN
    ALTER TABLE eval_runs ADD CONSTRAINT eval_runs_pairwise_requires_b CHECK (
      mode <> 'pairwise' OR prompt_version_b_id IS NOT NULL
    );
  END IF;
END $$;

-- Per-comparison winner for pairwise rows ('a' | 'b' | 'tie'); NULL for
-- single-mode results (which use score / value_* columns instead).
ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS winner text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.eval_results'::regclass AND conname = 'eval_results_winner_check'
  ) THEN
    ALTER TABLE eval_results ADD CONSTRAINT eval_results_winner_check CHECK (
      winner IS NULL OR winner IN ('a', 'b', 'tie')
    );
  END IF;
END $$;
