## Summary

<!-- Briefly describe what's changing and why. The diff shows what — explain
     why. One paragraph is usually enough; add a "Test plan" or
     "Out of scope" section below if the change is non-trivial. -->

## Test plan

<!-- Bullet checklist of how this was verified, or how a reviewer can verify.
     Local commands, smoke-test steps, the specific edge case the new tests
     exercise. -->

## Checklist

> See [CONTRIBUTING.md](../CONTRIBUTING.md) and [.github/COMMIT_CONVENTION.md](./COMMIT_CONVENTION.md) for full guidance.

### Conventions

- [ ] PR title follows Conventional Commits (`type(scope): subject`)
- [ ] PR description and commits are in English
- [ ] Code comments are in English (translating legacy Korean comments in
      touched files is welcome but not required)

### Code safety

- [ ] ClickHouse queries: no direct `getClickhouse()` calls outside
      `apps/server/src/lib/` — go through `requestsScope` / `selectRequests` /
      `countRequests`.
- [ ] New ClickHouse queries: `organization_id` filter present.
- [ ] New Supabase tables: `ALTER TABLE t ENABLE ROW LEVEL SECURITY` included.
- [ ] New `/proxy/*` endpoints: `authApiKey` middleware applied.
- [ ] New `/api/*` endpoints: `authJwt` middleware applied.
- [ ] New ClickHouse INSERTs: `toClickhouseTimestamp()` used (no raw
      `.toISOString()` — it appends `Z` which ClickHouse rejects).
- [ ] New `lib/crypto.ts` calls: `await` not missed (all functions return
      `Promise<string>`).
- [ ] Vercel Edge fire-and-forget: `fireAndForget(c, promise)` used — never
      `.catch(console.error)` alone (Edge will drop the pending promise).
- [ ] New environment variables: `.env.example` updated.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally.

### Security (when applicable)

- [ ] No secrets leaked — logs, error messages, and test fixtures contain no
      real API keys, tokens, or passwords.
- [ ] Provider key handling: plaintext used only in the immediate
      `Authorization` header — never stored in a variable for reuse or logged.
- [ ] User input validated at API boundary with a schema (`zod`) or explicit
      type guard.
- [ ] Auth-bypass risk reviewed: new routes either go through `authApiKey` /
      `authJwt` or are intentionally public endpoints with a documented reason.
- [ ] SQL / NoSQL injection: parametrized queries only (`query_params` for
      ClickHouse, Supabase query builder for Postgres) — no string concat for
      identifiers or values.
- [ ] External `fetch()` with user-derived URL: host allowlist enforced
      (SSRF defense).
- [ ] No `console.log` of keys, secrets, or tokens.
- [ ] New dependencies: license (MIT / Apache / BSD) verified, plus either
      10M+ download history OR a manual audit.
- [ ] CodeQL / Dependabot alerts: zero findings (or explicit dismissal note).
