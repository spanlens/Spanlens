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

### Self-hosted Spanlens instance

```bash
npx @spanlens/cli init --server-url https://spanlens.yourcompany.com
```

Points the wizard at your own Spanlens server, the host that serves `/api` and `/proxy`. The wizard validates your key against it and writes its origin (no path, no trailing slash) to `SPANLENS_BASE_URL`. The `@spanlens/sdk` factories read that variable and send requests to `/proxy/openai/v1`, `/proxy/anthropic`, or `/proxy/gemini` on your server; the wizard prints those exact addresses when it finishes. A path in the URL you pass is ignored with a warning. `--server-url=<url>` works too.

## What it does

```
🔭  Spanlens setup

  ✓ Detected Next.js (TypeScript)

  Before continuing, make sure you have:
    1. A Spanlens account at https://www.spanlens.io
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
  ✓ Recording the TypeScript baseline: no errors
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

Options that carry a provider credential or the upstream address are stripped (`apiKey` and `baseURL`, plus `authToken`, `credentials`, `config`, and `profile` for Anthropic), since every factory reads `SPANLENS_API_KEY` from env and routes through the Spanlens proxy. Other options (`timeout`, `organization`, `defaultHeaders`, etc.) stay put.

### Imports the file still needs

The provider import is only removed when nothing else in the file uses it:

```diff
- import OpenAI, { APIError } from 'openai'
+ import { APIError } from 'openai'
+ import { createOpenAI } from '@spanlens/sdk/openai'
- const openai = new OpenAI()
+ const openai = createOpenAI()
  export const isApiError = (e: unknown) => e instanceof APIError
```

If `OpenAI` still appears as a type, in a namespace type such as `OpenAI.Chat.Completions.ChatCompletionMessageParam`, or in an `instanceof` check, the import stays as it is and the factory import is added next to it.

## What it leaves for you

Only inline object options whose keys are all written out are rewritten. When the options come from a variable, a spread (`{ ...opts }`), or a computed key, the wizard cannot tell whether they still carry your provider key or a `baseURL`. Passing them through would either send your provider key to Spanlens or send requests straight to the provider, so the call is left unchanged and the wizard prints the exact edit:

```
[openai] lib/openai.ts:4  The options come from `providerOptions`, which the wizard cannot inspect.
  + import { createOpenAI } from '@spanlens/sdk/openai'
  - new OpenAI(providerOptions)
  + createOpenAI(providerOptions)
  Before you make this change, `providerOptions` must not set apiKey, baseURL, adminAPIKey, or workloadIdentity.
```

In that case the wizard ends with "Almost there" instead of "setup complete".

## Safety checks

- Every rewritten file is compiled in memory before anything is written. A file whose rewrite would leave a name unresolved or declared twice is left unchanged and reported.
- Writes are all-or-nothing: if one file cannot be written, the files written before it are restored.
- In TypeScript projects, the wizard runs your own `tsc --noEmit` before and after the patch. Errors that were already there are ignored. If the patch adds new ones, every patched file is restored, the errors are printed, and the wizard exits with status 1.

## What's supported

- ✅ Next.js (TypeScript + JavaScript)
- ✅ **OpenAI / Anthropic / Gemini**, auto-detected from your registered provider keys
- ✅ Auto-installs `@spanlens/sdk` using your package manager (npm / pnpm / yarn / bun)
- ✅ Validates the Spanlens key against the API before writing anything
- ✅ Confirms before overwriting an existing `SPANLENS_API_KEY` in your env file
- ✅ Type-checks the patch with your own `tsc --noEmit` and rolls it back if it adds errors
- ✅ `--dry-run` flag (preview without writing or installing)
- ✅ `--server-url <url>` flag for self-hosted deployments
- ✅ Multiple `new XxxClient(...)` calls per project
- ✅ Non-destructive env-file writes (preserves comments, other keys)

### Coming soon

- Vite / Express / Fastify detection
- Python (FastAPI / Flask) support
- Device OAuth login (no manual API key paste)

## Manual integration (if wizard doesn't fit your stack)

See [@spanlens/sdk README](https://www.npmjs.com/package/@spanlens/sdk). The same helpers work without the wizard:

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
