-- Migration: per-organization request-body sampling rate.
--
-- High-traffic customers pay for ClickHouse storage that is dominated by the
-- request/response *body* columns (prompt + completion text). This adds an
-- opt-in knob to store bodies for only a fraction of requests.
--
-- IMPORTANT — this is BODY sampling, not ROW sampling. Every request still
-- writes a row (id, tokens, cost, latency, model), so quota/billing counts
-- (which count rows from the ClickHouse `requests` table via quota.ts →
-- requestsScope) stay exact. Only the heavy body text is dropped for the
-- sampled-out fraction, exactly like the existing x-spanlens-log-body=meta
-- mode but applied probabilistically per-org.
--
-- Default 1.0 = store every body (unchanged behavior). Additive + NOT NULL
-- with a default so existing rows backfill automatically.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS body_sample_rate NUMERIC(4, 3) NOT NULL DEFAULT 1.0
    CHECK (body_sample_rate >= 0 AND body_sample_rate <= 1);

COMMENT ON COLUMN organizations.body_sample_rate IS
  'Fraction [0,1] of requests whose prompt/response BODIES are stored in ClickHouse. 1.0 = all (default). Row + tokens + cost are always stored regardless, so billing is unaffected.';
