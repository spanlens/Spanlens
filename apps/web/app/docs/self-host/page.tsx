export const metadata = {
  title: 'Self-hosting · Spanlens Docs',
  description: 'Run Spanlens on your own infra with Docker. Your data stays yours.',
}

export default function SelfHostDocs() {
  return (
    <div>
      <h1>Self-hosting</h1>
      <p className="lead">
        Run the Spanlens proxy + dashboard on your own infra. One Docker image, a Supabase (or plain
        Postgres) database, and you&apos;re done. All request bodies, traces, and keys stay inside
        your network.
      </p>

      <h2>Who should self-host</h2>
      <ul>
        <li>Compliance requirements (SOC 2, HIPAA, data residency)</li>
        <li>You already run Supabase / Postgres in-house</li>
        <li>You want the cloud version features at higher scale without per-request pricing</li>
      </ul>

      <h2 id="quickstart">Quick start</h2>
      <pre><code>{`docker run -d --name spanlens \\
  -p 3001:3001 \\
  -e SUPABASE_URL=https://xxxx.supabase.co \\
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \\
  -e ENCRYPTION_KEY=$(openssl rand -base64 32) \\
  ghcr.io/sunes26/spanlens-server:latest`}</code></pre>

      <p>
        That&apos;s it — the proxy is now live at <code>http://localhost:3001/proxy/*</code>.
      </p>

      <h2 id="prerequisites">Prerequisites</h2>
      <ol>
        <li>
          <strong>Postgres 14+ or Supabase project.</strong> Run the migrations from{' '}
          <a href="https://github.com/sunes26/Spanlens/tree/main/supabase/migrations" target="_blank" rel="noopener noreferrer">
            supabase/migrations
          </a>{' '}
          against it.
        </li>
        <li>
          <strong>A 32-byte encryption key.</strong> Used to encrypt provider keys at rest.
          Generate with <code>openssl rand -base64 32</code>. <strong>Back it up</strong> — losing it
          means you can&apos;t decrypt any stored provider keys.
        </li>
        <li>
          <strong>A reverse proxy with HTTPS</strong> (Caddy, nginx, Cloudflare Tunnel). The container
          speaks HTTP on port 3001.
        </li>
      </ol>

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
            <td>Your Supabase project URL (or self-hosted PostgREST endpoint)</td>
          </tr>
          <tr>
            <td><code>SUPABASE_SERVICE_ROLE_KEY</code></td>
            <td>Yes</td>
            <td>Service role key (for RLS-bypassing inserts on the <code>requests</code> table)</td>
          </tr>
          <tr>
            <td><code>SUPABASE_ANON_KEY</code></td>
            <td>Yes</td>
            <td>Anon key (for RLS-protected reads)</td>
          </tr>
          <tr>
            <td><code>ENCRYPTION_KEY</code></td>
            <td>Yes</td>
            <td>32-byte base64 key for AES-256-GCM provider-key encryption</td>
          </tr>
          <tr>
            <td><code>PORT</code></td>
            <td>No</td>
            <td>HTTP port (default 3001)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="docker-compose">Docker Compose</h2>
      <pre><code>{`# docker-compose.yml
services:
  spanlens:
    image: ghcr.io/sunes26/spanlens-server:latest
    ports:
      - "3001:3001"
    environment:
      SUPABASE_URL: \${SUPABASE_URL}
      SUPABASE_SERVICE_ROLE_KEY: \${SUPABASE_SERVICE_ROLE_KEY}
      SUPABASE_ANON_KEY: \${SUPABASE_ANON_KEY}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3`}</code></pre>

      <h2 id="pointing-sdk">Pointing clients at your self-hosted instance</h2>

      <h3>With <code>@spanlens/sdk</code></h3>
      <pre><code>{`import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI({
  baseURL: 'https://spanlens.yourcompany.com/proxy/openai/v1',
})`}</code></pre>

      <h3>With any other client</h3>
      <p>
        Just replace <code>spanlens-server.vercel.app</code> with your domain in the{' '}
        <a href="/docs/proxy">direct proxy</a> examples.
      </p>

      <h2 id="upgrading">Upgrading</h2>
      <pre><code>{`docker pull ghcr.io/sunes26/spanlens-server:latest
docker restart spanlens

# Apply new DB migrations (if any):
supabase db push --db-url "$DATABASE_URL"`}</code></pre>

      <p>
        We ship semver-tagged images (<code>ghcr.io/sunes26/spanlens-server:0.3.0</code>). Pin to a
        specific tag in production and upgrade on your own schedule.
      </p>

      <h2 id="dashboard">Dashboard</h2>
      <p>
        The <code>spanlens-server</code> image includes only the proxy + REST API. To run the
        dashboard UI in-house, use <code>ghcr.io/sunes26/spanlens-web:latest</code> and point it at
        your server via <code>NEXT_PUBLIC_API_URL</code>. Or use the hosted dashboard at{' '}
        <a href="https://spanlens.io">spanlens.io</a> — it can connect to a self-hosted backend.
      </p>

      <h2 id="backups">Backups</h2>
      <p>
        Everything lives in Postgres. Standard <code>pg_dump</code> backups cover you. The one thing
        you <em>must</em> back up separately is <code>ENCRYPTION_KEY</code> — without it, encrypted
        provider keys in the DB are unrecoverable.
      </p>

      <hr />

      <p className="text-sm text-muted-foreground">
        Questions? Open an issue on{' '}
        <a href="https://github.com/sunes26/Spanlens" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </div>
  )
}
