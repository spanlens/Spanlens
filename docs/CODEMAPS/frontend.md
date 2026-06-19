<!-- Generated: 2026-06-19 | Source: apps/web/{app,components} -->

# Frontend Codemap (apps/web)

## Framework

- Next.js 16.2.7 (App Router) + React 19
- TanStack Query 5 for client-side data
- Tailwind v4 + Radix UI primitives
- next-themes alternative: in-repo `components/providers/theme-provider.tsx` (script-tag-warning safe)
- Recharts (charts) — wrap with `dynamic({ssr:false})` to avoid hydration mismatch (gotcha #22-D)

## App route tree

```
app/
├─ (dashboard)/         — auth-gated, sidebar layout (org-scoped via sb-ws cookie)
│   ├─ dashboard        — overview + 3 breakdown charts (PR #324)
│   ├─ requests         — request log + saved filters
│   ├─ traces           — agent traces (Gantt + critical path + xyflow graph)
│   ├─ users            — per-end-user analytics
│   ├─ sessions
│   ├─ savings          — model-swap recommendations
│   ├─ anomalies
│   ├─ security         — PII + prompt injection log
│   ├─ alerts
│   ├─ prompts          — versioning + playground + A/B + experiments
│   ├─ datasets
│   ├─ evals            — judge results + CIs + agreement κ/r
│   ├─ webhooks
│   ├─ projects         — project + public-key management
│   ├─ provider-keys
│   ├─ billing
│   └─ settings/...     — org, members, audit-log, profile, notification-prefs
├─ auth, login, signup, onboarding, forgot/reset-password, verify-email
├─ invite/[token]       — invitation accept
├─ share/[token]        — PLG Loop ① public viewer (server-side, rate-limited)
├─ docs/                — public docs (quick-start, sdk, proxy, integrations[10], concepts[5], features[24], cli, otel, self-host, production, tutorials, migrate, why, api)
├─ integrations/{openai,anthropic,gemini}    — SEO landing pages
├─ alternatives/        — competitor compare pages
├─ compare/             — head-to-head SEO pages
├─ tools/cost-calculator
├─ feedback             — public roadmap (R-32)
├─ pricing, faq, about, changelog, llm-cost-tracking, llm-observability, agent-tracing, self-hosting
├─ privacy, terms, dpa, subprocessors, refund
├─ demo/                — marketing demos (DemoClientGuard SSR-skip wrapper, gotcha #22-F)
├─ error.tsx, global-error.tsx — ErrorBoundary (PR #339)
├─ robots.ts, sitemap.ts
└─ page.tsx             — marketing home
```

## Component tree (top-level)

```
components/
├─ dashboard/           — charts, tables, filter UI
├─ layout/              — sidebar, header, command-palette
├─ landing/             — marketing hero, feature blocks
├─ marketing/           — pricing tables, compare blocks
├─ traces/              — Gantt, xyflow graph adapters
├─ audit-logs/
├─ channels/            — Slack/Discord/Email channel forms
├─ charts/              — Recharts wrappers (dynamic-ssr)
├─ share/               — public share renderers
├─ providers/           — ThemeProvider + QueryProvider
├─ error-boundary.tsx   — per-panel <ErrorBoundary> (PR #339)
├─ command-palette.tsx + command-palette-dialog.tsx
├─ permission-gate.tsx  — RBAC client gate
└─ ui/                  — shadcn/Radix primitives
```

## Data flow

```
'use client' component
   │ useQuery(['key'], fetchFn)
   ▼
fetch('/api/v1/...', { headers: { Authorization: `Bearer ${supabaseJwt}` } })
   │
   ▼
apps/server REST → ClickHouse / Supabase
```

Mutations: `useMutation` + invalidate `['key']`. Optimistic updates only on lightweight UI state (e.g. saved-filter rename).

## Auth

- Supabase SSR helper (`@supabase/ssr`) reads JWT from cookies in `app/layout.tsx` server component
- `middleware.ts` resolves active workspace via `sb-ws` cookie (hard-reload pattern — see CLAUDE.md gotcha #15)
- Onboarding redirect: `middleware.ts` checks `onboarded_at`; navigation MUST use `window.location.href` not `router.push` (gotcha #15)

## Hydration-safe helpers

- `lib/utils.ts` — `formatDate/formatDateTime/formatTime` (locale-explicit, gotcha #22-A)
- `lib/hydration-safe-now.ts` — `useHydrationSafeNow()` (useSyncExternalStore + module cache, gotcha #22-B/C)
- `lib/legal-versions.ts` — version constants for Privacy Policy, ToS, DPA (bumped whenever legal docs are revised; signup reads these to write `user_consents` rows)
- `app/demo/_client-guard.tsx` — `DemoClientGuard` SSR-skip last-resort wrapper (gotcha #22-F, demo/* only — never SEO pages)

## Tests

- Vitest + Testing Library (`apps/web/__tests__` + colocated)
- Playwright E2E (`apps/web/e2e/`)
