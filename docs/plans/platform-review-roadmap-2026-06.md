# Platform Review Roadmap (2026-06)

Status: in progress
Author: codebase review (2026-06-19), branch `feat/judge-prompt-caching`
Scope: `apps/server`, `apps/web`, `supabase/`

Progress:

- Phase 0 (security hardening): DONE, merged in #369 (2026-06-19).
- Phase 1 (proxy rate-limit relaxation): DONE, merged in #370 (2026-06-19).
- Phase 2 (customer-configurable rate limiting): DONE, merged in #371 (2026-06-19); prod migration applied.
- Phase 3 (proxy hot-path performance): DONE, merged in #372 (2026-06-19).
- Phase 4 (code-quality refactor): in progress, sub-PR A (4.3 + 4.4) ready; 4.1/4.2/4.5/4.6/4.7 remaining.
- Phase 5: not started.

## Context

This roadmap collects the actionable findings from a full codebase review into
six phases. Every item below was verified against the working tree, so the file
and line references are concrete starting points, not guesses. The codebase is
healthy overall (multi-tenant isolation, `fireAndForget` drain, SWR cost cache,
ClickHouse org + retention scoping, and `Number()` coercion are all in place),
so this plan is about closing the remaining gaps rather than large rewrites.

The two product decisions that triggered this plan:

1. The per-minute proxy rate limit should be relaxed into a pure anti-runaway
   ceiling that never hard-rejects customer LLM traffic. Monetization stays on
   the monthly quota.
2. Real rate limiting should become a customer-facing feature (limits the
   customer sets on their own keys and end-users), matching the market norm
   (Helicone, Portkey, LiteLLM).

### Legend

- Effort: S (under half a day), M (one to two days), L (multi-day).
- Risk: low / med (behavioral surface area, test churn, or hot-path impact).

### Verification convention (applies to every item)

Per the project PR checklist, run all four and do not skip lint:

- Server changes: `pnpm --filter server typecheck && pnpm --filter server lint && pnpm --filter server test`
- Web changes: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
- Migrations: `supabase db push && supabase gen types --lang typescript --local > supabase/types.ts`
- Cross-package: `pnpm typecheck && pnpm lint`

### Phase dependency graph

```
Phase 0 (security)        independent, ship first
Phase 1 (proxy relax)     independent; shares rate-limit.ts with P0 item 2 and P2
Phase 2 (customer limits) DB -> enforcement -> API -> UI -> docs (internal order)
Phase 3 (hot path)        item 3.2 before 3.3 (same 6 proxy files); 3.1 independent
Phase 4 (quality)         4.1 split BEFORE 4.2 dedup; web items independent
Phase 5 (tests)           5.1 first (highest value); 5.2 experiment-runner after 4.2
```

---

## Phase 0: Security hardening

Status: DONE, merged in #369 (2026-06-19). Verified with
`pnpm --filter server typecheck && lint && test` (1310 tests green).

Goal: close four confirmed security gaps. All additive, low to med risk, no
migrations. Ship first since they are independent of everything else.

### 0.1 IP-rate-limit the frontend-error sink (S, low)

The `/api/v1/frontend-errors` endpoint is unauthenticated AND its router is
mounted at `app.ts:166` before `apiRateLimit` at `app.ts:171`, so the dashboard
rate limit never runs for it. The docstring at `frontendErrors.ts:7-9` already
promises a per-IP cap that was never implemented. An anonymous client can flood
structured logs unbounded.

- Files: `apps/server/src/api/frontendErrors.ts:45-82`, `apps/server/src/middleware/rateLimit.ts:93-95`, reference pattern `apps/server/src/api/publicShare.ts:39-55` and `badge.ts:35`.
- Change: add a `frontendErrorsRouter.use('*', ...)` per-IP limiter using `checkRateLimit(\`fe-err:${ip}\`, 30)` from `lib/rate-limit.ts`. On limit, return `204` (not `429`) to preserve the existing always-204 fail-soft contract.

Success criteria:

- [x] 31st POST from the same `x-forwarded-for` IP within 60s returns 204 and writes no `[frontend-error]` log line (verify with a `console.error` spy).
- [x] Requests under the cap still log and return 204.
- [x] `checkRateLimit` imported from `lib/rate-limit.js`, not reimplemented.
- [x] Server typecheck + lint + test pass.

### 0.2 Make rate-limit fail-open observable (M, med)

`checkRateLimit` fails open in two branches: silently when Redis env vars are
unset (`rate-limit.ts:90-93`, no log at all) and with a raw `console.error` on
Redis error (`rate-limit.ts:98-101`). A prod deploy missing the KV env vars
disables all rate limiting with zero signal.

- Files: `apps/server/src/lib/rate-limit.ts:84-102`, `apps/server/src/lib/structured-logger.ts:119-125`.
- Change: replace the raw `console.error` with `logError` using a stable code (add `RATE_LIMIT_BACKEND_DOWN` to the LogCode union). Add a module-level once-guard warn in the unconfigured branch. Optional: in-process `Map` sliding-window fallback so a warm instance still caps abuse during a Redis outage (document that it is per-instance and weaker than the shared window).

Success criteria:

