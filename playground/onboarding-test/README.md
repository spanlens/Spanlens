# Spanlens onboarding test (dummy customer app)

A minimal Next.js app simulating exactly what a new Spanlens customer
goes through. Three buttons → three providers (OpenAI / Anthropic /
Gemini) → real API calls.

The point: walk through `npx @spanlens/cli init` exactly as a real
customer would, then verify the requests show up in the dashboard.

> Not a pnpm workspace member — `pnpm install` here uses the published
> `@spanlens/sdk` from npm, just like real customers.

---

## Phase 0 — Manual dashboard setup (browser, ~3 min)

You'll do these steps once.

1. **Sign up** at https://www.spanlens.io/signup?direct=1
   (`?direct=1` bypasses the pre-launch waitlist redirect.)
2. **Project**: Dashboard → Projects → "New project".
3. **Add provider keys** (one row each — you can add fewer if you only want
   to test some providers):
   - "Add provider key" → OpenAI + your `sk-…` key
   - "Add provider key" → Anthropic + your `sk-ant-…` key
   - "Add provider key" → Gemini + your Google AI Studio key
4. **Issue Spanlens key**: in the same project → "New Spanlens key" → name it.
   Copy the `sl_live_…` value — it's shown only once.

You're done with the dashboard. **One** Spanlens key now covers all three
providers you registered.

---

## Phase 1 — Install + run (before Spanlens integration)

```bash
cd playground/onboarding-test
pnpm install                      # public npm — no workspace shortcut
pnpm dev                          # http://localhost:3000
```

Open the page. You'll see three cards. Right now:
- **All three buttons fail** (the routes use upstream clients directly without
  any provider key — they'd need `OPENAI_API_KEY`/etc. in env to work).
- This is the "before" state of a customer who hasn't integrated Spanlens.

Now we'll integrate.

---

## Phase 2 — Run the CLI (the moment of truth)

In a separate terminal, **inside `playground/onboarding-test/`**:

```bash
npx @spanlens/cli@latest init
```

The wizard:
1. Detects the Next.js project
2. Asks for `SPANLENS_API_KEY` → paste the `sl_live_…` from Phase 0
3. **Validates the key against the API** and fetches your project's
   registered providers (e.g. `openai, anthropic, gemini`)
4. If `.env.local` already has a different `SPANLENS_API_KEY`, asks before
   overwriting
5. Auto-installs `@spanlens/sdk` via your package manager
6. **Scans for every registered provider's client and patches them in one go**:
   - `new OpenAI(...)` → `createOpenAI()`
   - `new Anthropic(...)` → `createAnthropic()`
   - `new GoogleGenerativeAI(...)` → `createGemini()`
7. Runs `tsc --noEmit` to confirm the patch didn't break anything

Open `app/api/*/route.ts` after the CLI completes — every route should now
import from `@spanlens/sdk` instead of the upstream packages.

Restart the dev server so Next.js picks up the new env + code:

```bash
# Ctrl-C in the dev terminal, then:
pnpm dev
```

Click each button → reply comes back → open
https://www.spanlens.io/requests → **rows should appear within a few
seconds**. That's success.

---

## What you're checking

| Check | How |
|---|---|
| **Signup → first row in /requests, total time** | Stopwatch from "click Sign up" to "row visible". Target: under 5 minutes total, including Phase 0–2. |
| **Ingest latency (provider 200 → row visible)** | Click button, switch to /requests tab, count seconds. Target: < 5s. |
| **CLI provider auto-detect** | After step 3 above, the spinner says `Key valid · project X · providers: openai, anthropic, gemini`. |
| **CLI auto-patch correctness** | Open `app/api/openai/route.ts` (and others) — `import` line + constructor both rewritten to Spanlens helpers. |
| **`.env.local` overwrite confirm** | Re-run `npx @spanlens/cli init` with a different key — should prompt before replacing. |
| **TypeScript verification** | Last spinner says `TypeScript check passed ✓`. |
| **Cost calculation** | Compare `total_tokens × model rate` to dashboard's cost field. |

---

## When something breaks

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` after CLI patch | `.env.local` not picked up — restart `pnpm dev` |
| `400 No active provider key registered for this project` | Phase 0 step 3 missed for that provider |
| Provider 200 OK but row never appears | Async logging dropped (Edge `waitUntil` regression) — check Vercel function logs on `spanlens-server` |
| First click takes >10s | Cold start on serverless lambda — second click should be fast |
| Anthropic 404 model | `claude-haiku-4-5` deprecated — try `claude-haiku-3-5` |
| `403 Insufficient permission` on replay | Account is `viewer` role — only admin/editor can replay |
| CLI says "providers: (none registered)" | You skipped Phase 0 step 3 — go back and add at least one provider key |

If you hit something not in the table → **screenshot the error +
network tab** and we'll fix it. That's the whole point of running this.
