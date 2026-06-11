import Link from 'next/link'
import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: 'Spanlens CLI · Spanlens Docs',
  description:
    'One-command setup wizard for Spanlens. Auto-detects OpenAI, Anthropic, and Gemini SDK calls in your codebase and routes them through the proxy.',
  alternates: { canonical: '/docs/cli' },
}

const INSTALL_CMD = `npx @spanlens/cli init`

const WIZARD_OUTPUT = `Spanlens setup

  Detected Next.js (TypeScript)

  Before continuing, make sure you have:
    1. A Spanlens account at https://www.spanlens.io
    2. A Project at https://www.spanlens.io/projects
    3. Provider keys (OpenAI / Anthropic / Gemini) added to that project
    4. A Spanlens key issued for that project (sl_live_...)

  ? Paste your Spanlens key > sl_live_*************

  Key valid - project chatbot-prod - providers: openai, anthropic, gemini
  Updated SPANLENS_API_KEY in .env.local
  Installed @spanlens/sdk (pnpm add @spanlens/sdk)

  Found 3 patches to apply
    - [openai] app/api/chat/route.ts
        import: "OpenAI" from 'openai' -> { createOpenAI } from '@spanlens/sdk/openai'
        1 x new OpenAI(...) -> createOpenAI(...)
    - [anthropic] app/api/summary/route.ts
        1 x new Anthropic(...) -> createAnthropic(...)
    - [gemini] app/api/translate/route.ts
        1 x new GoogleGenerativeAI(...) -> createGemini(...)

  ? Apply these changes? > yes
  Patched 3 files
  TypeScript check passed

Spanlens setup complete`

const OPENAI_DIFF = `- import OpenAI from 'openai'
- const openai = new OpenAI({
-   apiKey: process.env.OPENAI_API_KEY,
-   timeout: 30_000,
- })
+ import { createOpenAI } from '@spanlens/sdk/openai'
+ const openai = createOpenAI({
+   timeout: 30_000,
+ })`

const ANTHROPIC_DIFF = `- import Anthropic from '@anthropic-ai/sdk'
- const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
+ import { createAnthropic } from '@spanlens/sdk/anthropic'
+ const anthropic = createAnthropic()`

const GEMINI_DIFF = `- import { GoogleGenerativeAI } from '@google/generative-ai'
- const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
+ import { createGemini } from '@spanlens/sdk/gemini'
+ const genAI = createGemini()`

const DRY_RUN_CMD = `npx @spanlens/cli init --dry-run`
const SELF_HOST_CMD = `npx @spanlens/cli init --server-url https://spanlens.yourcompany.com`

const MANUAL_SNIPPET = `import { createOpenAI }    from '@spanlens/sdk/openai'
import { createAnthropic } from '@spanlens/sdk/anthropic'
import { createGemini }    from '@spanlens/sdk/gemini'

// Each factory reads SPANLENS_API_KEY from env and routes the
// underlying provider SDK through the Spanlens proxy. The response
// types and method signatures are identical to the upstream SDKs.`

