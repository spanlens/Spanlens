import { openGraphFor } from '@/lib/page-metadata'
import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  title: 'Disaster recovery · Spanlens Docs',
  description:
    'Operator runbook for Spanlens outages: what data is at risk per failure mode, how the fallback queue protects it, and how to recover the Postgres database.',
  alternates: { canonical: '/docs/production/disaster-recovery' },
  openGraph: openGraphFor('/docs/production/disaster-recovery'),
}

export default function DisasterRecoveryDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Disaster recovery</h1>
      <p className="lead">
        A runbook for the person on call. Each failure mode below lists what data is at
        risk, what protects it automatically, and the steps to recover. Pair this with{' '}
        <a href="/docs/production/reliability">Reliability</a> (how the system degrades) and{' '}
        <a href="/docs/self-host/backup">Backup and restore</a> (the restore commands).
      </p>

      <h2 id="objectives">Recovery objectives</h2>
      <p>
        Spanlens is designed so a dependency outage never fails your end users&apos; LLM
        calls: the proxy returns the provider response before any logging happens. The
        risk in an outage is <strong>observability data</strong> (request logs, traces,
        usage), not your application traffic. Everything Spanlens stores is in one Postgres
        database, so the recovery story is short, and one restore covers all of it.
      </p>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Protection</th>
            <th>Recovery point</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Request logs (<code>requests</code>)</td>
            <td>
              <code>requests_fallback</code> queue for a failed insert (7 day TTL), plus the
              database backup
            </td>
            <td>0 while the queue holds</td>
          </tr>
          <tr>
            <td>Traces and spans</td>
            <td>Managed daily backups + PITR</td>
            <td>Provider backup cadence</td>
          </tr>
          <tr>
            <td>Accounts, keys, billing</td>
            <td>Managed daily backups + PITR</td>
            <td>Provider backup cadence</td>
          </tr>
          <tr>
            <td>Outbound webhooks</td>
            <td>5 retries with backoff, then dead-lettered</td>
            <td>At-least-once while the endpoint is up</td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">
        The <code>ENCRYPTION_KEY</code> is not in any of those backups by design. A restore is
        only usable when it is paired with the key the data was encrypted under. See{' '}
        <a href="/docs/self-host/backup#encryption-key">the backup runbook</a>.
      </p>

      <h2 id="log-insert-failing">The request log stops filling</h2>
      <p>
        Request rows are written over a pooled connection, separately from the PostgREST calls
        the rest of the server makes. That insert can fail on its own while the database is
        otherwise fine: the pooler is saturated, a statement hit the timeout, or a deploy is
        writing a column the schema does not have yet. The proxy keeps serving traffic
        throughout, because the row is written after the response has left.
      </p>
      <p>
        <strong>Automatic recovery:</strong> a failed insert is queued into{' '}
        <code>requests_fallback</code> over PostgREST rather than dropped, and{' '}
        <code>/cron/replay-fallback</code> drains the queue back into <code>requests</code>{' '}
        every 5 minutes. The replay insert ends in{' '}
        <code>ON CONFLICT (created_at, id) DO NOTHING</code>, so replaying a batch that
        partially landed cannot duplicate a row or inflate anyone&apos;s cost.
      </p>
      <p><strong>Manual steps if the backlog is not draining:</strong></p>
      <ol>
        <li>
          Check <code>GET /health/ready</code>. It probes the database twice, once over
          PostgREST and once over the pooled connection, so it tells you which of the two is
          broken.
        </li>
        <li>
          Read the queue depth from <code>GET /health/deep</code> under{' '}
          <code>fallback.queue</code>. A number that climbs and never falls means the replay
          cron is not firing (see <a href="#cron-dropout">cron dropout</a> below).
        </li>
        <li>
          Trigger a drain by hand:
          <CodeBlock language="bash">{`curl -X GET https://api.spanlens.io/cron/replay-fallback \\
  -H "Authorization: Bearer $CRON_SECRET"`}</CodeBlock>
        </li>
        <li>
          If the drain still fails, read <code>last_error</code> on the queued rows. It is the
          insert error verbatim, and it usually names the problem outright.
          <CodeBlock language="sql">{`SELECT left(last_error, 200) AS err, count(*), min(created_at) AS oldest
FROM requests_fallback
GROUP BY 1
ORDER BY 2 DESC;`}</CodeBlock>
        </li>
        <li>
          Rows are expired after <strong>7 days</strong> or 100 retries to bound queue size.
          That is the only window in which request-log data is permanently lost.
        </li>
      </ol>
      <p>
        When the queue exceeds 1000 rows an <code>internal_alerts</code> row (kind{' '}
        <code>fallback_queue_high</code>) is raised and shown at <code>/admin/alerts</code>.
      </p>

      <h2 id="missing-partition">Rows land in requests_default</h2>
      <p>
        <code>requests</code> is partitioned by month. A partition for the current month is
        normally created several months ahead of time. If that ever stops happening, inserts
        do not fail: rows fall into the <code>requests_default</code> catch-all partition
        instead. Nothing is lost, and dashboards still read the rows, so this can run unnoticed
        for weeks. The cost comes later, because the real partition for that month can no
        longer be created while conflicting rows sit in the default table.
      </p>
      <ol>
        <li>
          Check for occupants. An empty default partition is the healthy state.
          <CodeBlock language="sql">{`SELECT count(*) FROM requests_default;`}</CodeBlock>
        </li>
        <li>
          Create the missing partitions. The function is idempotent and returns which months it
          had to create.
          <CodeBlock language="sql">{`SELECT * FROM ensure_requests_partitions(3);`}</CodeBlock>
        </li>
        <li>
          If step 1 found rows, move them out during a quiet window:{' '}
          <code>DETACH</code> the default partition, insert its rows back into{' '}
          <code>requests</code>, then re-attach the emptied table. Detaching takes a lock, so
          do it deliberately rather than in the middle of an incident.
        </li>
      </ol>

      <h2 id="postgres-down">Postgres is down</h2>
      <p>
        One database holds accounts, API keys, provider keys, billing, traces, the request log,
        and the fallback queue itself. While it is unreachable:
      </p>
      <ul>
        <li>
          The dashboard and REST API are unavailable. Proxy auth caches each key in process for
          30 seconds, so a warm instance keeps serving briefly, then new lookups fail closed.
        </li>
        <li>
          A failed request-log insert has nowhere to queue, because the queue lives in the same
          database. This is the total-loss window for new log rows. Traffic itself is
          unaffected: the proxy still returns provider responses.
        </li>
      </ul>
      <p><strong>Recovery:</strong></p>
      <ol>
        <li>
          Restore from the managed backup or point-in-time recovery. See{' '}
          <a href="/docs/self-host/backup#restore-postgres">Restore</a>.
        </li>
        <li>
          Migrations are additive and <code>supabase db push</code> runs on every push to main,
          so the server tolerates a schema that is briefly behind. Verify the schema version
          after the restore and re-run <code>supabase db push --linked</code> if it is not
          current.
        </li>
        <li>
          Confirm the current month has a partition:{' '}
          <code>SELECT * FROM ensure_requests_partitions(3);</code>. A restore from an older
          backup carries only the partitions that existed when it was taken.
        </li>
        <li>Watch <code>/health/deep</code> until <code>fallback.queue</code> reaches 0.</li>
      </ol>

      <h2 id="cron-dropout">Scheduled jobs stop firing</h2>
      <p>
        Vercel&apos;s cron scheduler is known to silently drop short-interval jobs (as low
        as a few percent fire rate for <code>*/5</code> schedules). If the replay,
        self-monitor, or pending-deletion crons stop, backlogs build up with no error.
      </p>
      <p><strong>Detection:</strong> query how often each job actually ran in the last day.</p>
      <CodeBlock language="sql">{`SELECT job_name, count(*) AS runs, max(ran_at) AS last_run
FROM cron_job_runs
WHERE ran_at > now() - interval '24 hours'
GROUP BY job_name
ORDER BY runs;`}</CodeBlock>
      <p>
        Compare the run counts to the schedule in <code>apps/server/vercel.json</code>. A
        job that is defined but missing from this list, or running far below its schedule,
        is being dropped.
      </p>
      <p><strong>Mitigation (defense in depth):</strong></p>
      <ul>
        <li>
          <strong>GitHub Actions</strong> re-fires the critical routes on a schedule
          (<code>.github/workflows/cron-server.yml</code>). GitHub also throttles short
          intervals, so this is a partial backstop, not a full replacement.
        </li>
        <li>
          <strong>External heartbeat monitor</strong> is the reliable fix. Register a
          monitor (for example Better Stack) that calls the critical endpoints on a fixed
          interval with the <code>Authorization: Bearer $CRON_SECRET</code> header. Because
          it runs outside Vercel and GitHub, it is unaffected by their scheduler gaps and
          fires at close to 100%. Cover at least{' '}
          <code>/cron/replay-fallback</code> (3 min) and <code>/cron/self-monitor</code> (30
          min).
        </li>
      </ul>
      <p>
        Keep <code>CRON_SECRET</code> synchronized across the three schedulers (Vercel env,
        GitHub Actions secret, and the external monitor header) whenever it is rotated.
      </p>

      <h2 id="migration-stalled">A background migration is stuck</h2>
      <p>
        Large backfills run as chunked background migrations with a Postgres advisory lock
        and a heartbeat, driven by <code>/cron/run-background-migrations</code>. If that
        cron stops firing (see above) the queue stalls with no error.
      </p>
      <ol>
        <li>
          Check the queue:
          <CodeBlock language="sql">{`SELECT name, status, progress_current, progress_total, last_heartbeat_at
FROM background_migrations
WHERE status IN ('pending', 'running')
ORDER BY created_at;`}</CodeBlock>
        </li>
        <li>
          A row stuck in <code>running</code> with a stale <code>last_heartbeat_at</code>{' '}
          (older than a few minutes) means the worker died mid-chunk. The next cron tick
          reclaims the lock and resumes from where it left off, so the usual fix is simply
          to make the cron fire again.
        </li>
        <li>Trigger one run by hand to resume:
          <CodeBlock language="bash">{`curl -X GET https://api.spanlens.io/cron/run-background-migrations \\
  -H "Authorization: Bearer $CRON_SECRET"`}</CodeBlock>
        </li>
      </ol>

      <h2 id="webhook-dlq">Webhook deliveries are dead-lettering</h2>
      <p>
        Outbound webhooks retry 5 times with exponential backoff. A delivery that exhausts
        its retries, or whose endpoint was deleted, is <strong>dead-lettered</strong>:
        marked with <code>dlq_at</code> and a <code>dlq_reason</code> instead of retrying
        forever. A dead-letter count that climbs means a customer endpoint has been down
        long enough to burn through every retry.
      </p>
      <ol>
        <li>
          Watch <code>webhooks.dlq_count</code> in <code>GET /health/deep</code>. When it
          crosses the threshold an <code>internal_alerts</code> row (kind{' '}
          <code>webhook_backlog</code>) is raised at <code>/admin/alerts</code>.
        </li>
        <li>
          Inspect what is dead-lettered and why:
          <CodeBlock language="sql">{`SELECT webhook_id, dlq_reason, count(*)
FROM webhook_deliveries
WHERE dlq_at IS NOT NULL
GROUP BY webhook_id, dlq_reason
ORDER BY count DESC;`}</CodeBlock>
        </li>
        <li>
          <code>exhausted</code> means the endpoint returned errors or timed out for the
          full retry window (contact the customer). <code>webhook_deleted</code> and{' '}
          <code>payload_missing</code> are terminal and need no action.
        </li>
      </ol>

      <h2 id="drills">Restore drills</h2>
      <p>
        Backups are only real if a restore has been tested. On a schedule (quarterly is a
        reasonable default), restore the latest backup into a throwaway project, pair it with
        the matching <code>ENCRYPTION_KEY</code>, and confirm the dashboard renders and a
        stored provider key still decrypts. Use the exact commands in{' '}
        <a href="/docs/self-host/backup">Backup and restore</a>. Record how long the restore
        took; that is your real recovery time, not an estimate.
      </p>
    </div>
  )
}
