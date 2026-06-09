export const metadata = {
  title: 'API error codes · Spanlens Docs',
  description:
    'Stable error.code values returned by the Spanlens server for every 4xx/5xx response. Branch on the code in your client; treat the message as user-facing copy.',
}

/**
 * Sprint 7 R-15 + R-20 docs page.
 *
 * Renders the standard error envelope plus the catalog of stable error
 * codes the server emits. Hand-authored to avoid importing the server's
 * runtime ERROR_CODES into the Next build (would either pull in server
 * dependencies or require a value-export workspace package). Drift is
 * prevented by the catalog contract test in apps/server/src/lib/errors.contract.test.ts
 * which fails when the server catalog and the api-types KnownApiErrorCode
 * union go out of sync.
 *
 * When adding a new code:
 *   1. Add to ERROR_CODES in apps/server/src/lib/errors.ts
 *   2. Add to KnownApiErrorCode union in packages/api-types/src/index.ts
 *   3. Add a row to ERROR_CATALOG_ROWS below (same status + message)
 *   4. Contract test in errors.contract.test.ts validates 1 + 2 stay in sync
 *
 * The page itself is a static server component, no client JS bytes.
 */

interface CatalogRow {
  code: string
  status: number
  description: string
}

const ERROR_CATALOG_ROWS: CatalogRow[] = [
  {
    code: 'UNAUTHORIZED',
    status: 401,
    description: 'Missing, malformed, or invalid Authorization header. Re-authenticate.',
  },
  {
    code: 'FORBIDDEN',
    status: 403,
    description: 'Authenticated but the caller lacks permission for this resource or action.',
  },
  {
    code: 'PUBLIC_KEY_WRITE_FORBIDDEN',
    status: 403,
    description:
      'Public scope key (sl_live_pub_*) cannot use proxy, ingest, or OTLP endpoints. Use a full-scope key.',
  },
  {
    code: 'ORGANIZATION_NOT_FOUND',
    status: 404,
    description: 'The active workspace context could not be resolved from the auth token.',
  },
  {
    code: 'PROJECT_NOT_FOUND',
    status: 404,
    description: 'The project id supplied does not exist in the active workspace.',
  },
  {
    code: 'NOT_FOUND',
    status: 404,
    description: 'The requested resource (trace, evaluator, share, etc.) does not exist or was deleted.',
  },
  {
    code: 'CONFLICT',
    status: 409,
    description: 'The write conflicts with current state. Refetch and retry, or surface the conflict to the user.',
  },
  {
    code: 'VALIDATION_FAILED',
    status: 400,
    description: 'Request body failed validation. The details object names the offending fields.',
  },
  {
    code: 'INVALID_JSON_BODY',
    status: 400,
    description: 'Request body is not parseable JSON.',
  },
  {
    code: 'BAD_REQUEST',
    status: 400,
    description:
      'Generic 400 fallback for legacy handlers whose error message does not match a more specific shape. New handlers should prefer VALIDATION_FAILED with a details object instead.',
  },
  {
    code: 'NO_PROVIDER_KEY',
    status: 400,
    description:
      'The Spanlens key has no active provider key registered for this provider. Add one on the Projects & Keys page.',
  },
  {
    code: 'RATE_LIMIT',
    status: 429,
    description:
      'Per-key rate limit exceeded. The Retry-After header and X-RateLimit-* headers carry the remaining quota and reset time. Back off and retry.',
  },
  {
    code: 'UPSTREAM_TIMEOUT',
    status: 504,
    description:
      'Upstream provider (OpenAI / Anthropic / Gemini) did not respond within the timeout. Safe to retry.',
  },
  {
    code: 'UPSTREAM_FAILED',
    status: 502,
    description: 'Upstream provider returned an error or the network failed. The details object carries the provider name.',
  },
  {
    code: 'DECRYPT_FAILED',
    status: 503,
    description:
      'Provider key decryption failed. Operator-side configuration drift; the operator should rotate ENCRYPTION_KEY.',
  },
  {
    code: 'INTERNAL_ERROR',
    status: 500,
    description:
      'Unexpected server error. The Spanlens operator can grep server logs by the requestId echoed in the envelope.',
  },
]

