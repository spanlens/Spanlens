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

Points the wizard at your own Spanlens server, the host that serves `/api` and `/proxy`. The wizard validates your key against it and writes its origin (no path, no trailing slash) to `SPANLENS_BASE_URL`. The `@spanlens/sdk` factories read that variable from version 0.18.0 on and send requests to `/proxy/openai/v1`, `/proxy/anthropic`, or `/proxy/gemini` on your server; the wizard prints those exact addresses when it finishes. A path in the URL you pass is ignored with a warning. `--server-url=<url>` works too.

Older `@spanlens/sdk` versions ignore `SPANLENS_BASE_URL` and would send your requests and your self-hosted key to the hosted service. So before it writes anything, the wizard checks the version installed in your project. It offers to upgrade an older one, and if you decline, or the newest published version is still older than 0.18.0, it stops without touching your env file or your code.

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
  ✓ Installed @spanlens/sdk (pnpm add @spanlens/sdk)
  ✓ Updated SPANLENS_API_KEY in .env.local

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

Options that carry a provider credential or the upstream address are stripped (`apiKey` and `baseURL`, plus `authToken`, `credentials`, `config`, and `profile` for Anthropic), since every factory reads `SPANLENS_API_KEY` from env and routes through the Spanlens proxy. Other options (`timeout`, `organization`, `maxRetries`, etc.) stay put. The client can come from a default import or a named one (`import { OpenAI } from 'openai'`); both are rewritten, for OpenAI and Anthropic alike.

### Headers and query parameters

`defaultHeaders` and `defaultQuery` stay, minus any entry that carries a credential: `Authorization`, `x-api-key`, `api-key`, names with key, token, or secret in them, and every gateway header such as `Helicone-*`, `x-portkey-*`, or `cf-aig-*`. The provider SDKs send these after their own auth header, so an `Authorization` left in place would replace your Spanlens key and send your OpenAI key to Spanlens. The preview lists every entry the wizard removes:

```diff
- const openai = new OpenAI({
-   apiKey: process.env.OPENAI_API_KEY,
-   baseURL: 'https://oai.helicone.ai/v1',
-   defaultHeaders: { 'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}` },
- })
+ const openai = createOpenAI()
```

Helicone metadata headers such as `Helicone-User-Id` are dropped too; see the [Helicone migration guide](https://www.spanlens.io/docs/migrate/from-helicone) for their Spanlens counterparts.

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

The wizard also leaves a call for you, with the same kind of instructions, when:

- `defaultHeaders` or `defaultQuery` comes from a variable or a helper call, or a header value looks like a key
- the options pass a custom `fetch`, or `fetchOptions` sets `headers`, since either can add its own credentials
- the client is created from `require()`, a dynamic `import()`, or a namespace import such as `import * as oai from 'openai'`
- the client talks to Azure OpenAI (an Azure `baseURL`, an `api-key` header, or an `api-version` query). `createOpenAI()` would send those requests to OpenAI, so the wizard points you at the Azure route in the [proxy docs](https://www.spanlens.io/docs/proxy) instead of suggesting a rewrite

In any of these cases the wizard ends with "Almost there" instead of "setup complete". If it finds no client at all, it says setup is not finished and shows the factory imports to use.

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
