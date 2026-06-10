-- R-12 Phase 3.1 — per-org events read switch.
--
-- `read_from_events = true` flips every ClickHouse read path (requests list,
-- traces, stats) for that organization onto the unified `events` table,
-- independent of the global USE_EVENTS_FOR_* env flags. This is the gradual
-- cutover lever: dogfood org first, then 10% -> 50% -> 100% (Phase 3.3).
--
-- The per-org flag deliberately bypasses the EVENTS_BACKFILL_COMPLETE env
-- double-gate that guards the env flags: setting a row here is a targeted
-- operator action (UPDATE on one org after verifying that org's events data),
-- not a blunt fleet-wide env flip. See apps/server/src/lib/events-read-flag.ts.
--
-- Additive + idempotent (gotcha #25): NOT NULL + DEFAULT false backfills
-- existing rows automatically; reruns are no-ops.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS read_from_events boolean NOT NULL DEFAULT false;
