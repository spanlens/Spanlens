import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Audit Logs · Spanlens Docs',
  description:
    'Chronological record of every organization-level change, API key creation, provider key additions, member invitations, role changes, and billing plan switches.',
}

export default function AuditLogsDocs() {
  return (
    <div>
      <h1>Audit Logs</h1>
      <p className="lead">
        Spanlens records every significant action within your organization. Track who changed what
        and when, API key creation, provider key additions, member invitations, role changes, and
        plan switches. View the log directly in Settings → <strong>Audit log</strong> or query it
        via the REST API to feed into an external SIEM or compliance tool.
      </p>

      <h2>Use cases</h2>
      <ul>
        <li>
          <strong>Security audits.</strong> Determine which keys a departing employee created, or
          whether admin roles changed at an unexpected time.
        </li>
        <li>
          <strong>Compliance.</strong> Satisfy SOC 2, ISO 27001, and similar audit requirements
          that ask for a change access log on demand.
        </li>
        <li>
          <strong>Incident investigation.</strong> If the proxy starts returning auth errors, check
          the audit log for provider key rotations around that time.
        </li>
      </ul>

      <h2>Recorded events</h2>
      <p>
        Twenty-four distinct actions are emitted across thirteen mutation routes. Severity
        in the dashboard is inferred from the verb (<code>.delete</code> /{' '}
        <code>.rotate</code> / <code>billing.*</code> / <code>workspace.*</code> are HIGH,{' '}
        <code>.create</code> / <code>.update</code> / <code>.invite</code> are MED, the
        rest are LOW). Every row carries the actor user id and IP address pulled from{' '}
        <code>x-forwarded-for</code> / <code>x-real-ip</code> / <code>cf-connecting-ip</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Spanlens key</strong></td>
            <td>
              <code>api_key.create</code> · <code>api_key.enable</code> ·{' '}
              <code>api_key.disable</code> · <code>api_key.delete</code>
            </td>
          </tr>
          <tr>
            <td><strong>Provider key</strong></td>
            <td>
              <code>provider_key.add</code> · <code>provider_key.update</code> ·{' '}
              <code>provider_key.rotate</code> · <code>provider_key.delete</code>
            </td>
          </tr>
          <tr>
            <td><strong>Prompt version</strong></td>
            <td>
              <code>prompt_version.create</code> · <code>prompt_version.rollback</code> ·{' '}
              <code>prompt_version.delete</code>
            </td>
          </tr>
          <tr>
            <td><strong>A/B experiment</strong></td>
            <td>
              <code>ab_experiment.start</code> · <code>ab_experiment.update</code> ·{' '}
              <code>ab_experiment.conclude</code> · <code>ab_experiment.stop</code> ·{' '}
              <code>ab_experiment.delete</code>
            </td>
          </tr>
          <tr>
            <td><strong>Members</strong></td>
            <td>
              <code>member.invite</code> · <code>member.invite_accept</code> ·{' '}
              <code>member.invite_cancel</code> · <code>member.role_change</code> ·{' '}
              <code>member.remove</code>
            </td>
          </tr>
          <tr>
            <td><strong>Workspace</strong></td>
            <td>
              <code>workspace.rename</code> · <code>workspace.security_update</code> ·{' '}
              <code>workspace.branding_update</code> · <code>workspace.overage_update</code>
            </td>
          </tr>
          <tr>
            <td><strong>Billing</strong></td>
            <td>
              <code>billing.checkout_create</code> · <code>billing.cancel</code>
            </td>
          </tr>
          <tr>
            <td><strong>Project</strong></td>
            <td>
              <code>project.create</code> · <code>project.update</code> ·{' '}
              <code>project.delete</code>
            </td>
          </tr>
          <tr>
            <td><strong>Alert / channel</strong></td>
            <td>
              <code>alert.create</code> · <code>alert.update</code> ·{' '}
              <code>alert.delete</code> · <code>notification_channel.create</code> ·{' '}
              <code>notification_channel.delete</code>
            </td>
          </tr>
          <tr>
            <td><strong>Webhook</strong></td>
            <td>
              <code>webhook.create</code> · <code>webhook.update</code> ·{' '}
              <code>webhook.delete</code>
            </td>
          </tr>
          <tr>
            <td><strong>Pending deletion queue</strong></td>
            <td><code>pending_deletion.restore</code></td>
          </tr>
        </tbody>
      </table>

      <p>
        View the log in <a href="/settings">Settings</a> → <strong>Audit log</strong>{' '}
        (admin-only full viewer with time-window + action filters, paginated 50 per page,
        click any row to open a drawer with the metadata JSON, IP, and actor UUID). Editors
        and viewers see the abbreviated table on the same Settings tab. Programmatic
        consumers should hit the REST API below.
      </p>

      <h2>API reference</h2>

      <h3>List logs</h3>
      <CodeBlock language="bash">{`GET /api/v1/audit-logs?limit=50&offset=0

# Filter by action
GET /api/v1/audit-logs?limit=50&offset=0&action=api_key.create

# Filter by user
GET /api/v1/audit-logs?limit=50&offset=0&user_id=<uuid>

# Filter by inclusive time range (ISO 8601)
GET /api/v1/audit-logs?from=2026-05-01T00:00:00Z&to=2026-05-31T23:59:59Z

# List the distinct action values seen on this workspace
# (powers the filter dropdown; capped at the last 1000 rows)
GET /api/v1/audit-logs/actions`}</CodeBlock>

      <h3>Query parameters</h3>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>limit</code></td>
            <td>50</td>
            <td>Results per page. Maximum 200.</td>
          </tr>
          <tr>
            <td><code>offset</code></td>
            <td>0</td>
            <td>Pagination offset.</td>
          </tr>
          <tr>
            <td><code>action</code></td>
            <td>(all)</td>
            <td>Filter to a specific action value, e.g. <code>member.invite</code>.</td>
          </tr>
          <tr>
            <td><code>user_id</code></td>
            <td>(all)</td>
            <td>Show only actions performed by a specific user (UUID).</td>
          </tr>
          <tr>
            <td><code>from</code></td>
            <td>(no lower bound)</td>
            <td>
              Inclusive lower bound on <code>created_at</code>, ISO 8601 timestamp.
              Malformed values return 400.
            </td>
          </tr>
          <tr>
            <td><code>to</code></td>
            <td>(no upper bound)</td>
            <td>
              Inclusive upper bound on <code>created_at</code>, ISO 8601 timestamp.
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Response example</h3>
      <CodeBlock language="json">{`{
  "data": [
    {
      "id": "al_01j9abc...",
      "action": "api_key.create",
      "resource_type": "api_key",
      "resource_id": "key_01j9...",
      "user_id": "usr_01j9...",
      "metadata": {
        "key_name": "Production proxy key"
      },
      "ip_address": "203.0.113.42",
      "created_at": "2026-05-15T08:30:00Z"
    },
    {
      "id": "al_01j9def...",
      "action": "member.role_change",
      "resource_type": "org_member",
      "resource_id": "usr_01j9yyy...",
      "user_id": "usr_01j9xxx...",
      "metadata": {
        "from_role": "viewer",
        "to_role": "editor",
        "target_email": "colleague@example.com"
      },
      "ip_address": "198.51.100.7",
      "created_at": "2026-05-15T07:12:45Z"
    }
  ],
  "total": 142,
  "limit": 50,
  "offset": 0
}`}</CodeBlock>

      <h3>Response fields</h3>
      <table className="[&_th:nth-child(2)]:text-left [&_td:nth-child(2)]:text-left [&_td:nth-child(2)]:whitespace-nowrap">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>id</code></td>
            <td>string</td>
            <td>Unique log entry ID</td>
          </tr>
          <tr>
            <td><code>action</code></td>
            <td>string</td>
            <td>Action performed (see event table above)</td>
          </tr>
          <tr>
            <td><code>resource_type</code></td>
            <td>string</td>
            <td>Type of resource changed (e.g. <code>api_key</code>, <code>org_member</code>)</td>
          </tr>
          <tr>
            <td><code>resource_id</code></td>
            <td>string</td>
            <td>ID of the changed resource</td>
          </tr>
          <tr>
            <td><code>user_id</code></td>
            <td>string</td>
            <td>ID of the user who performed the action</td>
          </tr>
          <tr>
            <td><code>metadata</code></td>
            <td>object</td>
            <td>Event-specific detail (before/after values, target email, etc.)</td>
          </tr>
          <tr>
            <td><code>ip_address</code></td>
            <td>string</td>
            <td>IP address of the request</td>
          </tr>
          <tr>
            <td><code>created_at</code></td>
            <td>string (ISO 8601)</td>
            <td>When the event occurred (UTC)</td>
          </tr>
        </tbody>
      </table>

      <h2>curl examples</h2>
      <CodeBlock language="bash">{`# Fetch the 20 most recent entries
curl "https://server.spanlens.io/api/v1/audit-logs?limit=20" \\
  -H "Authorization: Bearer <JWT>"

# Filter to provider key events only
curl "https://server.spanlens.io/api/v1/audit-logs?action=provider_key.add&limit=50" \\
  -H "Authorization: Bearer <JWT>"

# Second page (entries 51–100)
curl "https://server.spanlens.io/api/v1/audit-logs?limit=50&offset=50" \\
  -H "Authorization: Bearer <JWT>"`}</CodeBlock>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>Admin-only access.</strong> Only organization members with the admin role can
          query audit logs. Editors and viewers are blocked in both the API and the dashboard.
        </li>
        <li>
          <strong>200 rows per page maximum.</strong> Passing a <code>limit</code> above 200
          returns a 400 error.
        </li>
        <li>
          <strong>Fixed sort order.</strong> Results are always returned in <code>created_at DESC</code>{' '}
          order. Sort direction cannot be changed.
        </li>
        <li>
          <strong>Retention.</strong> Audit logs are retained for the lifetime of your
          account and are not currently pruned on a fixed schedule. If you need a guaranteed
          retention window for compliance reasons, export the log periodically via the API
          and store it in your own system; a future release may introduce per-plan
          retention windows, at which point this page and the{' '}
          <a href="/privacy">Privacy Policy</a> will be updated together.
        </li>
        <li>
          <strong>Proxy requests are not recorded here.</strong> LLM request and response history
          is in <a href="/docs/features/requests">Requests</a> and{' '}
          <a href="/docs/features/traces">Traces</a>. Audit logs focus on{' '}
          <em>organization configuration changes</em>.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related:{' '}
        <a href="/docs/features/members-invitations">Members &amp; Invitations</a>,{' '}
        <a href="/docs/features/security">Security</a> (PII / prompt injection scanning),{' '}
        <a href="/docs/features/webhooks">Webhooks</a> (HTTP event delivery).
        Dashboard: Settings → <strong>Audit log</strong>.
      </p>
    </div>
  )
}
