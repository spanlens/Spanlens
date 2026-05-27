# @spanlens/cli changelog

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
