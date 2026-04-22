-- Phase 3A — security scan flags on requests
--
-- Flags are attached by lib/logger.ts at log time via lib/security-scan.ts.
-- Shape: jsonb array of { type: 'pii' | 'injection', pattern: string, sample: string }
-- Empty array when clean. We keep the column NOT NULL with default '[]'::jsonb
-- so query code can rely on array semantics without null checks.
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Partial index: only rows WITH flags. Empty-array rows stay out so the
-- index is small even when most traffic is clean.
CREATE INDEX IF NOT EXISTS idx_requests_flags_nonempty
  ON public.requests ((organization_id))
  WHERE jsonb_array_length(flags) > 0;

COMMENT ON COLUMN public.requests.flags IS
  'Security scan results: [{type, pattern, sample}]. Populated by lib/security-scan.ts. Empty when clean.';
