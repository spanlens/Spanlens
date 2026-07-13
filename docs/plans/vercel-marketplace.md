# Vercel Integrations Marketplace listing — plan

Goal: list Spanlens on the Vercel Integrations Marketplace under the
Observability category. The LLM observability slot is effectively
vacant on Vercel (most LLM observability competitors unlisted;
Braintrust is the nearest peer), so this is a one-shot land-grab
opportunity.

This is intentionally a multi-day, multi-phase workstream. Phase 0
proves nothing more than "we can submit". The real cost sits in
Phase 1 (OAuth provider).

---

## Phase 0 — submit application + asset inventory (this PR)

Outcome: Vercel review queue triggered. No code shipped, no public
listing yet.

### Actions on Spanlens side

1. Confirm the Spanlens Vercel team is on the **Pro plan** (free
   teams cannot submit a Marketplace application). If still on free,
   upgrade.
2. Submit the Marketplace Program form at
   <https://vercel.com/marketplace/program> with the values in the
   "form payload" section below. Vercel responds out-of-band by email
   and opens the Integrations Console for the team.

### Form payload (verbatim values to paste)

| Field | Value |
| --- | --- |
| Company name | Spanlens |
| Website | <https://www.spanlens.io> |
| Contact email | hi@spanlens.io |
| Integration category | Observability |
| Short pitch (1 line) | Open-source LLM observability and cost tracking with a one-line proxy swap. |
| Long pitch | Spanlens is an MIT-licensed observability platform purpose-built for LLM applications. Drop-in proxy captures every OpenAI / Anthropic / Gemini call with full request bodies, token counts, computed cost, and parent / child agent traces. Self-hostable via Docker, SaaS at spanlens.io. |
| What we want from Marketplace | Distribute Spanlens to Next.js teams that build AI apps on Vercel. Vercel users get end-to-end LLM observability, cost guardrails, and prompt versioning with no code changes beyond a base URL swap. |

The form is a lightweight initial-contact form, not the final
listing — Vercel just routes it to their partnerships team and they
follow up. There is no public SLA for the response.

---

## Phase 1 — build the missing pieces (separate sprint, 5–8 days)

The Integrations Console will not let us publish until these exist.

### A. OAuth 2.0 provider (largest single piece, ~3–5 days)

Vercel's Connectable Account flow requires a real OAuth provider on
our side. We currently expose only `sl_live_*` API keys with no OAuth
endpoints. Need to build:

- `GET /oauth/authorize` — popup login + workspace picker, issues
  short-lived authorization code keyed to the chosen project.
- `POST /oauth/token` — exchanges code for a long-lived access token.
  Persist as a new `api_keys` row (scope `full`, project-scoped),
  tag with `metadata.source = 'vercel_oauth'` so we can revoke
  per-source if needed.
- `POST /oauth/revoke` — optional but expected; deletes the linked
  key.
- Response shape: standard RFC 6749 — `access_token`, `token_type`,
  `expires_in`, `refresh_token` (optional).
- Vercel-specific: set `Cross-Origin-Opener-Policy: unsafe-none` on
  the popup pages so Vercel's wrapping window can detect close.

Security gotchas:

- Authorization code must be single-use, ≤10 min TTL, bound to the
  redirect_uri sent at /authorize time.
- The issued token IS a Spanlens API key under the hood — masked in
  logs by the existing `lib/pii-mask.ts` `sl_live_*` matcher.
- New rows under the existing `api_keys` table — no schema migration
  needed beyond a `source` metadata field (jsonb already there).

### B. EULA page (~half day)

Vercel approval checklist requires an EULA URL distinct from ToS and
Privacy. Cheapest path: new `apps/web/app/eula/page.tsx` that wraps
the existing Terms with the canonical Vercel-style EULA preamble
("This End User License Agreement governs your use of...").

Path: `/eula`. Add to footer + put the URL in the form.

### C. Asset production (~half day)

