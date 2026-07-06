-- 20260706160000_proxy_response_cache.sql
-- Opt-in exact-match proxy response cache (x-spanlens-cache header).
--
-- key_hash is sha256(api_key_id + provider + request path + raw request body),
-- computed server-side in apps/server/src/lib/proxy-cache.ts. Because the
-- Spanlens key id is part of the hash AND stored on the row, an entry can
-- never be served across keys (and therefore never across projects or orgs).
--
-- Access model: server-only via supabaseAdmin (service_role). RLS is enabled
-- with NO policies so anon/authenticated clients can never read cached
-- provider responses. Do not add client-facing policies to this table.
--
-- Cleanup: expired rows are deleted opportunistically on cache misses
-- (proxy-cache.ts deleteExpiredCacheEntry) — no cron. The expires_at index
-- supports any future bulk cleanup job.
--
-- Idempotent per CLAUDE.md DB rules (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS proxy_response_cache (
  key_hash text PRIMARY KEY,
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  provider text NOT NULL,
  response_status int,
  response_body text,
  usage jsonb,
  model text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE proxy_response_cache ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_proxy_response_cache_expires_at
  ON proxy_response_cache (expires_at);
