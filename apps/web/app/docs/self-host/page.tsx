import { openGraphFor } from '@/lib/page-metadata'
import { CodeBlock } from '../_components/code-block'
import { SelfHostArchitectureDiagram } from '../_components/diagrams'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/self-host' },
  openGraph: openGraphFor('/docs/self-host'),
  title: 'Self-hosting · Spanlens Docs',
  description:
    'Run the full Spanlens stack, dashboard and proxy, on your own infrastructure with one Docker command and a Supabase project. Your request data stays put.',
}

export default function SelfHostDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Self-hosting</h1>
      <p className="lead">
        Run the Spanlens proxy, API, and dashboard on your own infra. Keeps all request bodies,
        traces, and encrypted provider keys inside your network.
      </p>

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
          is enough to start. <strong>Plain Postgres is not supported</strong>, the server
          uses <code>@supabase/supabase-js</code> directly. Everything Spanlens stores lives in
          this one database, request logs included.
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
          The containers speak HTTP on ports 3000 (web) and 3001 (server).
        </li>
      </ol>

      <h2 id="quickstart">Walkthrough</h2>

      <h3>Option A, docker-compose (recommended)</h3>
      <p>
        The easiest way to self-host. Pulls pre-built images from GHCR and runs both the{' '}
        <strong>dashboard (web)</strong> and the <strong>proxy / API server</strong> together.
        No source code needed.
      </p>

      <SelfHostArchitectureDiagram />

      <h4>1. Apply the database schema</h4>
      <p>
        Open your Supabase project → <strong>SQL Editor → New query</strong>, paste the contents
        of{' '}
        <a
          href="https://raw.githubusercontent.com/spanlens/Spanlens/main/supabase/init.sql"
          target="_blank"
          rel="noopener noreferrer"
        >
          supabase/init.sql
        </a>
        , and click <strong>Run</strong>. No CLI needed. It creates every table the stack uses,
        the <code>requests</code> log included.
      </p>
      <p className="text-sm text-muted-foreground">
        Prefer the terminal? Use psql instead:
      </p>
      <CodeBlock language="bash">{`curl -o init.sql https://raw.githubusercontent.com/spanlens/Spanlens/main/supabase/init.sql
psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" -f init.sql`}</CodeBlock>

      <h4>2. Create a <code>.env</code> file</h4>
      <CodeBlock language="bash">{`# Required
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # keep server-side only
ENCRYPTION_KEY=$(openssl rand -base64 32) # back this up, see below
CRON_SECRET=$(openssl rand -hex 16)

# Pooled Postgres connection, used only for the requests log.
# Connect > Direct > Transaction pooler. Port 6543, not 5432. Copy the host
# from that dialog: the shared pooler hostname carries a numbered prefix
# that the region does not tell you. It is a full database credential, so
# never log it.
SUPABASE_DB_POOLER_URL=postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres

# Optional, for invite emails
# WEB_URL=https://your-domain.com
# RESEND_API_KEY=re_...
# RESEND_FROM=Spanlens <no-reply@your-domain.com>`}</CodeBlock>

      <h4>3. Verify your env file before starting</h4>
      <p>
        Bad <code>ENCRYPTION_KEY</code> length silently corrupts provider keys at decrypt time
        (the failure surfaces hours later as &ldquo;wrong API key&rdquo; from the upstream
        provider). A missing <code>WEB_URL</code> sends invite emails pointing at{' '}
        <code>localhost</code>. Run <code>check:env</code> once before you start the stack and
        get an actionable report instead of debugging at runtime:
      </p>
      <CodeBlock language="bash">{`# From a clone of the repo:
pnpm install
pnpm check:env

# Or one-shot via npx, no clone:
npx -y tsx https://raw.githubusercontent.com/spanlens/Spanlens/main/apps/server/scripts/check-env.ts`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Exit 0 means every required variable is present and valid, and that both the Supabase
        HTTP API and the Postgres pooler answered. Exit 1 means something is wrong, with the
        exact fix command in the output. <code>--json</code> for CI pipelines,{' '}
        <code>--quiet</code> to show only warnings and errors.
      </p>

      <h4>4. Start</h4>
      <CodeBlock language="bash">{`curl -o docker-compose.yml https://raw.githubusercontent.com/spanlens/Spanlens/main/docker-compose.yml
docker compose up -d`}</CodeBlock>
      <ul>
        <li>Dashboard: <code>http://localhost:3000</code></li>
        <li>API / proxy: <code>http://localhost:3001</code></li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Two containers come up, <code>web</code> and <code>server</code>. There is no database
        container. Postgres is your Supabase project, reached over the network, which is also
        why the compose file declares no volumes. The web container waits for the
        server&apos;s healthcheck, then reads <code>NEXT_PUBLIC_*</code> from env at startup and
        patches them into the pre-built bundle, so no rebuild is needed.
      </p>

      <h3>Option B, server only</h3>
      <p>
        If you run the dashboard separately (at{' '}
        <a href="https://spanlens.io">spanlens.io</a> or your own Next.js deployment), you can
        run just the API server.
      </p>

      <h4>1. Create a Supabase project</h4>
      <p>
        Sign in at <a href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a>,
        create a project, wait for it to provision (~1 minute).
        From <strong>Project Settings → API</strong>, copy:
      </p>
      <ul>
        <li><strong>Project URL</strong> → <code>SUPABASE_URL</code></li>
        <li><strong>anon public key</strong> → <code>SUPABASE_ANON_KEY</code></li>
        <li><strong>service_role secret key</strong> → <code>SUPABASE_SERVICE_ROLE_KEY</code> (server-side only)</li>
      </ul>
      <p>
        Then open <strong>Project Settings → Database → Connection string</strong> and copy the{' '}
        <strong>Transaction pooler</strong> string (port 6543) into{' '}
        <code>SUPABASE_DB_POOLER_URL</code>. The server reads the request log over that
        connection.
      </p>

      <h4>2. Apply the schema</h4>
      <p>
        Same as Option A step 1, open <strong>SQL Editor → New query</strong>, paste{' '}
        <a
          href="https://raw.githubusercontent.com/spanlens/Spanlens/main/supabase/init.sql"
          target="_blank"
          rel="noopener noreferrer"
        >
          init.sql
        </a>
        , run.
      </p>

      <h4>3. Run the server</h4>
      <CodeBlock language="bash">{`docker run -d --name spanlens-server \\
  -p 3001:3001 \\
  -e SUPABASE_URL="https://<ref>.supabase.co" \\
  -e SUPABASE_ANON_KEY="eyJ..." \\
  -e SUPABASE_SERVICE_ROLE_KEY="eyJ..." \\
  -e SUPABASE_DB_POOLER_URL="postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres" \\
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \\
  -e CRON_SECRET="$(openssl rand -hex 16)" \\
  ghcr.io/spanlens/spanlens-server:latest`}</CodeBlock>
      <CodeBlock language="bash">{`curl http://localhost:3001/health
# {"status":"ok"}`}</CodeBlock>

      <h4>4. Point your SDK at the self-hosted proxy</h4>
      <p>
        <strong>Option 1, the CLI wizard</strong> (automates the step below):
      </p>
      <CodeBlock language="bash">{`npx @spanlens/cli@latest init --server-url https://spanlens.yourcompany.com`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Validates your key against your server, patches existing{' '}
        <code>new OpenAI()</code> / <code>new Anthropic()</code> calls, and writes{' '}
        <code>SPANLENS_BASE_URL</code> to <code>.env.local</code> automatically.
      </p>
      <p>
        <strong>Option 2, by hand</strong>:
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
            <td>Service role key, used by the server to write to Supabase past RLS (orgs, projects, traces, etc.)</td>
          </tr>
          <tr>
            <td><code>SUPABASE_ANON_KEY</code></td>
            <td>Yes</td>
            <td>Anon key, used for RLS-protected reads from dashboard queries</td>
          </tr>
          <tr>
            <td><code>SUPABASE_DB_POOLER_URL</code></td>
            <td>Yes</td>
            <td>
              Pooled connection string for the <code>requests</code> table. Use the transaction
              pooler on port <strong>6543</strong>, not the direct port 5432. Session mode pins
              one backend per client, and a horizontally scaled server runs out of those
              quickly. Treat the string as a full database credential.
            </td>
          </tr>
          <tr>
            <td><code>ENCRYPTION_KEY</code></td>
            <td>Yes</td>
            <td>32-byte base64 key for AES-256-GCM provider-key encryption at rest</td>
          </tr>
          <tr>
            <td><code>NEXT_PUBLIC_SUPABASE_URL</code></td>
            <td>Yes (web only)</td>
            <td>Same as <code>SUPABASE_URL</code>, exposed to the browser for Supabase Auth</td>
          </tr>
          <tr>
            <td><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></td>
            <td>Yes (web only)</td>
            <td>Same as <code>SUPABASE_ANON_KEY</code>, exposed to the browser for Supabase Auth</td>
          </tr>
          <tr>
            <td><code>WEB_URL</code></td>
            <td>Yes (multi-user)</td>
            <td>
              Base URL of your dashboard (e.g. <code>https://spanlens.example.com</code>).
              Used to build the accept link in invitation emails. Falls back to{' '}
              <code>http://localhost:3000</code> if unset, fine for local dev,
              broken in production.
            </td>
          </tr>
          <tr>
            <td><code>PG_POOL_MAX</code></td>
            <td>No</td>
            <td>
              Connections held per server instance, default 2. Raising it multiplies across
              instances instead of adding throughput, so leave it alone unless you run one
              server of a fixed size.
            </td>
          </tr>
          <tr>
            <td><code>PG_STATEMENT_TIMEOUT_MS</code></td>
            <td>No</td>
            <td>
              Server-side statement timeout, default 60000. Caps a runaway dashboard query so
              it cannot starve the proxy&apos;s auth path, which shares the database.
            </td>
          </tr>
          <tr>
            <td><code>RESEND_API_KEY</code></td>
            <td>No</td>
            <td>
              Resend API token for outbound email (invitations). When unset, emails are skipped
              silently and the invite endpoint returns the accept link as{' '}
              <code>devAcceptUrl</code> so an admin can hand-deliver it.
            </td>
          </tr>
          <tr>
            <td><code>RESEND_FROM</code></td>
            <td>No</td>
            <td>
              Sender header. Default <code>Spanlens &lt;notifications@spanlens.io&gt;</code>.
              Override with a verified sender on your own domain to avoid spam filters.
            </td>
          </tr>
          <tr>
            <td><code>PORT</code></td>
            <td>No</td>
            <td>HTTP port for the server (default 3001)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="upgrading">Upgrading</h2>
      <CodeBlock language="bash">{`# Pull the latest images and restart
docker compose pull && docker compose up -d

# If a new release added migrations, re-run init.sql in SQL Editor
# (all statements use CREATE IF NOT EXISTS / ALTER IF NOT EXISTS, safe to re-run)`}</CodeBlock>
      <p>
        We ship semver tags (<code>ghcr.io/spanlens/spanlens-server:0.3.0</code>,{' '}
        <code>ghcr.io/spanlens/spanlens-web:0.3.0</code>). Pin a tag in production and upgrade
        deliberately.
      </p>
      <p>
        <strong>Supported architectures.</strong> Both images are published as
        multi-arch manifests for <code>linux/amd64</code> and <code>linux/arm64</code>, so
        Docker pulls the right variant for your host automatically. M1 / M2 / M3
        Macs and AWS Graviton instances run the native ARM binary; x86 hosts run
        the amd64 binary. No platform flag needed.
      </p>

      <h3 id="upgrade-from-clickhouse">Upgrading a stack that ran a ClickHouse container</h3>
      <p>
        Deployments pulled before August 2026 ran a third container and kept the request log
        inside it. Current releases keep <code>requests</code> in the same Postgres database as
        everything else. To move an existing stack across:
      </p>
      <ol>
        <li>Re-run <code>init.sql</code> so the <code>requests</code> table exists in Postgres.</li>
        <li>
          Drop <code>CLICKHOUSE_URL</code>, <code>CLICKHOUSE_USER</code>,{' '}
          <code>CLICKHOUSE_PASSWORD</code>, and <code>CLICKHOUSE_DB</code> from your{' '}
          <code>.env</code>, and add <code>SUPABASE_DB_POOLER_URL</code>.
        </li>
        <li>
          Fetch the current <code>docker-compose.yml</code> and run{' '}
          <code>docker compose up -d --remove-orphans</code>. Nothing references the old
          container any more, and that flag is what actually stops it.
        </li>
        <li>
          Old rows are not copied for you. If you want the history, export it from ClickHouse
          and insert it into <code>requests</code> before you delete the container and its
          volumes. New calls land in Postgres from the moment the server restarts.
        </li>
      </ol>

      <h2 id="dashboard">Dashboard options</h2>
      <ul>
        <li>
          <strong>docker-compose (recommended)</strong>, pulls{' '}
          <code>ghcr.io/spanlens/spanlens-web:latest</code> alongside the server. Full
          self-hosting with no source required. See <a href="#quickstart">Option A</a> above.
        </li>
        <li>
          <strong>Use the hosted dashboard at <a href="https://spanlens.io">spanlens.io</a></strong>{' '}
          pointed at your self-hosted backend. Log in, then override the API base URL in{' '}
          <a href="/settings">Settings</a>.
        </li>
        <li>
          <strong>Build from source</strong>, clone the repo and{' '}
          <code>docker compose up -d --build</code> to build both images locally.
        </li>
      </ul>

      <h2 id="backups">Backups</h2>
      <p>
        One database and one secret. Everything Spanlens writes, from organizations and
        encrypted provider keys down to the last logged token count, is in your Supabase
        project, so a single <code>pg_dump</code> covers all of it.
      </p>
      <ul>
        <li>
          <strong>Supabase Postgres.</strong> Managed projects take their own daily backups
          (Supabase Pro keeps 7 days of them). Add your own logical dumps on top so you hold a
          copy outside the provider. The commands are on the{' '}
          <a href="/docs/self-host/backup">backup and restore</a> page.
        </li>
        <li>
          <strong>ENCRYPTION_KEY</strong>, the one thing that lives outside every database.
          Keep it in your secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp
          Vault). Without it the encrypted provider keys inside a dump are just noise.
        </li>
      </ul>

      <h2>Known limitations</h2>
      <ul>
        <li>
          <strong>Plain Postgres isn&apos;t supported.</strong> The server imports{' '}
          <code>@supabase/supabase-js</code> directly. Moving to a thin abstraction layer is on
          the roadmap but not a launch blocker.
        </li>
        <li>
          <strong>The pooled connection is not optional.</strong> Request-log reads go through{' '}
          <code>SUPABASE_DB_POOLER_URL</code> rather than PostgREST, because PostgREST cannot
          express percentiles, <code>FILTER</code> clauses, or a cursor for large exports.
          Leave the variable unset and the analytics pages fail.
        </li>
        <li>
          <strong>Partitions need a nudge each month.</strong> <code>requests</code> is
          partitioned by month. Call <code>SELECT ensure_requests_partitions(3);</code> on a
          schedule so the next few months always exist. Nothing breaks if you forget, since
          rows land in the <code>requests_default</code> catch-all partition, but moving them
          back out later is a chore one cron line would have saved you.
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
          href="https://github.com/spanlens/Spanlens/issues"
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
