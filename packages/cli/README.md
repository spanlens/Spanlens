# @spanlens/cli

**One-command setup for Spanlens LLM observability.**

Writes your Spanlens API key into `.env.local`, then AST-rewrites every `new OpenAI({ apiKey, baseURL })` in your project into `createOpenAI()`. No URL to remember, no copy-paste errors.

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
    2. A Project + API key in /projects
    3. Provider keys (OpenAI, etc.) registered in /settings

  ? Paste your Spanlens API key › sl_live_*************

  ✓ Updated SPANLENS_API_KEY in .env.local
  ✓ Found 2 files to patch
    • app/api/chat/route.ts
        → import: "OpenAI" from 'openai' → { createOpenAI } from '@spanlens/sdk/openai'
        → 1 × new OpenAI({...}) → createOpenAI({...})
    • app/api/analyze/route.ts
        → ...
  ? Apply these changes? › yes
  ✓ Patched 2 files

  ┌  Next steps  ─────────────────────────────────────┐
  │  1. Install the SDK (if not already):            │
  │       npm install @spanlens/sdk                   │
  │                                                   │
  │  2. Add SPANLENS_API_KEY to your deployment env   │
  │     (Vercel / Railway / Fly → Settings)           │
  │                                                   │
  │  3. Redeploy your app                             │
  │                                                   │
  │  4. Your requests will show up at:                │
  │       https://www.spanlens.io/requests            │
  └───────────────────────────────────────────────────┘

🎉 Spanlens setup complete
```

## Before / After diff

### Before

```ts
// app/api/chat/route.ts
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.SPANLENS_API_KEY,
  baseURL: 'https://spanlens-server.vercel.app/proxy/openai/v1',
  timeout: 30_000,
})
```

### After (same file, wizard-patched)

```ts
// app/api/chat/route.ts
import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI({
  timeout: 30_000,
})
```

`apiKey` and `baseURL` are removed — `createOpenAI` picks them up from `SPANLENS_API_KEY` env var and the default proxy URL. All other options (`timeout`, `organization`, `defaultHeaders`, etc.) stay put.

## What's supported

- ✅ Next.js (TypeScript + JavaScript)
- ✅ OpenAI SDK — `new OpenAI({...})` default-import pattern
- ✅ **Auto-installs `@spanlens/sdk`** using your package manager (npm / pnpm / yarn / bun)
- ✅ `--dry-run` flag (preview without writing or installing)
- ✅ Multiple `new OpenAI(...)` calls per project
- ✅ Non-destructive env-file writes (preserves comments, other keys)

### Coming soon

- Anthropic / Gemini auto-patching
- Vite / Express / Fastify detection
- Device OAuth login (no manual API key paste)
- Server-side provisioning (`POST /api/v1/onboarding/provision`)

## Manual integration (if wizard doesn't fit your stack)

See [@spanlens/sdk README](https://www.npmjs.com/package/@spanlens/sdk) — the same helpers work without the wizard:

```ts
import { createOpenAI } from '@spanlens/sdk/openai'
const openai = createOpenAI()
```

## Requirements

- Node.js 18+
- A [Spanlens account](https://www.spanlens.io) with an API key

## License

MIT