export default function ApiErrorsPage() {
  return (
    <div>
      <h1>API error codes</h1>
      <p className="lead">
        Every 4xx and 5xx response from the Spanlens server uses one stable shape. Branch
        your client logic on <code>error.code</code> from the catalog below; surface
        <code>error.message</code> to your user; log <code>error.requestId</code> for
        support tickets.
      </p>

      <h2>Standard envelope</h2>
      <p>Every error response carries this exact shape.</p>
      <pre>{`HTTP/1.1 4xx Status
X-Request-ID: 018f5dcb-1234-7890-9abc-def012345678
Content-Type: application/json

{
  "error": {
    "code": "PUBLIC_KEY_WRITE_FORBIDDEN",
    "message": "Public scope keys cannot use proxy, ingest, or OTLP endpoints",
    "details": { "scope": "public" },
    "requestId": "018f5dcb-1234-7890-9abc-def012345678"
  }
}`}</pre>

      <ul>
        <li>
          <code>code</code> is stable. The server may add new codes without notice, but
          existing codes do not change spelling or status.
        </li>
        <li>
          <code>message</code> is human-readable; safe to show to end users but may change
          between releases.
        </li>
        <li>
          <code>details</code> is a free-form object carrying context for that specific
          code. Always optional; do not depend on its presence.
        </li>
        <li>
          <code>requestId</code> echoes the <code>X-Request-ID</code> header on the same
          response. Quote it in support tickets so the operator can pull the matching
          server logs.
        </li>
      </ul>

      <h2>Catalog</h2>
      <p>
        Current as of this docs build. Generated from the server&apos;s
        <code>ERROR_CODES</code> table in
        <code>apps/server/src/lib/errors.ts</code>; a contract test fails CI if the
        catalog and the <code>@spanlens/api-types</code> union drift apart.
      </p>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>HTTP status</th>
            <th>When you see it</th>
          </tr>
        </thead>
        <tbody>
          {ERROR_CATALOG_ROWS.map((row) => (
            <tr key={row.code}>
              <td>
                <code>{row.code}</code>
              </td>
              <td>{row.status}</td>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Client examples</h2>

      <h3>TypeScript (Spanlens SDK)</h3>
      <p>
        The SDK auto-unwraps the envelope into a typed
        <code>SpanlensApiError</code>. With <code>silent: false</code> it throws;
        with the default <code>silent: true</code> it routes the typed error through
        the <code>onError</code> callback so observability code keeps user code crash-free.
      </p>
      <pre>{`import { SpanlensClient, SpanlensApiError } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: 'sl_live_...', silent: false })

try {
  await client.ingestEvent({ event_type: 'span', /* ... */ })
} catch (err) {
  if (err instanceof SpanlensApiError) {
    if (err.code === 'PUBLIC_KEY_WRITE_FORBIDDEN') {
      // Show an actionable upgrade hint, not the raw message.
      showUpgradeBanner()
    } else {
      reportToSentry(err, { requestId: err.requestId })
    }
  } else {
    // Network failure or non-envelope response — keep your existing handler.
    throw err
  }
}`}</pre>

      <h3>Raw fetch</h3>
      <pre>{`const res = await fetch('https://server.spanlens.io/api/v1/foo', {
  headers: { Authorization: 'Bearer ' + apiKey }
})
if (!res.ok) {
  const body = await res.json()
  if (body.error?.code === 'NO_PROVIDER_KEY') {
    // ...
  }
  console.error('spanlens error', body.error?.code, body.error?.requestId)
}`}</pre>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/sdk">@spanlens/sdk</a> (typed exception details),
        <a href="/docs/proxy">Direct proxy</a> (rate limit headers also use this
        envelope on 429).
      </p>
    </div>
  )
}
