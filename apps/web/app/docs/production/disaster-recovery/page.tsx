import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Disaster recovery · Spanlens Docs',
  description:
    'Operator runbook for Spanlens outages: what data is at risk in each failure mode, how the fallback queues protect it, and the exact recovery steps for ClickHouse, Supabase, cron, and webhook incidents.',
  alternates: { canonical: '/docs/production/disaster-recovery' },
}

export default function DisasterRecoveryDocs() {
  return (
    <div>
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
        usage), not your application traffic. The targets below are what the queues and
        backups are sized for.
      </p>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Store</th>
            <th>Protection</th>
            <th>Recovery point</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Request logs</td>
            <td>ClickHouse</td>
            <td><code>requests_fallback</code> queue in Supabase (7 day TTL)</td>
            <td>0 while the queue holds</td>
          </tr>
          <tr>
            <td>Trace events</td>
            <td>ClickHouse</td>
            <td><code>events_fallback</code> queue in Supabase (7 day TTL)</td>
            <td>0 while the queue holds</td>
          </tr>
          <tr>
            <td>Accounts, keys, billing</td>
            <td>Supabase Postgres</td>
            <td>Managed daily backups + PITR</td>
            <td>Provider backup cadence</td>
          </tr>
          <tr>
            <td>Outbound webhooks</td>
            <td>Supabase Postgres</td>
            <td>5 retries with backoff, then dead-lettered</td>
            <td>At-least-once while the endpoint is up</td>
          </tr>
        </tbody>
      </table>

      <h2 id="clickhouse-down">ClickHouse is down or paused</h2>
      <p>
        This is the most common incident on the ClickHouse Cloud Development tier, which
        auto-pauses when idle. The proxy keeps serving traffic. Log inserts that fail are
        written to the <code>requests_fallback</code> / <code>events_fallback</code> tables
        in Supabase instead of being lost.
      </p>
      <p>
        <strong>Automatic recovery:</strong> the <code>/cron/replay-fallback</code> job
        drains those queues back into ClickHouse every 5 minutes, in batches, skipping any
        row already present (idempotent). Once ClickHouse is reachable the backlog clears
        on its own.
      </p>
      <p><strong>Manual steps if the backlog is not draining:</strong></p>
      <ol>
        <li>
          Confirm ClickHouse is reachable and un-paused (ClickHouse Cloud console, or{' '}
          <code>GET /health/ready</code> which pings it).
        </li>
        <li>
          Check the queue depth in <code>GET /health/deep</code> under{' '}
          <code>fallback.queue</code> and <code>fallback.eventsQueue</code>. A rising number
          means the replay cron is not firing (see{' '}
          <a href="#cron-dropout">cron dropout</a> below).
        </li>
        <li>
          Trigger a drain by hand:
          <CodeBlock language="bash">{`curl -X GET https://server.spanlens.io/cron/replay-fallback \\
  -H "Authorization: Bearer $CRON_SECRET"`}</CodeBlock>
        </li>
        <li>
          If the outage exceeds the <strong>7 day</strong> queue TTL, rows past the TTL are
          expired to bound Supabase storage. That is the only window in which request-log
          data is permanently lost. Upgrade the ClickHouse tier off Development so it does
          not auto-pause, which removes this class of incident entirely.
        </li>
      </ol>
      <p>
        When the queue exceeds 1000 rows an <code>internal_alerts</code> row (kind{' '}
        <code>fallback_queue_high</code>) is raised and shown at <code>/admin/alerts</code>.
      </p>

      <h2 id="supabase-down">Supabase is down</h2>
      <p>
        Supabase holds accounts, API keys, provider keys, billing, and the fallback queues
        themselves. While it is down:
      </p>
      <ul>
        <li>
          The dashboard and REST API are unavailable. Proxy auth uses a short in-memory
          cache, so in-flight keys keep working briefly, but new key lookups fail closed.
        </li>
        <li>
          The fallback queues cannot absorb ClickHouse failures, because they live in
          Supabase. A <em>simultaneous</em> ClickHouse + Supabase outage is the one case
          where new request logs can be lost (see below).
        </li>
      </ul>
      <p><strong>Recovery:</strong></p>
      <ol>
        <li>Restore Supabase from the managed backup or point-in-time recovery. See{' '}
          <a href="/docs/self-host/backup#restore-postgres">Restore Postgres</a>.</li>
        <li>
          Because migrations are additive and the deploy pipeline runs{' '}
          <code>migrate</code> before <code>deploy</code>, the server code tolerates a
          schema that is briefly behind. Verify the schema version after restore and
          re-run <code>supabase db push --linked</code> if needed.
        </li>
        <li>
          After restore, watch <code>/health/deep</code> for the fallback queues to begin
          draining again.
        </li>
      </ol>

      <h2 id="both-down">ClickHouse and Supabase both down</h2>
      <p>
        This is the only total-loss window for new request logs: there is nowhere to queue
        a failed insert. Your application traffic is unaffected because the proxy still
        returns provider responses. The mitigation is to keep the two on independent
        providers (they already are) so a correlated outage is unlikely, and to run
        managed backups on both. There is no in-app queue that survives losing both stores
        at once; do not design new write paths that assume one is always available.
      </p>

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
          <CodeBlock language="bash">{`curl -X GET https://server.spanlens.io/cron/run-background-migrations \\
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
        reasonable default), restore the latest Supabase backup and a ClickHouse backup
        into a throwaway environment and confirm the dashboard renders, using the exact
        commands in <a href="/docs/self-host/backup">Backup and restore</a>. Record how
        long the restore took; that is your real recovery time, not an estimate.
      </p>
    </div>
  )
}
