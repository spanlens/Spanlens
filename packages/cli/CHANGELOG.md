# @spanlens/cli changelog

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
