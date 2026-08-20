# Contributing to Spanlens

Spanlens is an open-source LLM observability platform. We welcome bug fixes,
new integrations, and improvements from the community. This guide covers how
the project is structured, what we look for in a PR, and the conventions that
keep the codebase navigable as it grows.

---

## TL;DR

1. Fork → branch (`feat/`, `fix/`, `docs/`, …) → commit → PR.
2. Commits and PR descriptions are in **English**.
3. Code comments are in **English** (legacy Korean comments are translated
   incrementally as files are touched, so don't feel obligated to translate
   a whole file in a drive-by fix).
4. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before pushing.
5. Open a PR against `main`. The template asks for a short summary and a
   safety checklist.

---

## Project layout

```
apps/
  server/        Hono REST + LLM proxy (Vercel Node runtime)
  web/           Next.js dashboard
packages/
  sdk/           TypeScript SDK (npm: @spanlens/sdk)
  sdk-python/    Python SDK (PyPI: spanlens)
  cli/           Setup wizard (npm: @spanlens/cli)
  mcp-server/    MCP server (npm: @spanlens/mcp-server), 7 tools for Cursor/Claude Desktop
  api-types/     Shared types between web ↔ server (workspace internal)
  eslint-plugin/ ESLint rules for error-envelope lint (workspace internal)
supabase/        Migrations + seeds for the whole schema, request log included
docs/            Architecture notes, runbooks, RFCs
```

Dependency direction (do not violate):

- `apps/web → apps/server` (via fetch only, never by importing server code).
- `apps/server → supabase`.
- `packages/sdk → external packages only` (never import from `apps/`).

---

## Running locally

You need Node ≥ 20, pnpm ≥ 10, and Docker (Supabase runs in containers
locally). All three are installable via [`mise`](https://mise.jdx.dev/) or
`brew`.

```bash
# One-time setup
supabase start          # local Supabase
cp apps/server/.env.example apps/server/.env  # fill in the values

# Install + start dev servers
pnpm install
pnpm exec lefthook install   # pre-commit guards for supabase migrations
pnpm dev                # web :3000, server :3001

# Apply migrations
supabase db push
```

Smaller scopes:

| Change touches | Minimum verification |
|----------------|----------------------|
| `apps/web` | `pnpm --filter web typecheck && pnpm --filter web lint` |
| `apps/server` | `pnpm --filter server typecheck && pnpm --filter server lint && pnpm --filter server test` |
| `packages/sdk` | `pnpm --filter sdk build && pnpm --filter sdk typecheck` |
| `packages/sdk-python` | `pytest packages/sdk-python/tests/` |
| `supabase/migrations` | `supabase db push && supabase gen types` |
| Cross-package | `pnpm typecheck && pnpm lint && pnpm test` |

---

## Coding conventions

### Language

- **Code comments**: English.
- **Commit messages**: English. See [`.github/COMMIT_CONVENTION.md`](./.github/COMMIT_CONVENTION.md).
- **PR descriptions**: English.
- **CLAUDE.md**: Korean is OK, since it's a private memo for the maintainer's
  AI pair-programmer rather than a public-facing artifact.
- **Customer-facing copy** (`apps/web` UI, marketing site, Privacy/Terms/DPA,
  emails): English.

### Style

- TypeScript projects: format-on-save with the in-repo ESLint config. Two
  spaces, single quotes, no semicolons at the end of lines.
- Python SDK: `black` + `ruff`. PEP 8.
- Filenames in `apps/server/src/`: kebab-case (`fallback-replay.ts`).
- Components in `apps/web/`: PascalCase (`AnomaliesClient`).

### Tests

- New code that affects request handling, billing, security, or cron jobs
  needs unit-test coverage.
- Vitest for TypeScript, pytest for Python.
- A test that asserts the failure mode of a bug fix is worth more than three
  green tests asserting the happy path.

### Migrations

- Migrations live in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`.
  Once applied to production they're immutable, so follow-up changes go in a
  new file.
- Write them idempotently (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
  EXISTS`). A migration can be re-run against a database that already has
  half of it.
- Always run `supabase gen types` after a Postgres migration so
  `supabase/types.ts` stays in sync. Pipe stderr to `/dev/null`, because the
  CLI leaks warning lines onto stdout that break `tsc` if they land in the
  file:
  ```
  supabase gen types --lang typescript --local 2>/dev/null > supabase/types.ts
  ```
- These conventions are enforced locally by [`lefthook`](./lefthook.yml).
  Run `pnpm exec lefthook install` once per clone to wire up the
  `pre-commit` guards (rejects edits to merged migrations, rejects
  off-pattern filenames, warns when `supabase/types.ts` changes without a
  paired migration).

---

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) with the
project-specific scopes documented in
[`.github/COMMIT_CONVENTION.md`](./.github/COMMIT_CONVENTION.md). Example:

```
feat(proxy): graceful stream deadline + truncated flag

Before: streams that ran longer than Vercel's 300s ceiling got hard-killed
mid-pump, with no log row and the customer billed for tokens that never
reached the dashboard.

After: 290s soft deadline. On expiry we cancel the upstream reader, exit
the pump, log the row with `truncated: true`. Dashboard surfaces this
with a badge.

Co-Authored-By: <name> <email>
```

The body explains **why**, not what. The diff already shows what.

---

## Opening a pull request

1. Branch naming: `feat/<short-slug>`, `fix/<short-slug>`, `docs/<short-slug>`,
   `chore/<short-slug>`, `refactor/<short-slug>`.
2. Keep PRs focused: one logical change per PR. Refactors and feature work
   land in separate PRs even when they touch the same files.
3. Fill out the PR template safety checklist honestly. It exists because
   security and correctness regressions are easier to catch in review than
   in production.
4. Link the issue (`Closes #123`) when applicable.
5. CI runs typecheck, lint, tests, and CodeQL. All four must pass before merge.
6. Squash-merge is the default. Conventional Commit title in, single commit on
   `main` out.

### Before merging

- All CI checks green (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`).
- Test plan filled in (the template has a "Test plan" section).
- New environment variables documented in `.env.example` and, if needed, in
  `CLAUDE.md`.

---

## Security disclosures

Found a vulnerability? **Please don't open a public issue.** Email
`support@spanlens.io` with the details. We
respond within one business day. See [SECURITY.md](./SECURITY.md) for the
full policy.

---

## Project decisions

Published design docs live in `docs/plans/`. `postgres-migration.md` covers
where the request log is stored and why; `clickhouse-migration.md` is the
earlier round trip, kept because the reasoning still explains the shape of
the table. Read them before proposing a structural change to the data layer so
we don't talk past each other. Roadmap and launch planning are kept private;
open an issue if a decision is unclear and we'll explain the reasoning there.

Operational gotchas, the surprises someone hit in production that future
contributors should know about, live in `CLAUDE.md` (the file is named for
the maintainer's AI assistant but the content is useful to any contributor
who can read Korean).

---

## License

By contributing you agree that your contribution will be licensed under the
[MIT License](./LICENSE), the same as the rest of the project.

---

## Thanks

Maintained by [@sunes26](https://github.com/sunes26). Issues and PRs are
reviewed in the order they arrive; expect a response within a few business
days.
