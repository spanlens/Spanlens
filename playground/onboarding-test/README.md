# Spanlens onboarding test (dummy customer app)

A minimal Next.js app simulating exactly what a new Spanlens customer
goes through. Three buttons → three providers (OpenAI / Anthropic /
Gemini) → real API calls.

The point: walk through `npx @spanlens/cli init` exactly as a real
customer would, then verify the requests show up in the dashboard.

> Not a pnpm workspace member — `pnpm install` here uses the published
> `@spanlens/sdk` from npm, just like real customers.

---

## Phase 0 — Manual dashboard setup (browser, ~5 min)

You'll do these steps once.

1. **Sign up** at https://www.spanlens.io/signup?direct=1
   (`?direct=1` bypasses the pre-launch waitlist redirect.)
2. **Project**: Dashboard → Projects → "New project".
3. **API key**: in the project page → "Create API key".
   Copy the `sl_live_...` value — it's shown only once.
4. **Provider keys**: Settings → Provider keys → register one each:
   - OpenAI (`sk-...`)
   - Anthropic (`sk-ant-...`)
   - Gemini (Google AI Studio key)

You're done with the dashboard. The app below talks to it via the
single `SPANLENS_API_KEY`.

---

## Phase 1 — Install + run (before Spanlens integration)

```bash
cd playground/onboarding-test
cp .env.example .env.local        # we'll fill it in Phase 2
pnpm install                      # public npm — no workspace shortcut
pnpm dev                          # http://localhost:3000
```

Open the page. You'll see three cards. Right now:
- **OpenAI/Anthropic/Gemini buttons all fail** (401 — no provider key).
  That's expected. The routes are using `new OpenAI(...)` style direct
  client init, no Spanlens involved yet.

This is the "before" state of a typical customer who hasn't integrated
Spanlens. Now we'll integrate.

---

## Phase 2 — Run the CLI (the moment of truth)

In a separate terminal, **inside `playground/onboarding-test/`**:

```bash
npx @spanlens/cli init
```

The wizard:
1. Detects the Next.js project ✓
2. Asks for `SPANLENS_API_KEY` — paste the `sl_live_...` from Phase 0
3. Writes it to `.env.local`
4. Auto-installs `@spanlens/sdk` via pnpm
5. **Scans for `new OpenAI(...)` and patches it** — open
   `app/api/openai/route.ts` after to confirm:
   ```diff
   - import OpenAI from 'openai'
   - const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
   + import { createOpenAI } from '@spanlens/sdk/openai'
   + const openai = createOpenAI()
   ```

Restart the dev server so Next.js picks up the new env + code:

```bash
# Ctrl-C in the dev terminal, then:
pnpm dev
```

Click **OpenAI** button → reply comes back → open
https://www.spanlens.io/requests → **a new row should appear within
a few seconds**. That's success.

---

## Phase 3 — Manual integration for Anthropic + Gemini

The CLI's MVP only auto-patches OpenAI. The other two need a
~3-line change each. Open the route files and follow the comment at
the top — short version:

**`app/api/anthropic/route.ts`**
```diff
- import Anthropic from '@anthropic-ai/sdk'
- const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
+ import { createAnthropic } from '@spanlens/sdk/anthropic'
+ const anthropic = createAnthropic()
```

**`app/api/gemini/route.ts`**
```diff
- import { GoogleGenerativeAI } from '@google/generative-ai'
- const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
+ import { createGemini } from '@spanlens/sdk/gemini'
+ const genAI = createGemini()
```

Save → Next.js HMR picks it up. Click both buttons. Both rows should
appear in `/requests`.

---

## What you're checking

| Check | How |
|---|---|
| **Signup → first row in /requests, total time** | Stopwatch from "click Sign up" to "row visible". Target: under 10 minutes total, including Phase 0–2. |
| **Ingest latency (provider 200 → row visible)** | Click button, switch to /requests tab, count seconds. Target: < 5s. |
| **CLI auto-patch correctness** | Open `app/api/openai/route.ts` after CLI run — diff matches expected. |
| **Cost calculation** | Compare `total_tokens × model rate` to dashboard's cost field. |
| **Trace tab parity** | If you set `x-trace-id` header on a call, it should appear in `/traces`. |

---

## When something breaks

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` after CLI patch | `.env.local` not picked up — restart `pnpm dev` |
| `400 No active provider key` | Phase 0 step 4 missed for that provider |
| Provider 200 OK but row never appears | Async logging dropped (Edge `waitUntil` regression) — check Vercel function logs on `spanlens-server` |
| First click takes >10s | Cold start on serverless lambda — second click should be fast |
| Anthropic 404 model | `claude-haiku-4-5` deprecated — try `claude-haiku-3-5` |
| `403 Insufficient permission` on replay | Account is `viewer` role — only admin/editor can replay |

If you hit something not in the table → **screenshot the error +
network tab** and we'll fix it. That's the whole point of running this.