- [x] With KV env vars unset, the first call emits exactly one structured warn with a stable code; later calls do not spam (module guard).
- [x] On `limiter.limit()` throw, a structured error line with a stable LogCode is emitted (err passed through `logError`).
- [x] In-process fallback NOT implemented; fail-open is explicitly retained and documented, only logging changed.
- [x] New tests for the null-limiter (warn-once) path and the rejection path; happy-path tests still pass.

### 0.3 Apply plan retention to anomaly queries (M, med)

`detectAnomalies` and `fetchContributingFactors` enforce org isolation but not
plan retention (free = 14d). The default 168h window is incidentally within
free retention today, but `referenceHours` is caller-overridable and
`exports.ts:358` + `anomaly-snapshot.ts:67` also call it, so a larger window
would read past a free org's retention. Violates gotcha #3.

- Files: `apps/server/src/lib/anomaly.ts:146-202`, `:346-381`, `apps/server/src/lib/requests-query.ts:118-133`.
- Change: inject `requestsScope(organizationId)` into both queries. Merge `scopeParams` into params, replace the literal `organization_id = {orgId:UUID}` with `whereScope`, drop the now-duplicate manual orgId param.

Success criteria:

- [x] Both queries include the retention bound (free=14 / pro=90 / team=365) plus org filter and refStart.
- [x] A free-plan org with `referenceHours` > 336h reads at most 14 days of rows (verify via mocked `unscopedClickhouse` SQL capture).
- [x] `anomaly-detect.test.ts` / `anomaly-confidence.test.ts` mocks updated for the new WHERE shape and still pass.
- [x] No duplicate-key collision in `query_params`.

### 0.4 Validate proxy `*_API_BASE` env vars against SSRF (M, med)

`OPENAI_API_BASE` (`openai.ts:25-27,48`), `OPENROUTER_API_BASE`
(`openrouter.ts:41-43,68`), and `MISTRAL_API_BASE` (`mistral.ts:28-29,53`) are
read from env and concatenated into the upstream URL with no validation. A
misconfigured or injected base could redirect a customer's decrypted provider
key to an internal target. `lib/safe-url.ts` already exports
`validateOutboundUrlSync` (built for webhook SSRF). Anthropic and Gemini use
hardcoded constants (safe); Azure uses a DB-backed per-key resource_url
(separate surface, noted as follow-up).

- Files: `apps/server/src/proxy/{openai,openrouter,mistral}.ts`, `apps/server/src/lib/safe-url.ts:176-228`.
- Change: at module load, if the `*_API_BASE` env var is set, call `validateOutboundUrlSync` and throw on failure (fail fast). Extract a shared `proxy/shared/validate-base.ts`. Gate the throw behind `NODE_ENV === 'production'` so the documented E2E `http://localhost:4000` mock (https-only check would reject it) is not broken.

Success criteria:

- [x] Setting any of the three bases to an internal/SSRF target (`http://169.254.169.254`, `https://10.0.0.1`) throws at startup in production; no request forwarded.
- [x] Unset env vars (prod defaults) pass; behavior unchanged.
- [x] The non-prod `localhost:4000` mock override still works.
- [x] `validateOutboundUrlSync` reused from `lib/safe-url.js` (no new IP/CIDR logic).

### Phase 0 exit checklist

