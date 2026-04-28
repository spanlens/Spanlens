-- The previous migration (20260428180000) used CREATE OR REPLACE with a new
-- 5th parameter (p_granularity TEXT DEFAULT 'day'). Because the parameter
-- count changed, PostgreSQL created a SECOND overloaded function instead of
-- replacing the original 4-parameter version. PostgREST sees two functions
-- with the same name → ambiguity → 500 on any call to that function.
--
-- Fix: drop the old 4-parameter signature. The new 5-parameter version
-- already has DEFAULT 'day', so all existing callers (spend-forecast, etc.)
-- continue to work without passing p_granularity.

DROP FUNCTION IF EXISTS stats_timeseries(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ);