export default function CliDocs() {
  return (
    <div>
      <h1>Spanlens CLI</h1>
      <p className="lead">
        One command rewrites every <code>new OpenAI(...)</code>,{' '}
        <code>new Anthropic(...)</code>, and <code>new GoogleGenerativeAI(...)</code> in
        your codebase into the matching <code>@spanlens/sdk</code> factory. The
        wizard validates your key against the dashboard, picks up which providers
        are registered on your project, and runs <code>tsc --noEmit</code> before
        committing so you do not ship a broken build.
      </p>

      <div className="my-6 rounded-lg border-l-4 border-accent bg-accent-bg p-4 text-sm">
        <p className="m-0 font-semibold text-accent">Two-line manual integration still works</p>
        <p className="mt-1 mb-0 text-accent">
          If the wizard does not fit your stack, skip it and use the{' '}
          <Link href="/docs/sdk" className="underline">@spanlens/sdk</Link>{' '}
          factories directly. Same end result, same proxy, same dashboard.
        </p>
      </div>

      <h2>Install &amp; run</h2>
      <CodeBlock language="bash">{INSTALL_CMD}</CodeBlock>
      <p>
        No global install needed. <code>npx</code> fetches the latest release on
        each run, so the patch rules stay current with new framework releases.
        The wizard expects:
      </p>
      <ul>
        <li>A Spanlens account with a project at <Link href="/projects" className="text-accent hover:underline">/projects</Link></li>
        <li>At least one provider key (OpenAI / Anthropic / Gemini) registered on that project</li>
        <li>A Spanlens API key issued for the project (<code>sl_live_*</code>)</li>
        <li>Node.js 18 or newer in the project you are patching</li>
      </ul>

      <h2 id="walkthrough">Walkthrough</h2>
      <p>
        Here is a real run against a Next.js project with three direct provider
        SDK call sites:
      </p>
      <CodeBlock language="bash">{WIZARD_OUTPUT}</CodeBlock>
      <p>
        The wizard never writes to disk until you answer <code>yes</code> on the
        confirmation prompt. The <code>tsc --noEmit</code> check after patching
        is mandatory; if any rewrite breaks a type, the wizard refuses to
        complete and reports which file failed.
      </p>

      <h2 id="before-after">Before / after</h2>
      <p>
        Each provider follows the same pattern: drop the import, drop the
        explicit <code>apiKey</code>, keep every other option (<code>timeout</code>,{' '}
        <code>organization</code>, <code>defaultHeaders</code>, etc.).
      </p>
      <h3>OpenAI</h3>
      <CodeBlock language="diff">{OPENAI_DIFF}</CodeBlock>
      <h3>Anthropic</h3>
      <CodeBlock language="diff">{ANTHROPIC_DIFF}</CodeBlock>
      <h3>Gemini</h3>
      <CodeBlock language="diff">{GEMINI_DIFF}</CodeBlock>

      <h2 id="supported">What is supported today</h2>
      <table>
        <thead>
          <tr>
            <th>Area</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OpenAI / Anthropic / Gemini SDK rewrites</td>
            <td>Stable. Auto-detected from your registered provider keys.</td>
          </tr>
          <tr>
            <td>Next.js (TypeScript &amp; JavaScript)</td>
            <td>Stable.</td>
          </tr>
          <tr>
            <td>Vite / Express / Fastify / standalone Node</td>
            <td>Detection-only today, full rewrite path is on the roadmap.</td>
          </tr>
          <tr>
            <td>Python (FastAPI / Flask)</td>
            <td>Planned. Use the manual <Link href="/docs/sdk" className="text-accent hover:underline">@spanlens/sdk</Link> for now.</td>
          </tr>
          <tr>
            <td>Package managers</td>
            <td>npm, pnpm, yarn, bun all detected automatically.</td>
          </tr>
          <tr>
            <td>Env-file writes</td>
            <td>Preserves comments and surrounding keys; confirms before overwriting.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="flags">Flags</h2>
      <table>
        <thead>
          <tr>
            <th>Flag</th>
            <th>Use it for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>--dry-run</code></td>
            <td>
              Preview the patch list without writing or installing anything. Safe
              to run on a clean tree to see what the wizard would do.
              <CodeBlock language="bash">{DRY_RUN_CMD}</CodeBlock>
            </td>
          </tr>
          <tr>
            <td><code>--server-url &lt;url&gt;</code></td>
            <td>
              Point at a self-hosted Spanlens instance. Validation, dashboard
              links, and the generated <code>SPANLENS_BASE_URL</code> all use
              your URL instead of <code>spanlens.io</code>.
              <CodeBlock language="bash">{SELF_HOST_CMD}</CodeBlock>
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="manual">Manual integration</h2>
      <p>
        Prefer to skip the wizard? The same factories work standalone. Add{' '}
        <code>@spanlens/sdk</code> as a dependency, replace your provider SDK
        constructor with the matching factory, and you are done:
      </p>
      <CodeBlock language="ts">{MANUAL_SNIPPET}</CodeBlock>
      <p>
        See the <Link href="/docs/sdk" className="text-accent hover:underline">SDK reference</Link> for
        the full option list, streaming details, and agent-tracing primitives.
      </p>

      <h2 id="troubleshooting">Troubleshooting</h2>
      <h3>The wizard says my key is invalid</h3>
      <p>
        The CLI calls <code>POST /api/v1/keys/validate</code> on the Spanlens
        server before writing anything. Common causes:
      </p>
      <ul>
        <li>The key is for a different project than the one you intended.</li>
        <li>The key was revoked from <Link href="/projects" className="text-accent hover:underline">/projects</Link>.</li>
        <li>
          A self-hosted deployment without <code>--server-url</code> points at
          <code> spanlens.io</code> by default.
        </li>
      </ul>

      <h3>TypeScript check fails after patching</h3>
      <p>
        The wizard aborts with the file that failed. Almost always this is a
        custom field on the original constructor that we did not migrate (for
        example, a private adapter wrapping <code>new OpenAI</code>). Open the
        file, finish the migration by hand, and re-run with{' '}
        <code>--dry-run</code> to confirm there is nothing left to patch.
      </p>

      <h3>Wizard does not detect my framework</h3>
      <p>
        Today the rewrite path is Next.js only. For Vite, Express, Fastify, or
        standalone Node projects, run the manual integration shown above. Open
        an issue on{' '}
        <a href="https://github.com/spanlens/spanlens" className="text-accent hover:underline">
          spanlens/spanlens
        </a>{' '}
        with the framework you would like detected.
      </p>

      <h3>I want to roll back what the wizard did</h3>
      <p>
        Every change is a regular file edit and an env write. <code>git diff</code>{' '}
        shows the rewrite; <code>git restore .</code> reverses it. The wizard
        never touches anything outside the patched source files and your env
        file, so a single revert is enough.
      </p>

      <p className="mt-10 text-sm text-muted-foreground">
        Source:{' '}
        <a
          href="https://github.com/spanlens/spanlens/tree/main/packages/cli"
          className="text-accent hover:underline"
        >
          packages/cli
        </a>{' '}
        on GitHub. MIT licensed.
      </p>
    </div>
  )
}