- [x] 0.1 through 0.4 merged (#369).
- [x] `pnpm --filter server typecheck && lint && test` green (1310 tests).
- [ ] Better Stack / log drain alert wired on the new `RATE_LIMIT_BACKEND_DOWN` code. (ops follow-up, not code)

---

## Phase 1: Proxy rate-limit relaxation

Goal: turn the per-minute proxy ceiling into an anti-runaway signal that never
hard-rejects customer traffic. Monetization stays entirely on the monthly quota
(`enforceQuota`), which runs right after `proxyRateLimit` on the same request.

Wiring confirmed: all 6 proxies mount `authApiKey -> requireFullScope ->
proxyRateLimit -> enforceQuota`. The two limits are independent.

### 1.1 Raise `PROXY_RATE_LIMITS` to anti-runaway ceilings (S, low)

Current: `{ free: 60, starter: 300, team: 1_500, enterprise: null }`
(`rate-limit.ts:11-16`), per-org 60s sliding window.

- Files: `apps/server/src/lib/rate-limit.ts:11-16`, `apps/server/src/middleware/rateLimit.ts:18-24` (doc comment), `apps/server/src/__tests__/middleware-rate-limit.test.ts:75,78,102,112-117`.
- Change: raise roughly 10x (e.g. `free: 600, starter: 3_000, team: 15_000, enterprise: null`; finalize with product). Optionally read env overrides (e.g. `PROXY_RATE_LIMIT_FREE`) defaulting to the constants so ceilings tune without a deploy.

Success criteria:

- [x] `PROXY_RATE_LIMITS` reflects new ceilings (free 600 / starter 3000 / team 15000, env-overridable); enterprise stays null.
- [x] Doc comment in `rateLimit.ts` matches new numbers.
- [x] `middleware-rate-limit.test.ts` updated to the new free/team values and passes.

### 1.2 Pass through on overage instead of throwing 429 (S, med)

Current: over-ceiling throws `ApiError('RATE_LIMIT')` -> HTTP 429, hard-rejecting
the customer's LLM request on the critical path (`rateLimit.ts:56-68`).

- Files: `apps/server/src/middleware/rateLimit.ts:43-75`, `apps/server/src/__tests__/middleware-rate-limit.test.ts:83-94`.
- Change: on `!allowed`, emit a structured `console.warn` (`event: 'proxy_rate_limit_overage'` with `organizationId`, `plan`, `limit`), set `X-Spanlens-RateLimit-Overage: true`, and `return next()`. Do not set `Retry-After`, do not throw. `enforceQuota` still runs next and remains the real gate.

Success criteria:

- [x] `proxyRateLimit` never throws on the per-minute bucket; over-ceiling requests reach upstream.
- [x] Structured warn line (`PROXY_RATE_LIMIT_OVERAGE`) emitted exactly when over the ceiling.
- [x] Response carries `X-Spanlens-RateLimit-Overage: true` on overage and standard `X-RateLimit-*` headers on every response.
- [x] `middleware-rate-limit.test.ts` over-limit test rewritten: asserts pass-through (200) + header + warn spy, not 429.
- [x] Monthly `enforceQuota` can still 429 (`free_limit` / `overage_disabled` / `hard_cap`) independently (middleware-quota.test.ts unchanged, still green).

### 1.3 Confirm monthly quota fully covers monetization (S, low)

No code change. `MONTHLY_REQUEST_LIMITS = { free: 50_000, starter: 100_000,
team: 1_000_000, enterprise: null }` (`quota.ts:14-19`), enforced by
`enforceQuota` regardless of per-minute behavior.

Success criteria:

- [x] Plan states that free-tier monetization is the monthly limit enforced by `enforceQuota`, not the per-minute bucket (documented in `rate-limit.ts` + `middleware/rateLimit.ts`).
- [x] `enforceQuota` mount position (after `proxyRateLimit`) verified in all 6 proxies.
- [x] Existing `middleware-quota.test.ts` still passes unchanged.

### 1.4 (Optional) Distinguish over-limit from Redis-error fail-open (M, low)

Once 1.2 lands, an over-limit signal and a silent Redis outage both look like
"under the limit" in metrics. Widen `checkRateLimit`'s return type so callers
tell the cases apart and emit a distinct `proxy_rate_limit_degraded` warn.
Connects with Phase 0 item 0.2. Upstash `Ratelimit.limit()` already returns
`{ success, limit, remaining, reset }`, so no extra round-trip.

- Files: `apps/server/src/lib/rate-limit.ts:84-102`, `apps/server/src/__tests__/rate-limit.test.ts:178-214`.

Success criteria:

- [ ] Return type distinguishes `over_limit` vs Redis-degraded fail-open.
- [ ] `rate-limit.test.ts` Redis-error case asserts the degraded flag (still allows the request).
- [ ] `proxyRateLimit` emits a separate warn for the degraded case; happy path unchanged.

### Phase 1 exit checklist

- [x] 1.1 through 1.3 implemented and verified (typecheck + lint + 1300 tests green); 1.4 deferred as optional follow-up.
- [x] No proxy path returns 429 from the per-minute bucket.
- [x] Overage observability via `PROXY_RATE_LIMIT_OVERAGE` warn + `X-Spanlens-RateLimit-Overage` header.

---

## Phase 2: Customer-configurable rate limiting (new feature)

Status: DONE, merged in #371 (2026-06-19). Prod migration applied via
deploy-server.yml. All six items (2.1 through 2.6) shipped.

Goal: let customers set rate limits on their own keys, projects, and end-users;
enforce them in the proxy and return 429 to the customer's end-user when hit.
This is the desired 429 (unlike our platform limit). Internal order is strict:
DB -> enforcement -> API -> UI -> docs.

Key constraint (gotcha #24): reuse `@upstash/ratelimit` (Lua `EVAL`), never raw
`redis.set` (silently fails on Upstash free tier). End-user identifier is the
existing `x-spanlens-user` header (read at `log-base.ts:74`; SDK `withUser()`
already sets it), so no new SDK header is needed.

### 2.1 DB migration: `customer_rate_limits` table (M, low)

- Files: `supabase/migrations/20260620000000_customer_rate_limits.sql` (NEW), mirror conventions from `20260604040000_api_keys_public_scope.sql` (CHECK + RLS) and `20260606000000_pending_deletions.sql` (deny-all + service_role); `is_org_member` helper from `20260420000000_initial_schema.sql`.
- Change: one polymorphic table covering all three granularities.
  - `id`, `organization_id` (NOT NULL, RLS anchor), `target_type` CHECK in (`api_key`, `project`, `end_user`), `api_key_id`, `project_id`, `end_user_id` (TEXT, the `x-spanlens-user` value), `max_requests` (CHECK > 0), `window_seconds` (CHECK in 60/3600/86400, keeps the limiter cache bounded), `is_active`, `created_at`, `updated_at`.
  - Owner-consistency CHECK mirroring `api_keys_scope_owner_consistency`.
  - Partial UNIQUE indexes per target type; lookup indexes on `(api_key_id, is_active)` and `(project_id, is_active)`.
  - `ENABLE ROW LEVEL SECURITY`; SELECT `USING (is_org_member(organization_id))`; RESTRICTIVE deny-all for anon/authenticated; service_role ALL.
  - All statements idempotent; additive columns NOT NULL + DEFAULT (gotcha #25).

Success criteria:

- [x] `supabase db push` applies cleanly on a fresh throwaway DB (CI migrations step passed; prod migration applied via deploy-server.yml).
- [ ] `supabase gen types` regenerates `types.ts` with the new row type. NOT done: no local stack here; supabaseAdmin is untyped so it does not block compile. Regenerate when convenient.
- [x] `target_type='end_user'` with NULL `end_user_id` rejected by CHECK.
- [x] Second active `api_key`-level limit for the same key violates the partial UNIQUE index.
- [x] RLS enabled; anon/authenticated cannot write; `is_org_member` SELECT policy present.
- [x] Re-running the migration is a no-op.

### 2.2 Enforcement: `customerRateLimit` middleware (L, med)

- Files: `apps/server/src/middleware/customerRateLimit.ts` (NEW), `apps/server/src/lib/customer-limits.ts` (NEW, cached config fetch + invalidation), `apps/server/src/lib/rate-limit.ts:48-102` (extend for `windowSeconds`), all 6 `apps/server/src/proxy/*.ts` (one-line `.use` after `proxyRateLimit`), cache pattern `authApiKey.ts:84-135`.
- Change:
  1. Extend `getLimiter(limit, windowSeconds=60)` (cache key `${limit}:${windowSeconds}`) and `checkRateLimit(key, limit, windowSeconds=60)`. Existing callers default to 60, no behavior change.
  2. `customer-limits.ts`: `getCustomerLimits(apiKeyId, projectId)` fetches active rows in one `supabaseAdmin` select, cached per `apiKeyId` (~30s TTL, `invalidateCustomerLimitsCache`). Cache the empty result too so the common no-limit case is a Map lookup with zero DB round-trips.
  3. `customerRateLimit.ts` runs after `proxyRateLimit`, reads `apiKeyId`/`projectId`/`organizationId` from context and `endUserId` from the `x-spanlens-user` header. Evaluate most-specific-first (`custlimit:eu:{apiKeyId}:{endUserId}`, then `custlimit:key:{apiKeyId}`, then `custlimit:proj:{projectId}`). First deny wins. Fails open if Redis is unavailable or no config rows exist.

Success criteria:

- [x] With an api_key limit of N/min, request N+1 in-window returns 429 (`RATE_LIMIT`); under N passes.
- [x] Two different `x-spanlens-user` values get independent buckets (distinct `custlimit:eu` keys).
- [x] A key/project with no configured limit incurs zero extra Redis and zero extra DB round-trips on cache hit.
- [x] When KV env vars unset, the middleware fails open (proxy still forwards).
- [x] A non-60s window (e.g. 3600) produces a separate cached limiter and a 1-hour sliding window.
- [x] Middleware added to all 6 proxies; unit test (`customer-rate-limit.test.ts`) mirrors `middleware-rate-limit.test.ts`.

### 2.3 API: CRUD endpoints (M, low)

- Files: `apps/server/src/api/rateLimits.ts` (NEW), `apps/server/src/app.ts:191` (mount `/api/v1/rate-limits` next to provider-keys), copy patterns from `apiKeys.ts:35-47` and `providerKeys.ts:69-78`, `lib/audit-log.ts` (add `rate_limit.*` actions).
- Change: `Hono<JwtContext>` router, `.use('*', authJwt)`, `requireRole('admin','editor')`. GET (list by `apiKeyId`/`projectId`), POST (validate `window_seconds` in {60,3600,86400}, `max_requests > 0`, verify target ownership, translate PG 23505 to `CONFLICT`), PATCH, DELETE (hard delete, low-risk config). Every write calls `invalidateCustomerLimitsCache` and `recordAuditEvent`. Mounted at a concrete path (no wildcard mount-order trap).

Success criteria:

- [x] POST with a foreign `api_key_id` (different org) returns 403.
- [x] POST duplicate active limit for same target returns 409.
- [x] PATCH `is_active=false` stops enforcement within one cache TTL (<=30s) or immediately after invalidation.
- [x] All mutations appear in `audit_logs` with a `rate_limit.*` action.
- [x] Non-admin/editor and missing JWT rejected.
- [x] Reachable at `/api/v1/rate-limits`.

### 2.4 UI: rate-limit config on the Projects page (M, low)

- Files: `apps/web/app/(dashboard)/projects/projects-client.tsx`, `apps/web/app/(dashboard)/projects/page.tsx`, `apps/web/lib/queries/types.ts`.
- Change: a "Rate limits" control per Spanlens key row (per-key cap + optional per-end-user caps), and a project-level limit in the project settings panel. All reads/writes via `fetch('/api/v1/rate-limits...')` with TanStack Query mutation + invalidation. Read-only for viewer role.

Success criteria:

- [x] Admin can create/edit/delete a per-key limit from the Projects page and see it reflected after mutation.
- [x] Per-end-user limits can be added under a key and listed.
- [x] Viewer sees limits read-only (PermissionGate need="edit").
- [x] All requests go through `/api/v1/rate-limits` (no direct Supabase from web).
- [x] No hydration warnings (no Date/time rendering in the dialog; build passed). Live dashboard smoke pending after deploy.

### 2.5 429 response behavior to the end-user (S, low)

- Files: `apps/server/src/middleware/customerRateLimit.ts`, `apps/server/src/lib/errors.ts:60` (reuse `RATE_LIMIT`).
- Change: on a positively-exceeded customer limit, `throw new ApiError('RATE_LIMIT', msg, { source: 'customer_limit', scope, limit, window_seconds, end_user_id? })`. No `upgrade_url` / Spanlens pricing link (distinct from the platform 429). Set `Retry-After = window_seconds` and `X-Spanlens-RateLimit-Scope`.

Success criteria:

- [x] Exceeding a customer limit returns 429 with `code: RATE_LIMIT` and `details.source = 'customer_limit'`.
- [x] `Retry-After` equals `window_seconds`; `X-Spanlens-RateLimit-Scope` identifies which limit fired.
- [x] No Spanlens `upgrade_url` in the body (distinguishable from the platform 429).
- [x] The end-user receives the 429 body unmodified through the proxy (ApiError → global onError envelope).

### 2.6 SDK + docs (S, low)

- Files: `apps/web/app/docs/proxy/page.tsx`, `apps/web/app/docs/sdk/page.tsx`. No new SDK helper (`withUser()` already exists at `packages/sdk/src/integrations/openai.ts:104-126`).
- Change: document the feature, the 429 envelope, the `X-Spanlens-RateLimit-*` headers, and that per-end-user limits require sending `x-spanlens-user`. Cross-link `withUser()` from `/docs/sdk`.

Success criteria:

- [x] `/docs/proxy` documents the 429 shape and the `X-Spanlens-RateLimit-*` headers.
- [x] `/docs/sdk` links `withUser()` to per-end-user limits with an example.
- [x] No new SDK header introduced; existing SDK tests unchanged.
- [x] `pnpm --filter web build` passes.

### Phase 2 exit checklist

- [x] 2.1 through 2.6 implemented and verified (server: typecheck + lint + 1309 tests; web: typecheck + lint + build). PR pending.
- [ ] End-to-end against prod after merge: configure a per-key limit in the dashboard, exceed it via the proxy, observe 429 to the caller (needs the migration applied via deploy-server.yml).
- [ ] Follow-ups filed: token/cost-based limits (needs a rolling-spend counter in the log path), per-end-user limit-hit events on the `/users` dashboard.

---

## Phase 3: Proxy hot-path performance

Status: DONE, merged in #372 (2026-06-19). Server-only, no migration.
Deviation: 3.1 shipped the lower-risk variant (short-TTL count cache +
coalescing, no logger.ts increment hook). The in-memory increment refinement is
deferred as higher-risk and not needed for the core win.

Goal: remove per-request blocking work from the proxy critical path. Sequence
3.2 before 3.3 (same 6 files); 3.1 is independent.

### 3.1 Cache `checkMonthlyQuota` and static-import the policy (M, med)

`enforceQuota` runs `checkMonthlyQuota(orgId)` on every `/proxy/*` request,
uncached: a Supabase `organizations` SELECT, a full-month ClickHouse `count()`
scan that grows with volume, and a gratuitous dynamic `import('./quota-policy.js')`.

- Files: `apps/server/src/lib/quota.ts:198-250,201-205,224-239,232`, `apps/server/src/middleware/quota.ts:22-69`, mirror `apps/server/src/lib/requests-query.ts:23-79` (getOrgPlan cache), increment hook `apps/server/src/lib/logger.ts` (~line 287, after the CH insert).
- Change: (A) static-import `evaluateQuotaPolicy` (it is pure, already imported by `middleware/quota.ts:4`). (B) `getOrgQuotaSettings(orgId)` cache mirroring `getOrgPlan` (TTL Map + in-flight coalescing + reset hook). (C) in-memory month counter seeded by one `countMonthlyRequests` on cold/expired/rollover, incremented per successful logged request via `incrementMonthUsage(orgId)`, re-synced from CH on TTL expiry. Billing accuracy unaffected (Paddle/overage use `countMonthlyRequests` directly).

Success criteria:

- [x] A warm-cache `/proxy/*` request issues zero Supabase `organizations` SELECTs and zero ClickHouse `count()` from the quota path (quota-cache.test.ts asserts with spies).
- [x] `await import('./quota-policy.js')` no longer appears in `quota.ts` (now a static import).
- [x] `middleware-quota.test.ts` still passes (mocks `checkMonthlyQuota`).
- [ ] N/A for the shipped variant: the in-memory increment + logger hook was deferred, so there is no per-request increment test. Replaced by quota-cache.test.ts (cold→1 query, warm→cached, coalescing, reset, per-org isolation).
- [x] Free org crossing 50,000 still blocked with `free_limit` within one TTL window (<=10s).
- [x] `api/billing.ts` quota numbers stay correct (reads through the same cache; <=10s staleness tolerated).

### 3.2 Parallelize provider-key decrypt and body parse (S, low)

In each of the 6 proxies, `assertProviderKey` (DB + AES decrypt) and
`parseProxyRequestBody` run serially before `runSecurityGate`. They share no
inputs. `runSecurityGate` consumes `parsed.reqBodyJson`, so it stays after.

- Files: `apps/server/src/proxy/{openai,anthropic,gemini,azure,mistral,openrouter}.ts`, helpers `proxy/shared/provider-key.ts:36-49`, `proxy/shared/request-body.ts:29-51`.
- Change: `const [providerKey, parsed] = await Promise.all([assertProviderKey(...), parseProxyRequestBody(c, {...})])`, then `runSecurityGate`. Carry each file's existing parse options (openai+azure pass `injectOpenAIStreamOptions: true`). For azure, move the resource_url guard after the `Promise.all`.

Success criteria:

- [x] All 6 proxies use a single `Promise.all` before `runSecurityGate`.
- [x] `runSecurityGate` still runs after the `Promise.all`.
- [x] Azure resource_url guard still throws `INTERNAL_ERROR` when empty (proxy-azure.test.ts green).
- [x] Missing provider key still yields `NO_PROVIDER_KEY` (rejection propagates out of `Promise.all`).
- [ ] `proxy_overhead_ms` observably drops by roughly the smaller await duration. Needs prod measurement (post-merge).
- [x] Existing proxy tests unchanged (74 proxy + logger tests green).

### 3.3 Move prompt-version resolution off the streaming path (M, med)

`buildLogBase` is async only because it awaits `resolvePromptVersion`, and in
the streaming path it is awaited before the stream Response is returned. On a
cold prompt cache that is 1-2 Supabase queries delaying time-to-first-token. The
resolved id only lands on the log row.

- Files: `apps/server/src/proxy/shared/log-base.ts:52-79`, all 6 proxies' `buildLogBase` call sites and log continuations, `apps/server/src/proxy/stream-logger.ts:54-58`, `apps/server/src/lib/resolve-prompt-version.ts:45-157`, `apps/server/src/lib/logger.ts:52`.
- Change: make `buildLogBase` synchronous (capture the raw header, drop the resolve call). Resolve the prompt version inside the log continuation that already runs after the response starts: `fireAndForget(logRequestAsync(...))` (non-streaming) and the `onComplete` callback (streaming). Apply to all 6 proxies.

Success criteria:

- [x] `buildLogBase` is no longer async and contains no `resolvePromptVersion` call; callers no longer await it.
- [x] Resolution moved into `logRequestAsync`, which runs after the response is handed off (fireAndForget / stream onComplete), so the resolve queries no longer block time-to-first-token.
- [x] The logged row still carries the correct `prompt_version_id` (events-writer threads it through `requestRow`); A/B routing unchanged.
- [x] Non-streaming path resolves inside `fireAndForget` → `logRequestAsync`.
- [x] All 6 proxies updated consistently (drop `await` before `buildLogBase`).

### Phase 3 exit checklist

- [x] 3.1 through 3.3 merged in #372 (2026-06-19); verified (typecheck + lint + 1314 tests).
- [x] 3.2 (parallel pre-fetch) all 6 proxies use one `Promise.all` before `runSecurityGate`; azure resource_url guard relocated after it.
- [x] 3.3 (prompt-version deferral) `buildLogBase` is sync; resolution moved into `logRequestAsync` (runs after response handoff). New test asserts the logged row still carries the resolved id.
- [x] 3.1 (quota cache) warm-cache `/proxy/*` issues zero Supabase SELECT + zero ClickHouse count() from the quota path; dynamic import removed; `middleware-quota.test.ts` + `overage-charge-flow.test.ts` unchanged and green.
- [ ] `proxy_overhead_ms` p95 measured before/after in prod, improvement recorded (post-merge).

---

## Phase 4: Code-quality refactor

Status: in progress, shipped as sub-PRs (the 7 items are largely independent).
- Sub-PR A (4.3 error envelope + 4.4 validation helpers): DONE, merged in #373.
- Sub-PR B (4.1 eval-runner extraction + 4.2 pool dedup): implemented and verified.
  Scoped deliberately: extracted judge transport / generate / pool (1870 -> 1251
  lines), deduped `pool`. DEFERRED the deep runEvalRun branch split and the
  experiment-runner judge-logic dedup (both would be risky / behavior-changing).
Remaining: 4.5/4.6/4.7 (web giant-file extractions), plus the two deferred items above.

Goal: bring oversized files under the 800-line ceiling and remove the eval /
experiment runner duplication that makes provider additions error-prone.
Sequence: 4.1 (split) before 4.2 (dedup). Web items (4.5 through 4.7) are
independent of each other and of the server work.

### 4.1 Split `lib/eval-runner.ts` (1870 lines) (L, med)

The file already imports 8 helpers from `lib/eval-runners/` and re-exports for
back-compat. Still inline: judge transport, judge calls, generate, pool,
provider-key resolve, and the monolithic `runEvalRun` (824-1747) with trajectory
/ pairwise / single paths inlined.

- Files: `apps/server/src/lib/eval-runner.ts` (ranges 307-492, 503-714, 717-734, 824-1747, 905-1062, 1069-1254, 1555-1732), consumers `api/evals.ts`, `api/prompts.ts`, ~16 test files.
- Change: keep `eval-runner.ts` a thin dispatcher + re-export barrel (target under 400 lines). Extract `judge-transport.ts`, `judge-calls.ts`, `generate.ts`, `pool.ts`, `provider-key.ts`, `run-trajectory.ts`, `run-pairwise.ts`, `run-single.ts`, `estimate.ts` under `eval-runners/`. Re-export every previously-exported symbol so import sites and tests are untouched.

Success criteria:

- [~] `eval-runner.ts` reduced 1870 -> 1251 lines (judge transport + generate + pool extracted). Still over 800: the deep `runEvalRun` branch split (run-trajectory / run-pairwise / run-single) is DEFERRED as the highest-risk, lowest-value part (intricate DB writes / span emission / score persistence). Getting under ~400 needs that follow-up.
- [x] All previously exported symbols still re-exported (callJudge, generateForItem, callPairwiseJudge, callTrajectoryJudge, JudgeOutcome/PairwiseOutcome/TrajectoryOutcome, EvalProvider, + the existing set).
- [x] Server typecheck passes.
- [x] Server test passes with zero changes to the existing eval test files (107 eval-suite tests green).
- [x] New files (`eval-runners/judge-calls.ts`, `generate.ts`, `pool.ts`) under ~400 lines; behavior preserved (code moved verbatim).

### 4.2 Consolidate experiment-runner duplication (M, med)

`experiment-runner.ts` reimplements `pool` (byte-identical), a local
`JudgeConfig`, simpler `buildJudgePrompt`/`parseJudgeReply` clones, and a 167-line
`callJudge` that duplicates the judge transport. The header comments admit the
duplication was to avoid circular imports, which 4.1 removes.

- Files: `apps/server/src/lib/experiment-runner.ts:27-33,228-245,247-262,264-430,434-451`, leaf modules from 4.1, `lib/eval-runners/judge-prompt.ts:208-322`.
- Change: after 4.1 lands leaf modules, replace local `pool`, `JudgeConfig`, `buildJudgePrompt`/`parseJudgeReply`, and `callJudge` with imports from the shared modules. Net removal ~210 lines.

Success criteria:

- [x] `experiment-runner.ts` no longer defines `pool` (imports the shared `eval-runners/pool.js`).
- [ ] DEFERRED: it still defines local `JudgeConfig` / `buildJudgePrompt` / `parseJudgeReply` / `callJudge`. Consolidating these onto `eval-runners/judge-{prompt,calls}` would change the judge prompt wording this A/B feature sends, shifting its scores. That is a deliberate product decision, not a behavior-preserving refactor, so it is intentionally NOT done here (documented in-source).
- [x] No circular import (tsc clean).
- [x] A/B scoring output unchanged (judge logic left untouched; only `pool` deduped).

### 4.3 Route bare `c.json` errors through `ApiError` (S, low)

`errors.ts` has no `PAYMENT_REQUIRED` and no generic upstream-error code.
Confirmed bare sites: `requests.ts:342,415,496`; `organizations.ts:244,438`
(both HTTP 402). Note: `anomalies.ts` is already compliant (it throws
`ApiError` at `:171`); no change there.

- Files: `apps/server/src/lib/errors.ts:27-91`, `api/requests.ts`, `api/organizations.ts`.
- Change: add `PAYMENT_REQUIRED` (402) and an upstream-error code. Convert both 402 sites in `organizations.ts` and the truncated-body sites in `requests.ts` to `ApiError`, preserving the details payloads. The `requests.ts:496` dynamic-status passthrough is either documented as intentional or wrapped.

Success criteria:

- [x] `ERROR_CODES` contains `PAYMENT_REQUIRED` (402) and `BODY_NOT_REPLAYABLE` (422); mirrored in `@spanlens/api-types` KnownApiErrorCode + the contract test + docs/api/errors page.
- [x] `organizations.ts` has zero bare `c.json({error})`; both 402 paths use `ApiError('PAYMENT_REQUIRED', ...)` and keep their details (plan/upgrade_url, reason/owned/limit/effectivePlan).
- [x] `requests.ts` truncated-body sites (342, 415) use `ApiError('BODY_NOT_REPLAYABLE')`; the 496 upstream passthrough left as-is (intentional legacy shape, documented in source).
- [x] ErrorCode union compiles; errors.contract + errors-docs-sync tests green. Also hardened web `lib/api.ts` to read `error.message` from the ApiError envelope (was reading `error` as a string → would show "[object Object]"; latent bug for all ApiError endpoints).

### 4.4 Promote validation helpers to `lib/validation-helpers.ts` (S, low)

`scoreConfigs.ts:42-55` has three private `normalise*` coercion helpers useful
at any boundary. No Zod (a schema library is a separate, larger decision).

- Files: `apps/server/src/api/scoreConfigs.ts:42-55`, `apps/server/src/lib/validation-helpers.ts` (NEW).
- Change: move the three helpers verbatim (explicit return types), re-import in `scoreConfigs.ts`. Migrate other boundary files opportunistically.

Success criteria:

- [x] `lib/validation-helpers.ts` exports the 3 helpers with explicit return types.
- [x] `scoreConfigs.ts` imports them, no local copies.
- [x] No new package added.

### 4.5 Extract `settings-client.tsx` (2464 lines) (M, low)

Already partitioned into ~25 named tab components dispatched by `TabContent`.

- Files: `apps/web/app/(dashboard)/settings/settings-client.tsx`.
- Change: `_components/` for shared primitives (NativeInput, Toggle, MonoPill, Hint, TabHeader, CopyButton) and `_tabs/` one file per tab (general, members, security, system, billing, profile, notifications, webhooks, integrations, destinations). Keep `SettingsClient` + `TabContent` in the entry file. Preserve `'use client'` and hydration-safe helpers.

Success criteria:

- [ ] `settings-client.tsx` <= ~300 lines (dispatcher + shell).
- [ ] Each extracted tab under ~400 lines.
- [ ] Web typecheck + lint pass.
- [ ] All tabs render with no hydration regression (manual smoke).

### 4.6 Extract `evals-client.tsx` (2390 lines) (M, low)

- Files: `apps/web/app/(dashboard)/evals/evals-client.tsx`.
- Change: `_components/` with `new-evaluator-dialog.tsx` (157-968), `run-evaluator-dialog.tsx` (969-1378), `run-detail-panel.tsx`, `evaluator-row.tsx`, `correlation-card.tsx`, `runs-view.tsx`, `status-badge.tsx`. `EvalsClient` stays in the entry file.

Success criteria:

- [ ] `evals-client.tsx` <= ~500 lines.
- [ ] Both dialogs isolated into single-responsibility files.
- [ ] Web typecheck + lint pass.
- [ ] Create evaluator, run evaluator, run-detail flows work (manual smoke).

### 4.7 Extract `requests-client.tsx` (1704 lines) (M, low)

- Files: `apps/web/app/(dashboard)/requests/requests-client.tsx`.
- Change: `_lib/format.ts` (pure helpers), `stat-strip.tsx`, `traffic-bars.tsx` (wrap recharts in `dynamic({ ssr: false })`, gotcha #22), `request-drawer.tsx`, `requests-table.tsx`. Hoist the duplicated `CopyButton` into `apps/web/components` (shared with settings).

Success criteria:

- [ ] `requests-client.tsx` <= ~500 lines.
- [ ] TrafficBars guarded against SSR hydration mismatch.
- [ ] `CopyButton` defined once, reused by requests and settings.
- [ ] Web typecheck + lint pass; list/filters/drawer/chart work (manual smoke).

### Phase 4 exit checklist

- [x] 4.3, 4.4 merged (#373).
- [~] 4.1, 4.2 implemented (sub-PR B): judge transport / generate / pool extracted, pool deduped. Deep runEvalRun split + experiment-runner judge-logic dedup deferred (risk / behavior change).
- [ ] 4.5 through 4.7 merged (web extractions).
- [ ] No file over 800 lines among the targets (eval-runner still 1251 pending the deferred split); full `pnpm typecheck && lint` green.

---

## Phase 5: Test coverage

Goal: cover the high-value untested modules. 5.1 first (customer-facing
verdicts, pure functions, lowest effort). The experiment-runner part of 5.2 is
easier after the 4.2 dedup makes its dependencies mockable.

### 5.1 Test `prompt-experiment-stats.ts` (M, low) HIGHEST VALUE

114 lines of significance math (`errorRateTest` two-proportion z-test,
`welchTest` Welch t-test, `normalCdf`, `tPValue`) with zero tests, feeding the
customer-visible A/B winner verdict at `prompt-experiments.ts:245-272`. A wrong
p-value silently mislabels a winner.

- Files: `apps/server/src/lib/prompt-experiment-stats.ts:18-114`, `apps/server/src/lib/__tests__/prompt-experiment-stats.test.ts` (NEW).
- Change: cover both functions across insufficient-sample, significant,
  not-significant, zero-variance, and `relativeLift`-null branches. Validate at
  least two p-values against an external reference (R/SciPy) within ~1e-3.

Success criteria:

- [ ] >= 12 cases covering both functions' branches.
- [ ] >= 2 p-value assertions checked against an external reference within documented tolerance.
- [ ] Line + branch coverage >= 90%.
- [ ] Server test green.

### 5.2 Test `experiment-runner.ts`, `admin-emails.ts`, `stats-queries.ts` (M, low)

- Files: `apps/server/src/lib/experiment-runner.ts`, `admin-emails.ts:14-40`, `stats-queries.ts`.
- Change:
  - `admin-emails` (do first): empty array when no admins, opted-out admin excluded, no-prefs-row admin included, missing-address skipped.
  - `stats-queries`: table-test each builder for org-isolation filter presence and `Number()` coercion (gotcha #19), no `ilike` (gotcha #20), DateTime handling.
  - `experiment-runner` (after 4.2): aggregate math, `bothErrored` span status, no-items / missing-key error paths.

Success criteria:

- [ ] `admin-emails.ts`: opt-out + missing-email + no-admin branches, >= 90% coverage.
- [ ] `stats-queries.ts`: each builder asserts org filter + numeric coercion; key builders >= 80%.
- [ ] `experiment-runner.ts`: aggregate math + error paths covered after shared imports are mockable.
- [ ] All new tests pass.

### Phase 5 exit checklist

- [ ] 5.1 merged first.
- [ ] 5.2 merged (experiment-runner part after 4.2).
- [ ] Coverage report shows the four modules above their targets.

---

## Branch note: `feat/judge-prompt-caching`

The current branch (Anthropic prompt caching for the LLM judge) is mergeable.
Split logic and cost accounting are correct. Two caveats to record, not blockers:

- Caching only helps when the judge system prefix exceeds the per-model minimum
  (1024 tokens for Sonnet/Opus, 2048 for Haiku) and rows in the same run land
  within the 5-minute TTL. Short judge prompts see little or no saving (the code
  correctly treats this as safe, since the API ignores `cache_control` below the
  minimum).
- The caching test asserts the request body shape but not the response usage
  (`cache_read_input_tokens`), so it does not prove a live cache hit. A
  follow-up integration assertion on usage would close that gap.

(Note: an early review flagged a missing `anthropic-beta` header as a blocker.
That is not required for the GA models used as judges; `cache_control` is
honored without it.)
```
