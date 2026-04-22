import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: 'Self-hosting · Spanlens Docs',
  description:
    'Run the Spanlens proxy on your own infra with a Supabase project. Honest walkthrough with current gaps clearly marked.',
}

export default function SelfHostDocs() {
  return (
    <div>
      <h1>Self-hosting</h1>
      <p className="lead">
        Run the Spanlens proxy + API on your own infra. Keeps all request bodies, traces, and
        encrypted provider keys inside your network. The hosted dashboard at{' '}
        <a href="https://spanlens.io">spanlens.io</a> can then read from your self-hosted
        backend.
      </p>

      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 my-6 not-prose">
        <p className="text-sm font-semibold text-amber-900 mb-1">⚠️ Early access</p>
        <p className="text-sm text-amber-900">
          The proxy server image is public and boots end-to-end (verified 2026-04-22). Rough
          edges: Supabase is required (plain Postgres isn&apos;t supported yet), migrations
          aren&apos;t bundled in the image, and a separate dashboard image isn&apos;t published
          yet. Walk through the steps below; if you hit friction, file a GitHub issue and
          we&apos;ll smooth it.
        </p>
      </div>

      <h2>Who should self-host</h2>
      <ul>
        <li>Compliance requirements (SOC 2, HIPAA, data residency) forbid sending LLM bodies through a third-party SaaS</li>
        <li>You already run Supabase in-house</li>
        <li>You expect traffic volumes where per-request pricing on the hosted plan exceeds the cost of running your own infra</li>
      </ul>

      <h2>What you need</h2>
      <ol>
        <li>
          <strong>A Supabase project.</strong> The free tier on{' '}
          <a href="https://supabase.com" target="_blank" rel="noopener noreferrer">
            supabase.com
          </a>{' '}
          is enough to start; power users can also self-host the full Supabase Docker stack on
          their own Postgres. <strong>Plain Postgres is not supported</strong> — the server
          uses <code>@supabase/supabase-js</code> directly.
        </li>
        <li>
          <strong>The Supabase CLI</strong> locally, to push the schema migrations to your
          Supabase project. Install:{' '}
          <a
            href="https://supabase.com/docs/guides/local-development/cli/getting-started"
            target="_blank"
            rel="noopener noreferrer"
          >
            supabase.com/docs/guides/local-development/cli
          </a>
        </li>
        <li>
          <strong>A 32-byte encryption key.</strong> Used for AES-256-GCM encryption of provider
          keys at rest. Generate with <code>openssl rand -base64 32</code>.{' '}
          <strong>Back this up.</strong> Losing it makes every stored provider key unrecoverable.
        </li>
        <li>
          <strong>Docker</strong>, or anywhere that can run a Node 22 container (Fly.io, Railway,
          ECS, Cloud Run, plain VPS).
        </li>
        <li>
          <strong>A reverse proxy with HTTPS</strong> in front (Caddy, nginx, Cloudflare Tunnel).
          The container speaks HTTP on port 3001.
        </li>
      </ol>

      <h2 id="quickstart">Walkthrough</h2>

      <h3>1. Create a Supabase project</h3>
      <p>
        Sign in at <a href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a>, create a project, wait for it to provision (~1 minute).
      </p>
      <p>
        From <code>Project Settings → API</code>, copy:
      </p>
      <ul>
        <li><strong>Project URL</strong> → will be your <code>SUPABASE_URL</code></li>
        <li><strong>anon public key</strong> → <code>SUPABASE_ANON_KEY</code></li>
        <li><strong>service_role secret key</strong> → <code>SUPABASE_SERVICE_ROLE_KEY</code> (keep this server-side only)</li>
      </ul>

      <h3>2. Apply the schema migrations</h3>
      <p>
        Clone the repo to get the migration SQL files, then link your Supabase project and push:
      </p>
      <CodeBlock language="bash">{`git clone https://github.com/sunes26/Spanlens.git
cd Spanlens

# One-time: log in and link to your Supabase project
supabase login
supabase link --project-ref <your-ref>   # "ref" is the <ref>.supabase.co subdomain

# Apply all migrations
supabase db push`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        ⚠️ <em>Known gap:</em> migrations aren&apos;t bundled in the Docker image yet, so this
        manual step is required. Roadmap: ship a separate <code>spanlens-migrate</code> image
        that applies them for you.
      </p>

      <h3>3. Run the server</h3>
      <CodeBlock language="bash">{`docker run -d --name spanlens \\
  -p 3001:3001 \\
  -e SUPABASE_URL="https://<your-ref>.supabase.co" \\
  -e SUPABASE_ANON_KEY="eyJhbGciOi..." \\
  -e SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..." \\
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \\
  ghcr.io/sunes26/spanlens-server:latest`}</CodeBlock>
      <p>
        Health check: <code>curl http://localhost:3001/health</code> should return <code>{`{"status":"ok"}`}</code>.
      </p>
      <p className="text-sm text-muted-foreground">
        Verified 2026-04-22: the image pulls without auth and boots against fake env vars past
        the DB init check. If you prefer building from source,{' '}
        <code>docker build -f apps/server/Dockerfile -t spanlens-server .</code> from the repo
        root works too.
      </p>

      <h3>4. Point your application at the self-hosted proxy</h3>
      <p>
        Any <a href="/docs/sdk">SDK</a> or <a href="/docs/proxy">direct proxy</a> pattern works —
        replace the default base URL with your self-hosted domain:
      </p>
      <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI({
  baseURL: 'https://spanlens.yourcompany.com/proxy/openai/v1',
})`}</CodeBlock>

      <h2 id="env">Environment variables</h2>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>SUPABASE_URL</code></td>
            <td>Yes</td>
            <td>Your Supabase project URL (<code>https://&lt;ref&gt;.supabase.co</code>)</td>
          </tr>
          <tr>
            <td><code>SUPABASE_SERVICE_ROLE_KEY</code></td>
            <td>Yes</td>
            <td>Service role key — used by the logger to write to <code>requests</code> past RLS</td>
          </tr>
          <tr>
            <td><code>SUPABASE_ANON_KEY</code></td>
            <td>Yes</td>
            <td>Anon key — used for RLS-protected reads from dashboard queries</td>
          </tr>
          <tr>
            <td><code>ENCRYPTION_KEY</code></td>
            <td>Yes</td>
            <td>32-byte base64 key for AES-256-GCM provider-key encryption at rest</td>
          </tr>
          <tr>
            <td><code>PORT</code></td>
            <td>No</td>
            <td>HTTP port (default 3001)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="upgrading">Upgrading</h2>
      <CodeBlock language="bash">{`docker pull ghcr.io/sunes26/spanlens-server:latest
docker restart spanlens

# If new migrations shipped, re-pull the repo and push:
cd Spanlens && git pull && supabase db push`}</CodeBlock>
      <p>
        We ship semver tags (<code>ghcr.io/sunes26/spanlens-server:0.3.0</code>). Pin a tag in
        production and upgrade deliberately.
      </p>

      <h2 id="dashboard">Dashboard access</h2>
      <p>
        Two options today:
      </p>
      <ul>
        <li>
          <strong>Use the hosted dashboard at <a href="https://spanlens.io">spanlens.io</a></strong>{' '}
          pointed at your self-hosted backend. Log in, then override the API base URL in your
          browser via <a href="/settings">/settings</a>.
        </li>
        <li>
          <strong>Run the web app locally yourself</strong> — clone the repo and <code>pnpm --filter web dev</code> with <code>NEXT_PUBLIC_API_URL</code> pointed at your backend.
        </li>
      </ul>
      <p className="text-sm text-muted-foreground">
        ⚠️ <em>Known gap:</em> a separate <code>ghcr.io/sunes26/spanlens-web</code> image is
        planned but not yet published. Earlier versions of these docs claimed it existed — that
        was aspirational, not reality.
      </p>

      <h2 id="backups">Backups</h2>
      <p>
        Everything persists in Postgres. Standard <code>pg_dump</code> against your Supabase DB
        covers you. The critical thing to back up outside the DB is{' '}
        <code>ENCRYPTION_KEY</code> — without it, encrypted provider keys are unrecoverable.
        Store it in your secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp
        Vault) with a rotation schedule you can follow.
      </p>

      <h2>Known gaps & roadmap</h2>
      <p>Honest current state of self-host:</p>
      <ul>
        <li>
          <strong>Plain Postgres isn&apos;t supported.</strong> The server imports{' '}
          <code>@supabase/supabase-js</code> directly. Moving to a thin Postgres abstraction is
          on the roadmap but not a launch blocker.
        </li>
        <li>
          <strong>Migrations ship separately</strong> (via Supabase CLI + repo clone). A bundled{' '}
          <code>spanlens-migrate</code> tool is a post-launch priority.
        </li>
        <li>
          <strong>No <code>spanlens-web</code> Docker image yet.</strong> Use the hosted
          dashboard or run from source.
        </li>
        <li>
          <strong>Operational tooling is minimal.</strong> No built-in monitoring, no migration
          rollback tool, no backup cron. DIY for now.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Found a problem?{' '}
        <a
          href="https://github.com/sunes26/Spanlens/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open an issue on GitHub
        </a>
        .
      </p>
    </div>
  )
}
