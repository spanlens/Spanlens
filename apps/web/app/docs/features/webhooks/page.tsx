import { openGraphFor } from '@/lib/page-metadata'
import { CodeBlock } from '../../_components/code-block'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/features/webhooks' },
  openGraph: openGraphFor('/docs/features/webhooks'),
  title: 'Webhooks · Spanlens Docs',
  description:
    'Receive Spanlens events (request created, trace completed, alert triggered) as real-time HTTP POST payloads on your own server.',
}

export default function WebhooksDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Webhooks</h1>
      <p className="lead">
        Deliver Spanlens events to your own server as HTTP POST payloads in real time. Three event
        types are supported, request created, trace completed, and alert triggered, all signed with
        HMAC-SHA256 so you can verify authenticity. Use webhooks to build custom Slack bots, data
        pipelines, CI/CD triggers, or any other automation beyond the dashboard.
      </p>

      <h2>Supported events</h2>
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>When it fires</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>request.created</code></td>
            <td>After the proxy receives an LLM response and inserts a row into <code>requests</code></td>
          </tr>
          <tr>
            <td><code>trace.completed</code></td>
            <td>When the last span in an agent trace closes</td>
          </tr>
          <tr>
            <td><code>alert.triggered</code></td>
            <td>When an Alert rule exceeds its threshold and sends a notification</td>
          </tr>
        </tbody>
      </table>

      <h2>Endpoints</h2>
      <CodeBlock language="http">{`GET    /api/v1/webhooks                    # List all webhooks in the organization
POST   /api/v1/webhooks                    # Register a new webhook
PATCH  /api/v1/webhooks/:id               # Update name, URL, events, or active status
DELETE /api/v1/webhooks/:id               # Delete a webhook
POST   /api/v1/webhooks/:id/test          # Send a test payload immediately
GET    /api/v1/webhooks/:id/deliveries    # Last 10 delivery records`}</CodeBlock>

      <p>
        All endpoints require <code>Authorization: Bearer &lt;supabase-jwt&gt;</code>. Creating,
        updating, and deleting webhooks requires <strong>admin or editor</strong> role. Viewers can
        only list webhooks and view delivery history.
      </p>

      <h2>Registering a webhook</h2>

      <h3>Request schema</h3>
      <table className="[&_th:nth-child(2)]:text-left [&_td:nth-child(2)]:text-left [&_td:nth-child(2)]:whitespace-nowrap">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>name</code></td>
            <td>string</td>
            <td>Yes</td>
            <td>Human-readable label (e.g. &quot;Slack event pipe&quot;)</td>
          </tr>
          <tr>
            <td><code>url</code></td>
            <td>string</td>
            <td>Yes</td>
            <td>Must start with <code>https://</code>. Plain HTTP is rejected.</td>
          </tr>
          <tr>
            <td><code>events</code></td>
            <td>string[]</td>
            <td>Yes</td>
            <td>Events to subscribe to. An empty array means no events will be delivered.</td>
          </tr>
          <tr>
            <td><code>is_active</code></td>
            <td>boolean</td>
            <td>Optional</td>
            <td>Defaults to <code>true</code>. Set <code>false</code> to pause delivery.</td>
          </tr>
        </tbody>
      </table>

      <CodeBlock language="bash">{`curl -X POST https://api.spanlens.io/api/v1/webhooks \\
  -H "Authorization: Bearer <JWT>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My data pipeline",
    "url": "https://my-server.example.com/hooks/spanlens",
    "events": ["request.created", "alert.triggered"],
    "is_active": true
  }'`}</CodeBlock>

      <h3>Response example</h3>
      <CodeBlock language="json">{`{
  "id": "wh_01j9abc...",
  "name": "My data pipeline",
  "url": "https://my-server.example.com/hooks/spanlens",
  "secret": "a3f8c2d1e5b04f7a9c6e2d8b1a4f03c7",
  "events": ["request.created", "alert.triggered"],
  "is_active": true,
  "created_at": "2026-05-15T09:00:00Z"
}`}</CodeBlock>
      <p>
        The <code>secret</code> is a 32-character hex string returned only at registration time.
        Store it securely, it cannot be recovered if lost. Subsequent GET responses show only a
        masked value.
      </p>

      <h2>Payload structure</h2>
      <p>
        Spanlens sends a JSON body as an HTTP POST to your endpoint when an event fires. Every body
        carries <code>event</code>, <code>webhook_id</code>, and <code>timestamp</code>, which is
        when the event was first dispatched and stays the same on retries. Next to those sits one
        object that describes what happened.
      </p>
      <CodeBlock language="json">{`{
  "request": {
    "id": "3f0c2a8e-...",
    "provider": "openai",
    "model": "gpt-4o-mini-2024-07-18",
    "prompt_tokens": 512,
    "completion_tokens": 128,
    "total_tokens": 640,
    "cost_usd": 0.000154,
    "latency_ms": 843,
    "status_code": 200,
    "trace_id": null,
    "created_at": "2026-05-15T09:01:23.000Z"
  },
  "event": "request.created",
  "timestamp": "2026-05-15T09:01:23.512Z",
  "webhook_id": "8d0c41f2-..."
}`}</CodeBlock>
      <p>
        <code>trace.completed</code> sends a <code>trace</code> object with <code>id</code>,{' '}
        <code>status</code>, <code>ended_at</code>, and <code>duration_ms</code>.{' '}
        <code>alert.triggered</code> sends an <code>alert</code> object with <code>id</code>,{' '}
        <code>name</code>, <code>type</code>, <code>threshold</code>, <code>current_value</code>,
        and <code>window_minutes</code>, plus an <code>organization</code> object with its{' '}
        <code>name</code>. A test delivery has <code>event</code> set to <code>test</code> and no
        event object.
      </p>

      <h2>Delivery headers</h2>
      <table>
        <thead>
          <tr>
            <th>Header</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>Content-Type</code></td>
            <td><code>application/json</code></td>
          </tr>
          <tr>
            <td><code>X-Spanlens-Signature</code></td>
            <td>
              <code>sha256=</code> followed by the hex HMAC-SHA256 of the raw body. See{' '}
              <a href="#signature-verification">signature verification</a>.
            </td>
          </tr>
          <tr>
            <td><code>X-Spanlens-Delivery-Id</code></td>
            <td>
              A UUID for the delivery. Every retry of the same event sends the same value, so use it
              to drop duplicates. See <a href="#retries">retries and duplicates</a>.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="signature-verification">Signature verification</h2>
      <p>
        Every delivery includes an <code>X-Spanlens-Signature</code> header. Its value is{' '}
        <code>sha256=</code> followed by the hex HMAC-SHA256 digest of the raw request body, keyed
        with the <code>secret</code> issued at registration. Always verify the signature to reject
        forged requests.
      </p>

      <h3>Node.js verification example</h3>
      <CodeBlock language="typescript">{`import crypto from 'node:crypto'

export function verifySpanlensSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex')

  // The header looks like "sha256=<hex digest>"
  const prefix = 'sha256='
  if (!signatureHeader.startsWith(prefix)) return false
  const received = signatureHeader.slice(prefix.length)

  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(received, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Express example
app.post('/hooks/spanlens', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-spanlens-signature'] as string
  if (!verifySpanlensSignature(req.body.toString(), sig, process.env.WEBHOOK_SECRET!)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }
  const event = JSON.parse(req.body.toString())
  // handle event
  res.json({ ok: true })
})`}</CodeBlock>
      <p>
        Important: read <code>req.body</code> as <strong>raw bytes</strong>. Re-serializing the
        parsed JSON can change whitespace or key order, causing a signature mismatch. Use{' '}
        <code>express.raw()</code> or an equivalent middleware.
      </p>

      <h2 id="retries">Retries and duplicates</h2>
      <p>
        An attempt succeeds when your endpoint answers with a 2xx status within 10 seconds. Any
        other status, a timeout, a connection error, or a redirect that Spanlens will not follow
        counts as a failed attempt.
      </p>
      <p>
        Spanlens makes up to 5 attempts per event: the original delivery and 4 retries. Each retry
        waits at least 1, 2, 4, and 8 minutes after the attempt before it. Retries are sent by a
        job that runs every 5 minutes, so a retry can arrive a few minutes after it becomes due,
        and the whole sequence takes roughly 20 to 30 minutes. If the fifth attempt also fails, the
        delivery is dead-lettered and not tried again. Pending retries also stop when you disable
        or delete the webhook.
      </p>
      <p>
        Delivery is at least once. A retry can reach you even after an earlier attempt was
        processed, for example when your endpoint did the work but answered too slowly. Every
        attempt for the same event carries the same <code>X-Spanlens-Delivery-Id</code>, so record
        the IDs you have handled and skip repeats. Events are not guaranteed to arrive in order.
      </p>

      <h3>Redirects</h3>
      <p>
        Spanlens follows up to 3 redirects and sends the same signed POST, body and headers
        included, to each new location. Every location has to pass the same checks as the URL you
        registered: it must use HTTPS and must not resolve to a private, loopback, link-local, or
        cloud metadata address. The address is checked again at the moment Spanlens connects, so a
        DNS record that changes after the first check cannot get around it. A redirect that fails
        these checks, or a fourth redirect in a row, fails the attempt. Registering the final URL
        saves the extra round trips.
      </p>

      <h2>Delivery history</h2>
      <p>
        <code>GET /api/v1/webhooks/:id/deliveries</code> returns the 10 most recent delivery
        records, newest first. Each record describes one event and the result of its latest
        attempt: <code>status</code>, <code>http_status</code>, <code>error_message</code>, and{' '}
        <code>duration_ms</code>, plus <code>attempt_count</code>, <code>next_retry_at</code> while
        a retry is pending, and <code>dlq_at</code> with <code>dlq_reason</code> once the delivery
        has been dead-lettered. The record <code>id</code> is the value sent as{' '}
        <code>X-Spanlens-Delivery-Id</code>. The response body from your endpoint is not stored, so
        check your server logs alongside the delivery history when you see repeated 4xx or 5xx
        responses.
      </p>
      <CodeBlock language="bash">{`curl https://api.spanlens.io/api/v1/webhooks/<webhook-id>/deliveries \\
  -H "Authorization: Bearer <JWT>"`}</CodeBlock>
      <CodeBlock language="json">{`{
  "success": true,
  "data": [
    {
      "id": "6f1c3a9e-...",
      "webhook_id": "8d0c41f2-...",
      "event_type": "request.created",
      "status": "failed",
      "http_status": 503,
      "error_message": "HTTP 503",
      "duration_ms": 412,
      "attempt_count": 2,
      "next_retry_at": "2026-05-15T09:04:24.000Z",
      "dlq_at": null,
      "dlq_reason": null,
      "delivered_at": "2026-05-15T09:01:24.000Z"
    }
  ]
}`}</CodeBlock>
      <p className="text-sm text-muted-foreground">
        Abridged. Records also carry the stored <code>payload</code> and internal bookkeeping
        fields.
      </p>

      <h2>Test delivery</h2>
      <p>
        Call <code>POST /api/v1/webhooks/:id/test</code> to immediately send a dummy payload.
        Use this to verify your endpoint URL and signature verification logic without waiting for
        a real event.
      </p>
      <CodeBlock language="bash">{`curl -X POST https://api.spanlens.io/api/v1/webhooks/wh_01j9abc.../test \\
  -H "Authorization: Bearer <JWT>"`}</CodeBlock>

      <h2>Permissions</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>admin</th>
            <th>editor</th>
            <th>viewer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>List / delivery history</td>
            <td>✓</td>
            <td>✓</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Create / update / delete</td>
            <td>✓</td>
            <td>✓</td>
            <td>,</td>
          </tr>
          <tr>
            <td>Test delivery</td>
            <td>✓</td>
            <td>✓</td>
            <td>,</td>
          </tr>
        </tbody>
      </table>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>20 webhooks per organization maximum.</strong>
        </li>
        <li>
          <strong>Up to 5 attempts per event.</strong> A delivery that still fails after 4 retries,
          roughly 20 to 30 minutes after the first attempt, is dead-lettered and not sent again.
          Deliveries are at least once, so deduplicate on <code>X-Spanlens-Delivery-Id</code>. See{' '}
          <a href="#retries">retries and duplicates</a>.
        </li>
        <li>
          <strong>The deliveries endpoint returns the 10 most recent records</strong> per webhook.
          Store delivery logs on your server if you need a complete audit trail.
        </li>
        <li>
          <strong>HTTPS required.</strong> HTTP URLs are rejected at registration time, and
          redirects to HTTP URLs are not followed.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related:{' '}
        <a href="/docs/features/alerts">Alerts</a> (threshold-based notifications),{' '}
        <a href="/docs/features/audit-logs">Audit logs</a> (change history),{' '}
        <a href="/docs/features/security">Security</a> (PII / prompt injection scanning).
      </p>
    </div>
  )
}
