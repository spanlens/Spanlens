# @spanlens/cli changelog

## 0.3.4

### Fixed

- The patcher no longer deletes imports the file still needs. `import OpenAI, { APIError, toFile } from 'openai'` used to be replaced wholesale, which broke every remaining `APIError`, `toFile`, `type Client = OpenAI`, `OpenAI.Chat...` namespace type, and `instanceof OpenAI` reference (TS2304). Now only the client binding is removed, and only when nothing else in the file uses it. The same applies to `Anthropic` and `GoogleGenerativeAI`.
- Options that the wizard cannot read in full are no longer passed through to the factory. `new OpenAI(providerOptions)` used to become `createOpenAI(providerOptions)`, which kept a leftover `baseURL` (requests skipped Spanlens without any error) or a leftover `apiKey` (your provider key was sent to Spanlens). Variables, spreads, and computed keys are now left untouched and reported with the exact manual edit.
- Shorthand `{ apiKey, baseURL }` options are stripped like `{ apiKey: ... }` ones. For Anthropic, `authToken`, `credentials`, `config`, and `profile` are stripped too, since they also produce an `Authorization` header.
- A failed type check no longer ends with "setup complete". The wizard records a `tsc --noEmit` baseline, and if the patch introduces new errors it restores every patched file, prints the errors, and exits with status 1.
- `--server-url` is written to `SPANLENS_BASE_URL` as a bare origin: trailing slashes and any pasted path such as `/proxy/openai/v1` are dropped (with a warning). `--server-url=<url>` is accepted, and a missing or malformed value stops the wizard instead of silently falling back to the hosted service.
- The closing note for self-hosted setups lists the exact proxy addresses the SDK will call.
- Credentials one level down in the options no longer reach Spanlens. `defaultHeaders: { Authorization: ... }` used to be passed to the factory as is, and the provider SDK sends it after its own auth header, so it replaced the Spanlens key and sent the OpenAI key to Spanlens. Credential and gateway entries (`Authorization`, `x-api-key`, `api-key`, `Helicone-*`, `x-portkey-*`, `cf-aig-*`, and names with key, token, or secret in them) are now removed from inline `defaultHeaders` and `defaultQuery`, and the preview lists them. Headers the wizard cannot read, header values that look like a key, a custom `fetch`, and `fetchOptions.headers` send the call to a manual edit.
- Azure OpenAI clients built on the plain `OpenAI` class are no longer switched to `createOpenAI()`, which would have sent their requests to OpenAI. The wizard points to the `/proxy/azure` route instead.
- `import { OpenAI } from 'openai'` and `import { Anthropic } from '@anthropic-ai/sdk'` (aliases included) are rewritten like the default import. Clients created from `require()`, a dynamic `import()`, or a namespace import are reported as manual edits instead of being skipped without a word.
- The wizard no longer says "setup complete" when it found no client to switch over, because no request goes through Spanlens yet.
- With `--server-url`, the wizard checks that the installed `@spanlens/sdk` reads `SPANLENS_BASE_URL` (0.18.0 or later) before it writes the env file. It offers to upgrade an older SDK and stops if that is not possible, because an older SDK sends requests and the self-hosted key to the hosted service. The closing note only says the SDK reads the variable after that check passed.

### Added

- Every rewritten file is compiled in memory before it is written, and writes are all-or-nothing, so JavaScript projects without a `tsconfig.json` are protected too.

## 0.3.3

### Added

- Post-init welcome message with a GitHub star CTA and a docs link, shown once after a successful `spanlens init`.

## 0.3.2

Metadata + dependency refresh. No CLI behavior changes; same wizard flow, same prompts, same code patches.

### Added

- `engines.node` set to `>=18.0.0`. The CLI uses native `fetch` and ESM, so older Node would fail at runtime; install now warns instead.

### Changed

- Bulk dependency update across the workspace (`@clack/prompts`, `picocolors`, `ts-morph`, and their transitives). Picks up patch-level bug fixes upstream.

### Fixed

- `clean` script is now cross-platform. Local Windows publish flow used to abort at `prepublishOnly` because `rm -rf dist` is not a Windows command. Replaced with a Node-based `fs.rmSync`.

### Docs

- README prose reflow (em dash removal) for consistency with `@spanlens/sdk`.

## 0.1.2

Metadata-only release — expanded npm keywords for discoverability, added `LICENSE` file to the published tarball. No functional changes.

## 0.1.1

Auto-install `@spanlens/sdk` into the user's project when the wizard runs, so users get a ready-to-use `createOpenAI()` import without a second install step.

## 0.1.0

Initial release — `npx @spanlens/cli init` wizard:

- Detects Next.js + package manager (npm / pnpm / yarn / bun)
- Prompts for Spanlens API key (one-time paste)
- Writes `SPANLENS_API_KEY` to `.env.local`
- Scans codebase and rewrites `new OpenAI({ apiKey, baseURL })` → `createOpenAI()` via `ts-morph`
- `--dry-run` flag previews changes without writing
- Bin aliases: `spanlens` and `create-spanlens`
