# @spanlens/cli

**One-command setup for Spanlens LLM observability.**

Validates your Spanlens key against the dashboard, finds out which providers are registered on your project, and AST-rewrites every direct `new OpenAI(...)` / `new Anthropic(...)` / `new GoogleGenerativeAI(...)` in your codebase into the matching `@spanlens/sdk` factory. One key covers all three providers.

## Quick start

```bash
npx @spanlens/cli init
```

That's it. Follow the prompts.

### Dry run (see what it would change)

```bash
npx @spanlens/cli init --dry-run
```

## What it does

```
🔭  Spanlens setup

  ✓ Detected Next.js (TypeScript)

  Before continuing, make sure you have:
    1. A Spanlens account — https://www.spanlens.io
    2. A Project at https://www.spanlens.io/projects
    3. Provider keys (OpenAI / Anthropic / Gemini) added to that project
    4. A Spanlens key issued for that project (sl_live_…)

  ? Paste your Spanlens key › sl_live_*************

  ✓ Key valid · project chatbot-prod · providers: openai, anthropic, gemini
  ✓ Updated SPANLENS_API_KEY in .env.local
  ✓ Installed @spanlens/sdk (pnpm add @spanlens/sdk)

  ✓ Found 3 patches to apply
    • [openai] app/api/chat/route.ts
        → import: "OpenAI" from 'openai' → { createOpenAI } from '@spanlens/sdk/openai'
        → 1 × new OpenAI(...) → createOpenAI(...)
    • [anthropic] app/api/summary/route.ts
        → import: "Anthropic" from '@anthropic-ai/sdk' → { createAnthropic } from '@spanlens/sdk/anthropic'
        → 1 × new Anthropic(...) → createAnthropic(...)
    • [gemini] app/api/translate/route.ts
        → import: "GoogleGenerativeAI" from '@google/generative-ai' → { createGemini } from '@spanlens/sdk/gemini'
        → 1 × new GoogleGenerativeAI(...) → createGemini(...)

  ? Apply these changes? › yes
  ✓ Patched 3 files
  ✓ TypeScript check passed ✓

  ┌  Next steps  ─────────────────────────────────────┐
  │  1. Add SPANLENS_API_KEY to your deployment env   │
  │     (Vercel / Railway / Fly → Settings)           │
  │  2. Redeploy your app                             │
  │  3. Your requests will show up at:                │
  │       https://www.spanlens.io/requests            │
  └───────────────────────────────────────────────────┘

🎉 Spanlens setup complete
```

## Before / After diffs

### OpenAI

```diff
- import OpenAI from 'openai'
- const openai = new OpenAI({
-   apiKey: process.env.OPENAI_API_KEY,
-   timeout: 30_000,
- })
+ import { createOpenAI } from '@spanlens/sdk/openai'
+ const openai = createOpenAI({
+   timeout: 30_000,
+ })
```

### Anthropic

```diff
- import Anthropic from '@anthropic-ai/sdk'
- const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
+ import { createAnthropic } from '@spanlens/sdk/anthropic'
+ const anthropic = createAnthropic()
```

### Gemini

```diff
- import { GoogleGenerativeAI } from '@google/generative-ai'
- const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
+ import { createGemini } from '@spanlens/sdk/gemini'
+ const genAI = createGemini()
```

`apiKey` and `baseURL` are stripped — every factory reads `SPANLENS_API_KEY` from env and routes through the Spanlens proxy. Other options (`timeout`, `organization`, `defaultHeaders`, etc.) stay put.

## What's supported

- ✅ Next.js (TypeScript + JavaScript)
- ✅ **OpenAI / Anthropic / Gemini** — auto-detected from your registered provider keys
- ✅ Auto-installs `@spanlens/sdk` using your package manager (npm / pnpm / yarn / bun)
- ✅ Validates the Spanlens key against the API before writing anything
- ✅ Confirms before overwriting an existing `SPANLENS_API_KEY` in your env file
- ✅ Runs `tsc --noEmit` after patching to catch any breakage immediately
- ✅ `--dry-run` flag (preview without writing or installing)
- ✅ Multiple `new XxxClient(...)` calls per project
- ✅ Non-destructive env-file writes (preserves comments, other keys)

### Coming soon

- Vite / Express / Fastify detection
- Python (FastAPI / Flask) support
- Device OAuth login (no manual API key paste)

## Manual integration (if wizard doesn't fit your stack)

See [@spanlens/sdk README](https://www.npmjs.com/package/@spanlens/sdk) — the same helpers work without the wizard:

```ts
import { createOpenAI }   from '@spanlens/sdk/openai'
import { createAnthropic } from '@spanlens/sdk/anthropic'
import { createGemini }   from '@spanlens/sdk/gemini'
```

## Requirements

- Node.js 18+
- A [Spanlens account](https://www.spanlens.io) with a project, at least one provider key, and a Spanlens API key

## License

MIT
