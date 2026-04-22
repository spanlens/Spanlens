-- Migration: overage_policy
-- Per-organization controls for the Pattern C quota policy:
--
--   Free plan:                   always hard-blocked at limit (ignored: columns below)
--   Paid plan + allow_overage=true:
--     - usage < limit: pass
--     - usage in [limit, limit * overage_cap_multiplier): pass + accumulates overage
--     - usage >= limit * overage_cap_multiplier: hard-blocked (safety)
--   Paid plan + allow_overage=false:
--     - usage >= limit: hard-blocked (legacy Pattern A behavior)
--
-- Defaults: overage on, 5x hard cap. Starter (100K) gets 500K hard cap;
-- Team (500K) gets 2.5M hard cap. This bounds the worst-case runaway
-- monthly bill to a predictable multiple of the plan fee.

ALTER TABLE organizations
  ADD COLUMN allow_overage              BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN overage_cap_multiplier     INTEGER NOT NULL DEFAULT 5
    CHECK (overage_cap_multiplier BETWEEN 1 AND 100);