| Asset | Spec | Source |
| --- | --- | --- |
| Logo light | 1:1, ≥256×256, PNG, non-transparent, light bg | Crop from `apps/web/app/icon.png` over white |
| Logo dark | 1:1, ≥256×256, PNG, non-transparent, dark bg | Same icon over `bg-bg` (#0a0a0a) |
| favicon.ico | 32×32 | Convert icon.png |
| Feature media 1 | 3:2, 1440×960 PNG | Dashboard overview (Traces page in dark mode) |
| Feature media 2 | 3:2, 1440×960 PNG | Single trace waterfall view |
| Feature media 3 | 3:2, 1440×960 PNG | Cost / savings page |
| Feature media 4 (optional) | 3:2, 1440×960 PNG | Anomalies + alerts |
| Feature media 5 (optional) | 3:2, 1440×960 PNG | Prompt A/B comparison |

20% safe zone around the edges (Vercel can crop). Keep them visually
on-brand but text should still read at 50% scale (thumbnail size on
the marketplace grid).

### D. Integration Console form (~1 hour, last)

Fields verified from
<https://vercel.com/docs/integrations/create-integration/submit-integration>:

| Field | Limit | Spanlens value |
| --- | --- | --- |
| Name | 64 chars | Spanlens |
| URL slug | 32 chars | spanlens |
| Short description | **40 chars** | LLM observability for AI apps |
| Overview | 768 chars, markdown | (draft below) |
| Additional info | 1024 chars | Self-host with Docker, SaaS at spanlens.io. SDKs for JS / Python. OpenTelemetry + MCP supported. |
| Website / Docs / EULA / Privacy / Support URLs | — | spanlens.io, /docs, /eula, /privacy, mailto:hi@spanlens.io |
| Redirect URL | OAuth callback | `https://api.spanlens.io/oauth/callback/vercel` |
| Logo / Feature media | — | (Phase 1.C) |

Overview draft (under 768 chars):

> Spanlens is open-source LLM observability built for production AI
> apps on Vercel. One environment variable swap routes your OpenAI,
> Anthropic, or Gemini calls through the Spanlens proxy — you get
> request-level logs, accurate token usage and cost, agent trace
> waterfalls, prompt A/B testing, and cost anomaly alerts with zero
> code changes.
>
> Free tier covers 100k requests per month with 14-day retention. Pro
> raises the cap and adds 90-day retention, savings recommendations,
> and team workspace features. Everything is MIT licensed and
> self-hostable via Docker if you prefer to own the data plane.

---

## Phase 2 — submit + iterate (post-Phase 1)

1. Submit via Integrations Console. Vercel reviews and returns
   feedback or grants a "Community" badge — the integration is live
   for direct installs but absent from the marketplace homepage.
2. Drive installs externally (docs link, launch post, X posts) until
   we hit **500 active installations**.
3. Email `integrations@vercel.com` to request a full marketplace
   listing review. After their pass, the integration appears in the
   Observability category grid.

---

## Risks / open questions

- **Pro plan cost.** If we are not yet on Pro, listing requires the
  upgrade. Verify before submitting the form.
- **EULA vs ToS clarity.** Some partners pass review with only ToS
  containing an EULA clause; some are asked for a separate document.
  Cheapest first attempt is the separate `/eula` page.
- **500-install gate.** Not enforced for "Community" installs, but
  the marketplace homepage placement that drives discovery does
  require it. Plan a separate launch loop for activation.
- **Native vs Connectable.** Native Integration would let Vercel
  handle billing (uses their marketplace pricing surface), but we
  already run Paddle. Connectable Account keeps billing on our side
  and is the recommended path for our current architecture.

---

## Status

- 2026-06-05: Plan written. Form payload drafted. Asset inventory
  done.
- 2026-06-05: **Deferred.** Public launch hit zero hosted sign-ups
  by the time we walked through the Marketplace Program form. Filing
  partner contact at zero traction risks (a) a soft reject we cannot
  un-file and (b) an early bad impression that lingers in partnerships
  team notes when we resubmit later. Phase 1 cost (~5 days of OAuth
  build) has no ROI without users to convert through the listing.

### Resume conditions

Restart this workstream when any of the following is true:

- At least the low hundreds of monthly active hosted users (any
  scope: free + paid), with weekly week-over-week growth.
- A clear public reason to launch on Vercel specifically (e.g. a
  Next.js-shaped customer asking for the install button, or an
  internal Vercel contact opening the door).
- A specific dated launch loop ready to ride the listing (paid
  campaign + content + X thread) so the listing landing has a
  burst of installs rather than zero.

Until one of these holds, leave this plan alone. Form submission is
worth more once we have something to show on the traction question.
