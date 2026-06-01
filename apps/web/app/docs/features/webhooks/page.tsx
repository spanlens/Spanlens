import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Webhooks · Spanlens Docs',
  description:
    'Receive Spanlens events (request created, trace completed, alert triggered) as real-time HTTP POST payloads on your own server.',
}

export default function WebhooksDocs() {
  return (
    <div>
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

      <CodeBlock language="bash">{`curl -X POST https://server.spanlens.io/api/v1/webhooks \\
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
        Spanlens sends the following JSON body as an HTTP POST to your endpoint when an event fires.
      </p>
      <CodeBlock language="json">{`{
  "event": "request.created",
  "created_at": "2026-05-15T09:01:23Z",
  "data": {
    "id": "req_01j9xyz...",
    "project_id": "proj_01j9...",
    "model": "gpt-4o-mini-2024-07-18",
    "provider": "openai",
    "input_tokens": 512,
    "output_tokens": 128,
    "cost_usd": 0.000096,
    "duration_ms": 843
  }
}`}</CodeBlock>
      <p>
        The shape of the <code>data</code> field varies by event type.{' '}
        <code>request.created</code> contains a summary of the request row;{' '}
        <code>trace.completed</code> contains trace metadata; and{' '}
        <code>alert.triggered</code> contains the triggered rule and its current value.
      </p>

      <h2>Signature verification</h2>
      <p>
        Every delivery includes an <code>X-Spanlens-Signature</code> header. The value is an
        HMAC-SHA256 digest of the raw request body using the <code>secret</code> issued at
        registration. Always verify the signature to reject forged requests.
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

  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signatureHeader, 'hex')
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

      <h2>Delivery history</h2>
      <p>
        <code>GET /api/v1/webhooks/:id/deliveries</code> returns the last 10 delivery records.
        Each record includes the HTTP status code, the first 500 characters of the response body,
        and the delivery timestamp. If you see repeated 4xx or 5xx responses, check your server
        logs alongside the delivery history.
      </p>
      <CodeBlock language="bash">{`curl https://server.spanlens.io/api/v1/webhooks/wh_01j9abc.../deliveries \\
  -H "Authorization: Bearer <JWT>"`}</CodeBlock>
      <CodeBlock language="json">{`[
  {
    "id": "del_01j9...",
    "event": "request.created",
    "status_code": 200,
    "response_body": "{\"ok\":true}",
    "delivered_at": "2026-05-15T09:01:24Z"
  }
]`}</CodeBlock>

      <h2>Test delivery</h2>
      <p>
        Call <code>POST /api/v1/webhooks/:id/test</code> to immediately send a dummy payload.
        Use this to verify your endpoint URL and signature verification logic without waiting for
        a real event.
      </p>
      <CodeBlock language="bash">{`curl -X POST https://server.spanlens.io/api/v1/webhooks/wh_01j9abc.../test \\
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
          <strong>No retries.</strong> If your server returns a non-2xx status or times out (10s),
          the delivery is recorded as failed and is not retried. Implement idempotency on your
          receiver side.
        </li>
        <li>
          <strong>Only the last 10 delivery records are kept</strong> per webhook. Store delivery
          logs on your server if you need a complete audit trail.
        </li>
        <li>
          <strong>HTTPS required.</strong> HTTP URLs are rejected at registration time.
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
