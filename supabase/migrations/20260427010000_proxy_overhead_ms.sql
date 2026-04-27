-- Track proxy overhead separately from provider latency.
-- latency_ms (existing) = time for the upstream provider fetch.
-- proxy_overhead_ms (new) = our pre-fetch processing time
--   (auth + key decryption + body parsing) measured in the proxy handler.
-- Overhead target: p95 < 50ms.

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS proxy_overhead_ms INTEGER;
