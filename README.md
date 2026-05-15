# Spanlens

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm version](https://img.shields.io/npm/v/@spanlens/sdk.svg)](https://www.npmjs.com/package/@spanlens/sdk)
[![PyPI version](https://img.shields.io/pypi/v/spanlens.svg)](https://pypi.org/project/spanlens/)
[![npm downloads](https://img.shields.io/npm/dm/@spanlens/sdk.svg)](https://www.npmjs.com/package/@spanlens/sdk)

LLM observability that gets out of your way. Record every OpenAI / Anthropic / Gemini call — cost, latency, tokens, full request/response — then surface anomalies, PII, and model-swap suggestions automatically. Available for **TypeScript** and **Python**.

> **Hosted**: [spanlens.io](https://www.spanlens.io) · **npm**: [`@spanlens/sdk`](https://www.npmjs.com/package/@spanlens/sdk) · **PyPI**: [`spanlens`](https://pypi.org/project/spanlens/) · **CLI**: [`@spanlens/cli`](https://www.npmjs.com/package/@spanlens/cli) · **Open source (MIT)** · **Self-hostable** (Docker)

---

## ⚡ Quick start — 30 seconds

### TypeScript / JavaScript (Next.js)

```bash
npx @spanlens/cli init
```

The wizard:

1. Installs `@spanlens/sdk` with your package manager (npm / pnpm / yarn / bun)
2. Writes `SPANLENS_API_KEY` to `.env.local`
3. Rewrites every `new OpenAI({ apiKey, baseURL })` into `createOpenAI()`

Paste your Spanlens API key once, confirm two prompts, done. Your LLM calls are now flowing through the Spanlens proxy — visible in [www.spanlens.io/requests](https://www.spanlens.io/requests).

#### Manual TypeScript setup

```ts
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI()  // reads SPANLENS_API_KEY, uses Spanlens proxy baseURL
```

### Python

```bash
pip install "spanlens[openai]"
```

```python
from spanlens.integrations.openai import create_openai

client = create_openai()  # reads SPANLENS_API_KEY from env
res = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
```

Same proxy, same dashboard. For agent tracing in Python (multi-step, async, tool calls) see the [Python SDK README](./packages/sdk-python/README.md) and [`/docs/sdk`](https://www.spanlens.io/docs/sdk).

---

## What you get

| Feature | Description |
|---|---|
| **Request log** | Every LLM call — model, tokens, cost, latency, request/response body (streaming responses reconstructed too) |
| **Agent tracing** | Multi-step workflows as Gantt/waterfall span trees |
| **Cost tracking** | Per-request cost breakdown with prompt-cache pricing (Anthropic / OpenAI cache hits billed at their reduced rate), daily rollups, budget alerts |
| **Per-end-user analytics** | Tag calls with `x-spanlens-user` (SDK: `withUser()` / `with_user()`) → /users page shows per-user cost, tokens, errors, models, last seen |
| **Anomaly detection** | 3σ deviations in latency, cost, or error rate vs. your 7-day baseline — with root-cause hints (token delta, HTTP status breakdown) |
| **PII + prompt-injection scan** | Regex-based detection on request **and response** bodies; optional per-project blocking (422) for injections; instant alert emails to workspace owner |
| **Model recommendations** | "Your gpt-4o calls look like classification — try gpt-4o-mini" with estimated monthly savings |
| **Prompt versioning + A/B** | Register prompt templates, run traffic-split experiments, compare versions side by side (latency / cost / error rate) |
| **Prompts Playground** | Execute any prompt version with variable injection directly in the dashboard — see real cost and response before shipping |
| **Evals & Experiments** | Build LLM-as-judge evaluators, create datasets, and run A/B experiments comparing two prompt versions; human annotation queue also included |
| **Data export** | Download request logs as CSV or JSON (`GET /api/v1/exports/requests?format=csv`) for offline analysis or BI tooling |

---

## Team & workspaces

Spanlens is multi-user out of the box — invite teammates, hand out roles,
spin up a separate workspace per client.

- **Roles** — `admin` (members + billing), `editor` (data + settings), `viewer`
  (read-only). Last admin is protected against demotion / removal.
- **Email invitations** — 7-day expiry, sha256-hashed tokens. Sent via
  [Resend](https://resend.com) when `RESEND_API_KEY` is set; falls back to
  console-logging the accept URL for local dev.
- **Pending-invitation banner** — surfaces unaccepted invites at the top of
  the dashboard, even if the recipient never opened the email. Accept joins
  + auto-switches active workspace; Decline removes the row.
- **Multi-workspace** — switch between workspaces from the sidebar
  (`sb-ws` cookie + hard reload so middleware re-resolves scope). Useful
  for consultants juggling multiple clients or one team running prod /
  staging as separate workspaces.
- **Two-step onboarding** — new signups land on `/onboarding`: name your
  workspace, answer two optional survey questions, done. Invitees get a
  short-circuited variant where Accept skips workspace creation entirely.
- **Audit log** — Settings → Audit log records every membership / role /
  invitation event with actor + timestamp.

---

## Monorepo structure

```
Spanlens/
├── apps/
│   ├── web/             — Next.js 14 dashboard (www.spanlens.io)
│   └── server/          — Hono LLM proxy + REST API (spanlens-server.vercel.app)
├── packages/
│   ├── sdk/             — @spanlens/sdk:  TypeScript / JavaScript SDK
│   ├── sdk-python/      — spanlens (PyPI): Python SDK
│   └── cli/             — @spanlens/cli:  npx wizard for 1-command setup
└── supabase/
    ├── migrations/      — Postgres schema (14 tables, RLS-gated)
    └── seeds/           — model_prices.sql etc.
```

- **[apps/web](./apps/web)** — React dashboard. Deployed to Vercel.
- **[apps/server](./apps/server)** — Edge runtime proxy on Vercel. Routes `/proxy/openai/*`, `/proxy/anthropic/*`, `/proxy/gemini/*`. REST API on `/api/v1/*`.
- **[packages/sdk](./packages/sdk)** — TypeScript SDK (`@spanlens/sdk`). Helpers + tracing primitives. See its [README](./packages/sdk/README.md).
- **[packages/sdk-python](./packages/sdk-python)** — Python SDK (`spanlens`). Same primitives, Pythonic API (context managers, sync + async). See its [README](./packages/sdk-python/README.md).
- **[packages/cli](./packages/cli)** — Wizard (`@spanlens/cli`). See its [README](./packages/cli/README.md).

---

## Local development

Prerequisites: Node 20+, pnpm 10.33.0+, Docker (for local Supabase), [Vercel CLI](https://vercel.com/docs/cli) optional.

```bash
# 1. Clone + install
git clone https://github.com/sunes26/Spanlens.git
cd Spanlens
pnpm install

# 2. Start local Supabase (requires Docker)
supabase start
supabase db push        # apply migrations
supabase gen types --lang typescript --local > supabase/types.ts

# 3. Env vars — see apps/server/.env.example
cp apps/server/.env.example apps/server/.env

# 4. Run everything (web on :3000, server on :3001)
pnpm dev
```

### Running tests + lint

```bash
pnpm typecheck          # TS across all packages
pnpm lint               # ESLint
pnpm test               # Vitest — server + sdk + cli suites
pnpm build              # production build smoke test
```

See [CLAUDE.md](./CLAUDE.md) for architecture rules and Known Gotchas (streaming, RLS, Paddle billing, Vercel Edge runtime, npm publish).

---

## Self-hosting

The easiest way to self-host is with the included `docker-compose.yml` — it runs both the **dashboard (web)** and the **proxy/API server** together.

### 1. Create a `.env` file

```bash
# Supabase (cloud or self-hosted)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Encryption key — generate with: openssl rand -base64 32
ENCRYPTION_KEY=<32-byte base64>

# Random secret for cron endpoint
CRON_SECRET=<random string>

# Optional — for invite emails
# WEB_URL=https://your-domain.com
# RESEND_API_KEY=re_...
# RESEND_FROM=Spanlens <no-reply@your-domain.com>
```

### 2. Build and start

```bash
docker compose up -d --build
```

- Dashboard: `http://localhost:3000`
- API / proxy: `http://localhost:3001`

The web container passes `NEXT_PUBLIC_*` vars as **build arguments** (Next.js bakes them into the client bundle), so they must be present before `docker compose build`.

### Server-only (no dashboard)

If you only need the proxy/API and run the dashboard separately:

```bash
docker pull ghcr.io/sunes26/spanlens-server:latest
docker run -p 3001:3001 \
  -e SUPABASE_URL=... \
  -e SUPABASE_ANON_KEY=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e ENCRYPTION_KEY=... \
  ghcr.io/sunes26/spanlens-server:latest
```

### Point your SDK at your self-hosted URL

```ts
const openai = createOpenAI({
  baseURL: 'https://your-spanlens.example.com/proxy/openai/v1',
})
```

Your Spanlens instance talks to your Supabase — we never see your data.

---

---

## License

[MIT](./LICENSE) — use, fork, self-host, or build on top freely. The hosted service at [spanlens.io](https://www.spanlens.io) is the recommended way to run Spanlens, but you can always pull the Docker image and run it yourself (see [docs/self-host](https://www.spanlens.io/docs/self-host)).
