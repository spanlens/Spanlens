import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/self-host/backup' },
  title: 'Backup & restore · Spanlens Docs',
  description:
    'Backup and restore runbook for self-hosted Spanlens: pg_dump the Supabase Postgres, dump the ClickHouse requests log, snapshot the Docker volumes, and back up ENCRYPTION_KEY separately.',
}

export default function SelfHostBackupPage() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Backup &amp; restore</h1>
      <p className="lead">
        A self-hosted Spanlens deployment keeps its data in two places. This page is the
        operator runbook for backing both of them up, restoring from those backups, and the
        one secret that lives outside every database and must be backed up on its own.
      </p>

      <h2>Two datastores, two backup strategies</h2>
      <p>
        Spanlens splits its data across two stores on purpose (see{' '}
        <a href="/docs/self-host">Self-hosting</a> and{' '}
        <a href="/docs/concepts/data-model">Data model</a>). Both must be backed up.
      </p>
      <table>
        <thead>
          <tr>
            <th>Store</th>
            <th>What lives there</th>
            <th>If you lose it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Supabase Postgres</strong>
            </td>
            <td>
              Organizations, projects, API keys, encrypted provider keys, traces, spans,
              prompts, evals, subscriptions/billing. The transactional source of truth.
            </td>
            <td>Catastrophic. Accounts, keys, and configuration are gone.</td>
          </tr>
          <tr>
            <td>
              <strong>ClickHouse</strong>
            </td>
            <td>
              The <code>requests</code> log only (every proxied LLM call: tokens, cost,
              latency, bodies). Append-only observability telemetry.
            </td>
            <td>
              Recoverable in spirit. You lose historical dashboards and analytics, not
              accounts or keys.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Note the split in the bundled <code>docker-compose.yml</code>: it runs three services,{' '}
        <code>web</code>, <code>server</code>, and <code>clickhouse</code>.{' '}
        <strong>There is no Postgres container.</strong> Postgres is your Supabase project,
        managed separately, so its backup runs against the Supabase connection string rather
        than a local container.
      </p>

      <h2 id="postgres">Postgres (Supabase)</h2>
      <p>
        Managed Supabase projects have their own automated backups (Project Settings &rarr;
        Database &rarr; Backups). Take your own logical dumps on top of that so you hold a copy
        outside the provider and can restore into any Postgres 17 target.
      </p>

      <h3>Back up with pg_dump</h3>
      <p>
        Grab the connection string from <strong>Project Settings &rarr; Database</strong> (use
        the direct connection, port <code>5432</code>). The custom format (<code>-Fc</code>)
        restores selectively and compresses well.
      </p>
      <pre>{`# Full logical dump, custom format
pg_dump \\
  "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \\
  --format=custom --no-owner --no-privileges \\
  --file=spanlens-pg-$(date +%F).dump

# Plain SQL alternative (human-readable, larger)
pg_dump "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \\
  --no-owner --no-privileges \\
  > spanlens-pg-$(date +%F).sql`}</pre>
      <p className="text-sm text-muted-foreground">
        <code>--no-owner --no-privileges</code> keeps the dump portable across projects (the
        Supabase-managed roles differ per project). If you self-host Postgres elsewhere, dump
        with <code>docker exec &lt;your-postgres-container&gt; pg_dump ...</code> instead. The
        bundled compose file does not ship a Postgres container.
      </p>

      <h3 id="restore-postgres">Restore Postgres</h3>
      <p>
        Restore a custom-format dump with <code>pg_restore</code>; restore a plain SQL dump
        with <code>psql</code>. Point at a fresh Supabase project (or any empty Postgres 17
        database).
      </p>
      <pre>{`# Restore a custom-format (.dump) backup
pg_restore \\
  --dbname="postgresql://postgres:<password>@db.<new-ref>.supabase.co:5432/postgres" \\
  --no-owner --no-privileges --clean --if-exists \\
  spanlens-pg-2026-07-01.dump

# Restore a plain SQL (.sql) backup
psql "postgresql://postgres:<password>@db.<new-ref>.supabase.co:5432/postgres" \\
  -f spanlens-pg-2026-07-01.sql`}</pre>
      <p>
        After restoring into a brand-new project, re-run{' '}
        <a
          href="https://raw.githubusercontent.com/spanlens/Spanlens/main/supabase/init.sql"
          target="_blank"
          rel="noopener noreferrer"
        >
          supabase/init.sql
        </a>{' '}
        first if the schema is not already present (all statements are{' '}
        <code>CREATE IF NOT EXISTS</code> / <code>ALTER IF NOT EXISTS</code>, so re-running is
        safe), then restore the data dump on top.
      </p>

      <h3 id="encryption-key">The ENCRYPTION_KEY is not in the dump you can rely on</h3>
      <p>
        Provider keys (your real OpenAI / Anthropic / Gemini keys) are stored encrypted with
        AES-256-GCM under <code>ENCRYPTION_KEY</code>. The encrypted ciphertext travels inside
        the Postgres dump, but it is <strong>useless without the exact same{' '}
        <code>ENCRYPTION_KEY</code></strong> that encrypted it. Restore the database with a
        different key and every provider key silently decrypts to garbage (an empty string),
        surfacing later as &ldquo;wrong API key&rdquo; errors from the upstream provider.
      </p>
      <ul>
        <li>
          Back up <code>ENCRYPTION_KEY</code> <strong>separately and securely</strong> in a
          secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault), never
          alongside the database dump.
        </li>
        <li>
          A restore is only complete when the restored database is paired with the matching
          <code>ENCRYPTION_KEY</code>. Treat them as one unit.
        </li>
        <li>
          Lose the key and the encrypted provider keys are unrecoverable; users must re-enter
          them. Everything else in the dump (orgs, projects, traces) restores fine.
        </li>
      </ul>

      <h2 id="clickhouse">ClickHouse (request logs)</h2>
      <p>
        In the bundled stack the ClickHouse service is named <code>clickhouse</code>, listens
        on <code>8123</code> (HTTP) and <code>9000</code> (native), and defaults to user{' '}
        <code>spanlens</code> / database <code>spanlens</code>. All backup commands below run
        against that service. On ClickHouse Cloud, use the automatic backups it provides and
        swap the host/credentials for your managed endpoint.
      </p>

      <h3>Native BACKUP (recommended)</h3>
      <p>
        ClickHouse&apos;s built-in <code>BACKUP</code> statement writes a consistent snapshot
        of the <code>requests</code> table (and its schema). Run it through{' '}
        <code>clickhouse-client</code> inside the container.
      </p>
      <pre>{`# Back up the requests table to a local directory backup
docker compose exec clickhouse clickhouse-client \\
  --user spanlens --password "$CLICKHOUSE_PASSWORD" --database spanlens \\
  --query "BACKUP TABLE spanlens.requests TO Disk('backups', 'requests-$(date +%F).zip')"

# Back up straight to S3-compatible storage
docker compose exec clickhouse clickhouse-client \\
  --user spanlens --password "$CLICKHOUSE_PASSWORD" --database spanlens \\
  --query "BACKUP TABLE spanlens.requests TO S3('https://<bucket>.s3.amazonaws.com/spanlens/requests-$(date +%F)', '<access-key>', '<secret-key>')"`}</pre>
      <p className="text-sm text-muted-foreground">
        The <code>Disk(&apos;backups&apos;, ...)</code> target requires a{' '}
        <code>backups</code> disk configured in the ClickHouse server config; the S3 target
        works out of the box. For an operator-friendly wrapper with rotation and incremental
        support, <code>clickhouse-backup</code> is a common third-party tool.
      </p>

      <h3>Portable dump with SELECT INTO OUTFILE</h3>
      <p>
        For a plain, portable dump with no disk/S3 config, stream the table out as compressed
        native or CSV data.
      </p>
      <pre>{`# Native format, gzip-compressed (round-trips fastest)
docker compose exec -T clickhouse clickhouse-client \\
  --user spanlens --password "$CLICKHOUSE_PASSWORD" --database spanlens \\
  --query "SELECT * FROM spanlens.requests FORMAT Native" \\
  | gzip > requests-$(date +%F).native.gz`}</pre>

      <h3 id="restore-clickhouse">Restore ClickHouse</h3>
      <p>
        Restore is the inverse of whichever backup you took. Point at a fresh{' '}
        <code>clickhouse</code> container (or Cloud service) and re-create the schema first if
        it is empty.
      </p>
      <pre>{`# From a native BACKUP
docker compose exec clickhouse clickhouse-client \\
  --user spanlens --password "$CLICKHOUSE_PASSWORD" --database spanlens \\
  --query "RESTORE TABLE spanlens.requests FROM Disk('backups', 'requests-2026-07-01.zip')"

# From a SELECT ... INTO OUTFILE native dump
gunzip -c requests-2026-07-01.native.gz \\
  | docker compose exec -T clickhouse clickhouse-client \\
      --user spanlens --password "$CLICKHOUSE_PASSWORD" --database spanlens \\
      --query "INSERT INTO spanlens.requests FORMAT Native"`}</pre>
      <p>
        <strong>Re-run the migrations after any ClickHouse restore.</strong> The migrations
        are idempotent (every statement is <code>CREATE ... IF NOT EXISTS</code> /{' '}
        <code>ALTER ... ADD COLUMN IF NOT EXISTS</code>), so this is safe whether the restored
        data already has the latest schema or a slightly older one. It fills in any columns or
        views added since the backup was taken.
      </p>
      <pre>{`# From a clone of the repo (loads apps/server/.env if present)
pnpm ch:migrate

# Or standalone, pointed at your ClickHouse
CLICKHOUSE_URL=http://localhost:8123 \\
CLICKHOUSE_USER=spanlens CLICKHOUSE_PASSWORD=<password> CLICKHOUSE_DB=spanlens \\
  npx -y tsx clickhouse/apply.ts`}</pre>

      <h2 id="volumes">Coarse alternative: snapshot the Docker volumes</h2>
      <p>
        If you want a blunt, filesystem-level backup of the whole ClickHouse container instead
        of a logical dump, snapshot its named volumes directly. The bundled{' '}
        <code>docker-compose.yml</code> declares exactly two named volumes,{' '}
        <code>clickhouse_data</code> (the data directory,{' '}
        <code>/var/lib/clickhouse</code>) and <code>clickhouse_logs</code> (server logs,{' '}
        <code>/var/log/clickhouse-server</code>). Only <code>clickhouse_data</code> holds your
        <code>requests</code> rows; <code>clickhouse_logs</code> is optional.
      </p>
      <p className="text-sm text-muted-foreground">
        Compose prefixes volume names with the project name (usually the directory name), so
        the real volume is often <code>&lt;project&gt;_clickhouse_data</code>. Run{' '}
        <code>docker volume ls</code> to see the exact names.
      </p>
      <pre>{`# Stop the container first for a consistent, crash-safe snapshot
docker compose stop clickhouse

# Tar the data volume into the current directory
docker run --rm \\
  -v spanlens_clickhouse_data:/data:ro \\
  -v "$PWD":/backup \\
  busybox tar czf /backup/clickhouse_data-$(date +%F).tar.gz -C /data .

# Restart
docker compose start clickhouse`}</pre>
      <p>Restore into a fresh, empty volume:</p>
      <pre>{`docker run --rm \\
  -v spanlens_clickhouse_data:/data \\
  -v "$PWD":/backup \\
  busybox sh -c "cd /data && tar xzf /backup/clickhouse_data-2026-07-01.tar.gz"

docker compose up -d clickhouse
pnpm ch:migrate   # top up the schema, idempotent`}</pre>
      <p className="text-sm text-muted-foreground">
        A volume snapshot is a full-container image, not a portable table dump: restore it into
        the same ClickHouse major version (<code>clickhouse/clickhouse-server:24.10-alpine</code>{' '}
        in the bundled compose file) to avoid on-disk format surprises. Prefer the logical{' '}
        <code>BACKUP</code> / <code>SELECT</code> dumps above when you need portability.
      </p>

      <h2 id="schedule">Retention, scheduling, and restore drills</h2>
      <ul>
        <li>
          <strong>Automate it.</strong> Wrap the Postgres and ClickHouse dumps in one script
          and run it from cron (or a systemd timer). A daily dump with a{' '}
          <code>$(date +%F)</code> filename gives you point-in-time recovery per day.
        </li>
        <li>
          <strong>Rotate.</strong> Push dumps to off-box storage (S3, a backup host) and prune
          old ones, for example keep 7 daily + 4 weekly. A simple{' '}
          <code>find backups/ -name &apos;*.dump&apos; -mtime +7 -delete</code> caps local disk.
        </li>
        <li>
          <strong>Match retention to value.</strong> Postgres holds the crown jewels, keep
          those dumps long. ClickHouse is observability, so a shorter horizon is fine, and{' '}
          <a href="/docs/features/billing">plan retention</a> already caps how far back the
          server reads the <code>requests</code> log anyway.
        </li>
        <li>
          <strong>Store the key with the backups&apos; provenance, not the backups.</strong>{' '}
          Keep the current <code>ENCRYPTION_KEY</code> in your secret manager and document
          which key each Postgres dump was taken under.
        </li>
        <li>
          <strong>Run a restore drill.</strong> A backup you have never restored is a guess.
          Periodically restore both stores into a throwaway stack, pair them with the matching{' '}
          <code>ENCRYPTION_KEY</code>, run <code>pnpm ch:migrate</code>, and confirm the
          dashboard loads and a stored provider key still decrypts by making one proxied call.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/self-host">Self-hosting</a> (stack layout and env vars),{' '}
        <a href="/docs/features/settings">Keys &amp; encryption</a> (how provider keys are
        encrypted), <a href="/docs/features/export">Data export</a> (per-workspace exports).
      </p>
    </div>
  )
}
