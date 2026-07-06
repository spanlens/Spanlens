import Link from 'next/link'
import { CodeBlock } from '../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'Spanlens CLI · Spanlens Docs',
  description:
    'One-command setup wizard for Spanlens, in both Node (npx @spanlens/cli) and Python (spanlens init). Auto-detects OpenAI, Anthropic, and Gemini SDK calls and routes them through the proxy.',
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

const PY_INSTALL_CMD = `pip install spanlens
spanlens init`

const PY_WIZARD_OUTPUT = `🔭  Spanlens setup

  Detected pip project · uses openai, anthropic

  Before continuing, make sure you have:
    1. A Spanlens account at https://www.spanlens.io
    2. A Project at https://www.spanlens.io/projects
    3. Provider keys (OpenAI / Anthropic / Gemini) added to that project
    4. A Spanlens key issued for that project (sl_live_...)

  ? Paste your Spanlens key > sl_live_*************

  Key valid · project chatbot-prod · providers: openai, anthropic
  Created .env with SPANLENS_API_KEY
  Installed (pip install spanlens[anthropic,openai])

  Found 2 patches to apply
    • [openai] app/agent.py
        → import: from openai → from spanlens.integrations.openai import create_openai
        → 1 × constructor → create_openai(...)
    • [anthropic] app/summarize.py
        → 1 × constructor → create_anthropic(...)

  ? Apply these changes? > yes
  Patched 2 file(s)

🎉 Spanlens setup complete`

const PY_OPENAI_DIFF = `- from openai import OpenAI
- client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=30)
+ from spanlens.integrations.openai import create_openai
+ client = create_openai(timeout=30)`

const PY_ANTHROPIC_DIFF = `- from anthropic import Anthropic
- client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
+ from spanlens.integrations.anthropic import create_anthropic
+ client = create_anthropic()`

const PY_GEMINI_DIFF = `  import google.generativeai as genai
- genai.configure(api_key=os.environ["GEMINI_API_KEY"])
+ from spanlens.integrations.gemini import configure_gemini
+ configure_gemini()`

const PY_DRY_RUN_CMD = `spanlens init --dry-run`
const PY_TEST_CMD = `spanlens test`

const MANUAL_SNIPPET = `import { createOpenAI }    from '@spanlens/sdk/openai'
import { createAnthropic } from '@spanlens/sdk/anthropic'
import { createGemini }    from '@spanlens/sdk/gemini'

// Each factory reads SPANLENS_API_KEY from env and routes the
// underlying provider SDK through the Spanlens proxy. The response
// types and method signatures are identical to the upstream SDKs.`

export default function CliDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
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

      <div className="my-6 rounded-lg border-l-4 border-accent bg-accent-bg p-4 text-sm">
        <p className="m-0 font-semibold text-accent">Working in Python?</p>
        <p className="mt-1 mb-0 text-accent">
          The same wizard ships with the Python SDK. Run{' '}
          <code>pip install spanlens &amp;&amp; spanlens init</code> and jump to the{' '}
          <Link href="#python" className="underline">Python CLI</Link> section below.
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

      <h2 id="python">Python CLI</h2>
      <p>
        The Python SDK ships the same wizard as a console command. There is no
        separate package to install: <code>pip install spanlens</code> gives you
        both the SDK and the <code>spanlens</code> command. It uses only the
        standard library plus <code>httpx</code>, so it adds no weight to your
        environment.
      </p>
      <CodeBlock language="bash">{PY_INSTALL_CMD}</CodeBlock>
      <p>
        It detects your package manager (<code>poetry</code>, <code>uv</code>,{' '}
        <code>pipenv</code>, or <code>pip</code>), reads which provider libraries
        you already declare, validates your key, writes <code>.env</code>, and
        rewrites your client construction. A real run looks like this:
      </p>
      <CodeBlock language="bash">{PY_WIZARD_OUTPUT}</CodeBlock>
      <p>
        Every patched file is re-parsed before it is written, so the wizard never
        leaves you with code that will not import. Here is what each provider
        rewrite looks like:
      </p>
      <h3>OpenAI (Python)</h3>
      <CodeBlock language="diff">{PY_OPENAI_DIFF}</CodeBlock>
      <h3>Anthropic (Python)</h3>
      <CodeBlock language="diff">{PY_ANTHROPIC_DIFF}</CodeBlock>
      <h3>Gemini (Python)</h3>
      <p>
        Gemini uses module-level configuration in Python, so the wizard rewrites
        the <code>genai.configure(...)</code> call and keeps your{' '}
        <code>GenerativeModel</code> usage untouched:
      </p>
      <CodeBlock language="diff">{PY_GEMINI_DIFF}</CodeBlock>
      <p>
        Preview without writing anything, or check connectivity without running
        the full wizard:
      </p>
      <CodeBlock language="bash">{PY_DRY_RUN_CMD}</CodeBlock>
      <CodeBlock language="bash">{PY_TEST_CMD}</CodeBlock>
      <p>
        For CI or scripted setup, pass <code>--yes</code> to accept every prompt
        and <code>--api-key sl_live_...</code> (or set <code>SPANLENS_API_KEY</code>)
        to skip the interactive key entry. Self-hosting works the same way with{' '}
        <code>--server-url</code>.
      </p>

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
