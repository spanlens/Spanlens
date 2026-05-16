import { CodeBlock } from '../_components/code-block'

export const metadata = {
  title: 'Self-hosting · Spanlens Docs',
  description:
    'Run the full Spanlens stack (dashboard + proxy) on your own infra with a Supabase project.',
}

export default function SelfHostDocs() {
  return (
    <div>
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
          is enough to start. <strong>Plain Postgres is not supported</strong> — the server
          uses <code>@supabase/supabase-js</code> directly.
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

      <h3>Option A — docker-compose (recommended)</h3>
      <p>
        The easiest way to self-host. Pulls pre-built images from GHCR and runs both the{' '}
        <strong>dashboard (web)</strong> and the <strong>proxy / API server</strong> together.
        No source code needed.
      </p>

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
        , and click <strong>Run</strong>. No CLI needed.
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
ENCRYPTION_KEY=$(openssl rand -base64 32) # back this up — see below
CRON_SECRET=$(openssl rand -hex 16)

# ClickHouse — request logs are stored here, NOT Supabase
# The bundled docker-compose ships a clickhouse container; these defaults
# match it. Point at ClickHouse Cloud (or any managed ClickHouse) for prod.
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_USER=spanlens
CLICKHOUSE_PASSWORD=$(openssl rand -hex 16)
CLICKHOUSE_DB=spanlens

# Optional — for invite emails
# WEB_URL=https://your-domain.com
# RESEND_API_KEY=re_...
# RESEND_FROM=Spanlens <no-reply@your-domain.com>`}</CodeBlock>

      <h4>3. Start</h4>
      <CodeBlock language="bash">{`curl -o docker-compose.yml https://raw.githubusercontent.com/spanlens/Spanlens/main/docker-compose.yml
docker compose up -d`}</CodeBlock>
      <ul>
        <li>Dashboard: <code>http://localhost:3000</code></li>
        <li>API / proxy: <code>http://localhost:3001</code></li>
        <li>ClickHouse (analytics, internal): <code>http://localhost:8123</code></li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Three containers come up: <code>web</code>, <code>server</code>, and{' '}
        <code>clickhouse</code>. The server waits for ClickHouse&apos;s healthcheck before
        accepting traffic. The web container reads <code>NEXT_PUBLIC_*</code> from env at
        startup and patches them into the pre-built bundle automatically — no rebuild needed.
      </p>

      <h4>4. Apply the ClickHouse schema</h4>
      <p>
        The <code>requests</code> table needs to exist before the server can write logs. Run
        the migration script once after the ClickHouse container is healthy:
      </p>
      <CodeBlock language="bash">{`# Clone or fetch the migrations folder
curl -L https://github.com/spanlens/Spanlens/archive/main.tar.gz | tar xz --strip-components=1 spanlens-main/clickhouse

# Apply (idempotent — re-running is safe)
CLICKHOUSE_URL=http://localhost:8123 \\
CLICKHOUSE_USER=spanlens CLICKHOUSE_PASSWORD=<password> CLICKHOUSE_DB=spanlens \\
  npx -y tsx clickhouse/apply.ts`}</CodeBlock>

      <h3>Option B — server only</h3>
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

      <h4>2. Apply the schema</h4>
      <p>
        Same as Option A step 1 — open <strong>SQL Editor → New query</strong>, paste{' '}
        <a
          href="https://raw.githubusercontent.com/spanlens/Spanlens/main/supabase/init.sql"
          target="_blank"
          rel="noopener noreferrer"
        >
          init.sql
        </a>
        , run.
      </p>

      <h4>3. Provision ClickHouse</h4>
      <p>
        Request logs live in ClickHouse, not Supabase. Two options:
      </p>
      <ul>
        <li>
          <strong>ClickHouse Cloud</strong> (recommended for production) — sign up at{' '}
          <a href="https://clickhouse.cloud" target="_blank" rel="noopener noreferrer">
            clickhouse.cloud
          </a>
          , create a service, copy the HTTPS endpoint + credentials.
        </li>
        <li>
          <strong>Self-hosted ClickHouse</strong> — run{' '}
          <code>clickhouse/clickhouse-server:24.10-alpine</code> with persistent volumes (see
          the bundled <code>docker-compose.yml</code> for the canonical setup).
        </li>
      </ul>
      <p>Apply the schema before starting the server:</p>
      <CodeBlock language="bash">{`curl -L https://github.com/spanlens/Spanlens/archive/main.tar.gz | tar xz --strip-components=1 spanlens-main/clickhouse

CLICKHOUSE_URL=https://<host>:8443 \\
CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=<password> CLICKHOUSE_DB=spanlens \\
  npx -y tsx clickhouse/apply.ts`}</CodeBlock>

      <h4>4. Run the server</h4>
      <CodeBlock language="bash">{`docker run -d --name spanlens-server \\
  -p 3001:3001 \\
  -e SUPABASE_URL="https://<ref>.supabase.co" \\
  -e SUPABASE_ANON_KEY="eyJ..." \\
  -e SUPABASE_SERVICE_ROLE_KEY="eyJ..." \\
  -e CLICKHOUSE_URL="https://<host>:8443" \\
  -e CLICKHOUSE_USER="default" \\
  -e CLICKHOUSE_PASSWORD="<password>" \\
  -e CLICKHOUSE_DB="spanlens" \\
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \\
  -e CRON_SECRET="$(openssl rand -hex 16)" \\
  ghcr.io/spanlens/spanlens-server:latest`}</CodeBlock>
      <CodeBlock language="bash">{`curl http://localhost:3001/health
# {"status":"ok"}`}</CodeBlock>

      <h4>4. Point your SDK at the self-hosted proxy</h4>
      <p>
        <strong>Option 1 — CLI wizard</strong> (automates the step below):
      </p>
      <CodeBlock language="bash">{`npx @spanlens/cli@latest init --server-url https://spanlens.yourcompany.com`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Validates your key against your server, patches existing{' '}
        <code>new OpenAI()</code> / <code>new Anthropic()</code> calls, and writes{' '}
        <code>SPANLENS_BASE_URL</code> to <code>.env.local</code> automatically.
      </p>
      <p>
        <strong>Option 2 — manual</strong>:
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
            <td>Service role key — used by the server to write to Supabase past RLS (orgs, projects, traces, etc.)</td>
          </tr>
          <tr>
            <td><code>SUPABASE_ANON_KEY</code></td>
            <td>Yes</td>
            <td>Anon key — used for RLS-protected reads from dashboard queries</td>
          </tr>
          <tr>
            <td><code>CLICKHOUSE_URL</code></td>
            <td>Yes</td>
            <td>
              HTTPS endpoint of your ClickHouse cluster (e.g.{' '}
              <code>https://&lt;host&gt;:8443</code> for Cloud, or{' '}
              <code>http://clickhouse:8123</code> for the bundled container).
            </td>
          </tr>
          <tr>
            <td><code>CLICKHOUSE_USER</code></td>
            <td>Yes</td>
            <td>ClickHouse user (default <code>default</code> for Cloud, <code>spanlens</code> for the bundled container)</td>
          </tr>
          <tr>
            <td><code>CLICKHOUSE_PASSWORD</code></td>
            <td>Yes</td>
            <td>ClickHouse password</td>
          </tr>
          <tr>
            <td><code>CLICKHOUSE_DB</code></td>
            <td>Yes</td>
            <td>Database name. Default <code>spanlens</code>. The <code>requests</code> table lives here.</td>
          </tr>
          <tr>
            <td><code>ENCRYPTION_KEY</code></td>
            <td>Yes</td>
            <td>32-byte base64 key for AES-256-GCM provider-key encryption at rest</td>
          </tr>
          <tr>
            <td><code>NEXT_PUBLIC_SUPABASE_URL</code></td>
            <td>Yes (web only)</td>
            <td>Same as <code>SUPABASE_URL</code> — exposed to the browser for Supabase Auth</td>
          </tr>
          <tr>
            <td><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></td>
            <td>Yes (web only)</td>
            <td>Same as <code>SUPABASE_ANON_KEY</code> — exposed to the browser for Supabase Auth</td>
          </tr>
          <tr>
            <td><code>WEB_URL</code></td>
            <td>Yes (multi-user)</td>
            <td>
              Base URL of your dashboard (e.g. <code>https://spanlens.example.com</code>).
              Used to build the accept link in invitation emails. Falls back to{' '}
              <code>http://localhost:3000</code> if unset — fine for local dev,
              broken in production.
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
# (all statements use CREATE IF NOT EXISTS / ALTER IF NOT EXISTS — safe to re-run)`}</CodeBlock>
      <p>
        We ship semver tags (<code>ghcr.io/spanlens/spanlens-server:0.3.0</code>,{' '}
        <code>ghcr.io/spanlens/spanlens-web:0.3.0</code>). Pin a tag in production and upgrade
        deliberately.
      </p>

      <h2 id="dashboard">Dashboard options</h2>
      <ul>
        <li>
          <strong>docker-compose (recommended)</strong> — pulls{' '}
          <code>ghcr.io/spanlens/spanlens-web:latest</code> alongside the server. Full
          self-hosting with no source required. See <a href="#quickstart">Option A</a> above.
        </li>
        <li>
          <strong>Use the hosted dashboard at <a href="https://spanlens.io">spanlens.io</a></strong>{' '}
          pointed at your self-hosted backend. Log in, then override the API base URL in{' '}
          <a href="/settings">Settings</a>.
        </li>
        <li>
          <strong>Build from source</strong> — clone the repo and{' '}
          <code>docker compose up -d --build</code> to build both images locally.
        </li>
      </ul>

      <h2 id="backups">Backups</h2>
      <p>
        Two data stores, two backup strategies:
      </p>
      <ul>
        <li>
          <strong>Supabase Postgres</strong> — holds the transactional crown jewels (orgs,
          projects, provider keys, subscriptions, prompts, evals, traces). Standard{' '}
          <code>pg_dump</code> against your Supabase DB covers you. Catastrophic if lost.
        </li>
        <li>
          <strong>ClickHouse</strong> — holds request logs only. Append-only telemetry. Options
          in order of effort:
          <ol>
            <li>
              <strong>ClickHouse Cloud automatic backups</strong> (1-day RPO, same region) — set
              and forget.
            </li>
            <li>
              <strong>BACKUP TO S3</strong> on a schedule — <code>BACKUP TABLE requests TO
              S3(&apos;s3://bucket/path&apos;)</code>.
            </li>
            <li>
              <strong>Accept the loss</strong> — historical logs are observability, not
              source-of-truth. Loss costs you the past N days of dashboards, not customer trust.
            </li>
          </ol>
        </li>
        <li>
          <strong>ENCRYPTION_KEY</strong> (outside any DB) — back this up in your secret
          manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault). Without it,
          encrypted provider keys are unrecoverable.
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
          <strong>ClickHouse is required.</strong> The server&apos;s logger and analytics
          helpers all assume a reachable ClickHouse instance. A Postgres-only mode is not
          provided — the dual-store architecture is intentional (OLAP workload, columnar
          storage, faster aggregates).
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
