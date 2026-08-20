import { openGraphFor } from '@/lib/page-metadata'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/self-host/backup' },
  openGraph: openGraphFor('/docs/self-host/backup'),
  title: 'Backup & restore · Spanlens Docs',
  description:
    'Backup and restore runbook for self-hosted Spanlens: dump the Postgres database, restore it into a fresh project, and keep ENCRYPTION_KEY separate.',
}

export default function SelfHostBackupPage() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Backup &amp; restore</h1>
      <p className="lead">
        A self-hosted Spanlens deployment keeps everything in one Postgres database, plus one
        secret that lives outside it. This page is the operator runbook for dumping that
        database, restoring it, and handling the secret that makes the restore worth anything.
      </p>

      <h2>What you are backing up</h2>
      <p>
        There is one datastore. Your Supabase project holds organizations, projects, API keys,
        encrypted provider keys, traces, spans, prompts, evals, billing, and the{' '}
        <code>requests</code> log of every proxied LLM call. The bundled{' '}
        <code>docker-compose.yml</code> runs two services, <code>web</code> and{' '}
        <code>server</code>, and declares no volumes. <strong>Both containers are
        disposable.</strong> Delete them, re-pull, start again, and nothing is lost.
      </p>
      <table>
        <thead>
          <tr>
            <th>What</th>
            <th>Where it lives</th>
            <th>If you lose it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Everything Spanlens stores</strong>
            </td>
            <td>Your Supabase Postgres database</td>
            <td>
              Catastrophic. Accounts, keys, configuration, and history all go at once.
            </td>
          </tr>
          <tr>
            <td>
              <strong>
                <code>ENCRYPTION_KEY</code>
              </strong>
            </td>
            <td>Your secret manager and the server&apos;s environment</td>
            <td>
              Stored provider keys stay encrypted forever. Everything else in the dump still
              restores, and users re-enter their provider keys.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="postgres">Supabase Postgres</h2>
      <p>
        Managed Supabase projects take their own backups (Project Settings &rarr; Database
        &rarr; Backups). On the Pro plan that is a daily backup with 7 days of history. Take
        your own logical dumps on top of that, so you hold a copy outside the provider and can
        restore into any Postgres 17 target.
      </p>

      <h3>Back up with pg_dump</h3>
      <p>
        Grab the connection string from <strong>Project Settings &rarr; Database</strong>. Use
        the direct connection on port <code>5432</code> for dumps, not the transaction pooler
        on 6543 that the server uses at runtime. The custom format (<code>-Fc</code>) restores
        selectively and compresses well.
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
        <code>--no-owner --no-privileges</code> keeps the dump portable across projects, since
        the Supabase-managed roles differ per project. If you self-host Postgres elsewhere,
        dump with <code>docker exec &lt;your-postgres-container&gt; pg_dump ...</code> instead.
        The bundled compose file ships no Postgres container of its own.
      </p>

      <h3>The request log dominates the dump</h3>
      <p>
        <code>requests</code> stores prompt and response bodies, so on a busy deployment it is
        larger than every other table put together. It is also the one table you can afford to
        lose: it is observability, not the source of truth for accounts or keys. If you want a
        small, fast dump for daily rotation, drop its rows and keep its schema.
      </p>
      <pre>{`# Schema for every table, data for everything except the request log
pg_dump \\
  "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \\
  --format=custom --no-owner --no-privileges \\
  --exclude-table-data='public.requests*' \\
  --file=spanlens-core-$(date +%F).dump`}</pre>
      <p className="text-sm text-muted-foreground">
        The trailing <code>*</code> matters. <code>requests</code> is partitioned by month, so
        the rows live in child tables named <code>requests_2026_08</code> and so on, and a
        pattern without the wildcard would exclude the empty parent and dump every partition
        anyway. It also catches <code>requests_fallback</code>, the short-lived queue of rows
        waiting to be written into the log, which is the behaviour you want here: if you are
        skipping the log, you are skipping what was about to join it. Run{' '}
        <code>\dt+ public.requests*</code> in psql to see the partitions and their sizes.
      </p>

      <h3 id="restore-postgres">Restore</h3>
      <p>
        Restore a custom-format dump with <code>pg_restore</code>, and a plain SQL dump with{' '}
        <code>psql</code>. Point at a fresh Supabase project or any empty Postgres 17 database.
      </p>
      <pre>{`# Restore a custom-format (.dump) backup
pg_restore \\
  --dbname="postgresql://postgres:<password>@db.<new-ref>.supabase.co:5432/postgres" \\
  --no-owner --no-privileges --clean --if-exists \\
  spanlens-pg-2026-08-01.dump

# Restore a plain SQL (.sql) backup
psql "postgresql://postgres:<password>@db.<new-ref>.supabase.co:5432/postgres" \\
  -f spanlens-pg-2026-08-01.sql`}</pre>
      <p>
        Restoring into a brand-new project? Run{' '}
        <a
          href="https://raw.githubusercontent.com/spanlens/Spanlens/main/supabase/init.sql"
          target="_blank"
          rel="noopener noreferrer"
        >
          supabase/init.sql
        </a>{' '}
        first if the schema is not already there. Every statement is{' '}
        <code>CREATE IF NOT EXISTS</code> / <code>ALTER IF NOT EXISTS</code>, so re-running is
        safe. Then restore the data dump on top.
      </p>
      <p>
        Then make sure the current month has a partition to write into:
      </p>
      <pre>{`-- Creates the current month plus the next three, and is safe to re-run.
SELECT * FROM ensure_requests_partitions(3);`}</pre>
      <p className="text-sm text-muted-foreground">
        A dump taken months ago carries the partitions that existed then. Without this call the
        first proxied request after a restore still gets logged, into the{' '}
        <code>requests_default</code> catch-all, and getting those rows into the right
        partition afterwards means detaching the default table under a lock. One line now is
        cheaper. Schedule the same call monthly while you are at it.
      </p>

      <h3 id="encryption-key">The ENCRYPTION_KEY is not in the dump</h3>
      <p>
        Provider keys (your real OpenAI / Anthropic / Gemini keys) are stored encrypted with
        AES-256-GCM under <code>ENCRYPTION_KEY</code>. The ciphertext travels inside the
        Postgres dump, but it is <strong>useless without the exact same{' '}
        <code>ENCRYPTION_KEY</code></strong> that encrypted it. Restore the database under a
        different key and every provider key silently decrypts to garbage (an empty string),
        which surfaces later as &ldquo;wrong API key&rdquo; errors from the upstream provider.
      </p>
      <ul>
        <li>
          Back up <code>ENCRYPTION_KEY</code> <strong>separately and securely</strong> in a
          secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault), never
          alongside the database dump.
        </li>
        <li>
          A restore is only complete when the restored database is paired with the matching{' '}
          <code>ENCRYPTION_KEY</code>. Treat them as one unit.
        </li>
        <li>
          Lose the key and the encrypted provider keys are unrecoverable, so users must
          re-enter them. Everything else in the dump (orgs, projects, traces, request history)
          restores fine.
        </li>
      </ul>

      <h2 id="schedule">Retention, scheduling, and restore drills</h2>
      <ul>
        <li>
          <strong>Automate it.</strong> One <code>pg_dump</code> in cron or a systemd timer is
          the whole job. A daily dump with a <code>$(date +%F)</code> filename gives you
          point-in-time recovery per day.
        </li>
        <li>
          <strong>Rotate.</strong> Push dumps to off-box storage (S3, a backup host) and prune
          old ones, for example keep 7 daily and 4 weekly. A simple{' '}
          <code>find backups/ -name &apos;*.dump&apos; -mtime +7 -delete</code> caps local disk.
        </li>
        <li>
          <strong>Two sizes if the log is big.</strong> A nightly core dump that excludes{' '}
          <code>requests</code> data stays small enough to keep for months. Take the full dump
          weekly. You lose at most a week of request history in a restore, and no account or
          key data at all.
        </li>
        <li>
          <strong>Know what the server deletes on its own.</strong> Request rows are hard
          deleted at 365 days by dropping that month&apos;s partition. Shorter per-plan windows
          (14 days on Free, 90 on Pro, 365 on Team) are applied when the dashboard queries, not
          by deleting rows, so a plan upgrade brings older data back into view. See{' '}
          <a href="/docs/features/billing">plan retention</a>.
        </li>
        <li>
          <strong>Store the key with the backups&apos; provenance, not the backups.</strong>{' '}
          Keep the current <code>ENCRYPTION_KEY</code> in your secret manager and write down
          which key each dump was taken under.
        </li>
        <li>
          <strong>Run a restore drill.</strong> A backup you have never restored is a guess.
          Periodically restore into a throwaway project, pair it with the matching{' '}
          <code>ENCRYPTION_KEY</code>, call <code>ensure_requests_partitions</code>, and
          confirm the dashboard loads and a stored provider key still decrypts by making one
          proxied call.
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
