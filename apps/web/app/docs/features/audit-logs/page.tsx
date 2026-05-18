import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Audit Logs · Spanlens Docs',
  description:
    'Chronological record of every organization-level change — API key creation, provider key additions, member invitations, role changes, and billing plan switches.',
}

export default function AuditLogsDocs() {
  return (
    <div>
      <h1>Audit Logs</h1>
      <p className="lead">
        Spanlens records every significant action within your organization. Track who changed what
        and when — API key creation, provider key additions, member invitations, role changes, and
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
      <table>
        <thead>
          <tr>
            <th>action</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>api_key.create</code></td>
            <td>New Spanlens API key (<code>sl_live_*</code>) issued</td>
          </tr>
          <tr>
            <td><code>api_key.delete</code></td>
            <td>API key revoked</td>
          </tr>
          <tr>
            <td><code>provider_key.add</code></td>
            <td>OpenAI / Anthropic / Gemini provider key registered</td>
          </tr>
          <tr>
            <td><code>provider_key.delete</code></td>
            <td>Provider key removed</td>
          </tr>
          <tr>
            <td><code>member.invite</code></td>
            <td>Team member invitation sent</td>
          </tr>
          <tr>
            <td><code>member.role_change</code></td>
            <td>Member role updated (admin / editor / viewer)</td>
          </tr>
          <tr>
            <td><code>member.remove</code></td>
            <td>Member removed from the organization</td>
          </tr>
          <tr>
            <td><code>billing.plan.change</code></td>
            <td>Plan upgraded or downgraded</td>
          </tr>
          <tr>
            <td><code>org.settings.update</code></td>
            <td>Organization name, security settings, or other org-level config changed</td>
          </tr>
        </tbody>
      </table>

      <h2>API reference</h2>

      <h3>List logs</h3>
      <CodeBlock language="bash">{`GET /api/v1/audit-logs?limit=50&offset=0

# Filter by action
GET /api/v1/audit-logs?limit=50&offset=0&action=api_key.create

# Filter by user
GET /api/v1/audit-logs?limit=50&offset=0&user_id=<uuid>`}</CodeBlock>

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
            <td>Show only actions performed by a specific user.</td>
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
      <table>
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
curl "https://spanlens-server.vercel.app/api/v1/audit-logs?limit=20" \\
  -H "Authorization: Bearer <JWT>"

# Filter to provider key events only
curl "https://spanlens-server.vercel.app/api/v1/audit-logs?action=provider_key.add&limit=50" \\
  -H "Authorization: Bearer <JWT>"

# Second page (entries 51–100)
curl "https://spanlens-server.vercel.app/api/v1/audit-logs?limit=50&offset=50" \\
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
