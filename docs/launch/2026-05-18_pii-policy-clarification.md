# PII Policy Clarification — 2026-05-18

> **Type:** Documentation / Marketing copy
> **Risk:** None (no code/behavior change)
> **Related PRs:** [#25](https://github.com/spanlens/Spanlens/pull/25)
> **Plan reference:** `docs/plans/launch-readiness-master-plan.md` § P1.3

## Summary

Marketing copy on the landing page (`apps/web/app/page.tsx`) overstated PII
handling — phrasing like "Redact before it hits disk" implied automatic
masking of every detected PII pattern, while the actual implementation only
masks API key patterns and flags other PII for review in the Security
dashboard. P1.3 Option A landed in PR #25: keep the conservative
implementation, fix the marketing copy.

## What changed in the product

Nothing. No SDK changes, no server changes, no DB migration.

## What changed in the documentation

### Landing page feature card

- **Before:** "Redact before it hits disk"
- **After:** "API keys auto-masked before storage; PII patterns flagged for
  review"

### Landing FAQ — "How do you handle PII?"

Now states exactly three mechanisms:

1. **API key auto-masking** — `apps/server/src/lib/pii-mask.ts` strips the
   `sl_live_`, `sk-`, `sk-ant-`, `sk-proj-`, `AIza` patterns from logged
   request bodies before they reach storage.
2. **PII pattern detection (flag, not mask)** — `apps/server/src/lib/security-scan.ts`
   scans for SSN / IBAN / credit card / email / phone / passport patterns and
   writes them to the `flags` column on `requests`. The request body itself
   is **not** rewritten. Customers see the matches in the Security dashboard
   and can act on them.
3. **Customer-controlled body storage** — clients can send
   `X-Spanlens-Log-Body: meta` (or `none`) to skip body persistence
   entirely. See `apps/server/src/lib/logger.ts` `parseLogBodyMode`.

## What customers should know

- If you previously relied on Spanlens to scrub PII automatically from your
  prompt bodies, **set `X-Spanlens-Log-Body: meta`** on requests carrying
  sensitive content. The SDK helper is `withLogBody('meta')`.
- API keys remain auto-masked — this change is purely about expectations on
  *other* PII patterns (SSN, email, etc.).
- The Security dashboard surface for flagged PII is unchanged.

## Why Option A (clarify) over Option B (implement aggressive masking)

The master plan offered two paths:

- **Option A (chosen):** narrow the marketing copy to match the conservative
  implementation.
- **Option B (deferred):** apply `security-scan.ts` patterns inside
  `pii-mask.ts` to actually mask SSN / IBAN / etc. in stored bodies.

Option B was deferred because:

- The credit card / SSN / phone regexes have a non-trivial false-positive
  rate on freeform LLM prompts. Aggressively rewriting prompt bodies risks
  destroying legitimate user content (model numbers, order IDs, anything
  that *looks* like a card number to a 13–19 digit regex).
- Luhn / IBAN mod-97 validation would reduce false positives but still costs
  developer effort and customer education we can't ship before launch.
- The `X-Spanlens-Log-Body` header already gives customers a clean opt-out.

Option B remains on the roadmap as an enterprise feature; when there is a
concrete customer ask, we'll revisit with a `'masked'` value on the SDK
`logBody` option.

## Verification

- ✅ Landing page FAQ — no remaining "masking" language about PII patterns
  other than API keys.
- ✅ `docs/` — full-text grep for "PII" / "redact" turns up no overclaiming
  copy.
- ✅ SDK option `logBody` documented unchanged.
- ⏸️ Privacy Policy / DPA — to be reflected when P1.6 lands (legal track).
