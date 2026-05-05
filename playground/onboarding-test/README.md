# Spanlens Onboarding Test

End-to-end smoke test for Spanlens — verifies that a brand-new account can:

1. Sign up → create project → issue API key → register provider keys
2. Install `@spanlens/sdk` and call OpenAI / Anthropic / Gemini through the proxy
3. See the request appear in `/requests` within 5 seconds

Run this **after** the manual signup steps below.

> ⚠️ This directory is **NOT** a pnpm workspace member — `pnpm install` runs
> in this folder uses the published `@spanlens/sdk` from npm, simulating
> a real customer's environment.

---

## 1. Manual setup (one-time, in browser)

### a. Sign up

Visit https://www.spanlens.io/signup?direct=1
(`?direct=1` bypasses the pre-launch waitlist redirect.)

### b. Create a project

Dashboard → Projects → "New project". Note the project ID.

### c. Issue a Spanlens API key

In the project page → "Create API key". Copy the `sl_live_...` value — you
**only see it once**.

### d. Register provider keys

Settings → Provider keys → add one each:
- OpenAI key (starts with `sk-...`)
- Anthropic key (starts with `sk-ant-...`)
- Gemini key (Google AI Studio API key)

These are encrypted and stored server-side. The client never sees them
again — `SPANLENS_API_KEY` is the only secret your app needs.

### e. Grab a JWT for the dashboard API

Open https://www.spanlens.io/requests in your browser, log in, then:

1. DevTools → Application → Cookies → `https://www.spanlens.io`
2. Find the cookie whose name starts with `sb-` and ends with `-auth-token`
3. Copy its value (long base64 / JSON-encoded string)

This JWT is used by `benchmark.ts` to poll `/api/v1/requests` and measure
ingest latency. Individual provider tests don't need it.

---

## 2. Local setup

```bash
cd playground/onboarding-test
cp .env.example .env
```

Fill in `.env`:
- `SPANLENS_API_KEY` — from step 1c
- `SPANLENS_JWT` — from step 1e (only for `benchmark`)

Then install:

```bash
pnpm install
```

> Note: this runs `pnpm install` in *this* folder, hitting the public npm
> registry for `@spanlens/sdk`. It does not use the in-repo workspace copy.

---

## 3. Run

### Test individual providers

```bash
pnpm openai      # gpt-4o-mini → "ping"
pnpm anthropic   # claude-haiku-4-5
pnpm gemini      # gemini-2.0-flash
```

Each prints upstream latency + provider's reply. Then verify in
https://www.spanlens.io/requests that the row showed up.

### Full benchmark (ingest latency)

```bash
pnpm benchmark
```

Output:
```
═══ Spanlens onboarding benchmark ═══
  proxy:     https://spanlens-server.vercel.app
  dashboard: https://www.spanlens.io
  target:    ingest latency < 5000ms

▶ openai
  ✓ provider 200 OK in 712ms — reply: "ping"
  ⏱  polling /api/v1/requests for new row...
  ✓ ingested in 1843ms (8 polls) — request id: 8a4f...

▶ anthropic
  ...

▶ gemini
  ...

═══ Summary ═══
provider     upstream    ingest     status
────────────────────────────────────────────
  openai       712ms     1843ms    ✓ <5s
  anthropic    984ms     2104ms    ✓ <5s
  gemini       521ms     1577ms    ✓ <5s
```

Exit code `0` if all three pass `< 5s`, otherwise `1`.

---

## 4. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` from proxy | `SPANLENS_API_KEY` missing or revoked |
| `400 No active provider key` | Forgot step 1d for that provider |
| `403 Insufficient permission` | Account role is `viewer` — need `admin`/`editor` |
| Provider 200 but row never appears | Async logging dropped (Vercel Edge `waitUntil` issue) — check Vercel function logs |
| Ingest latency > 10s | Cold start on `spanlens-server` lambda — re-run, second pass should be fast |
| Anthropic returns 404 model | `claude-haiku-4-5` deprecated — try `claude-haiku-3-5` |
| Gemini "models/X not found" | Edit `gemini.ts` model param |

---

## 5. What this catches

- Onboarding UX regressions (signup → first request flow)
- SDK install / API change drift between major SDK releases
- Proxy ingest latency regressions (especially `fireAndForget` on Edge)
- Cost calculation correctness (cross-check `total_tokens` × model rate)
- Auth + role guards (try with viewer JWT — should 403 on `/replay/run`)
