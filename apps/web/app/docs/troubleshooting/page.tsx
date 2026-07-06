import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/troubleshooting' },
  title: 'Troubleshooting · Spanlens Docs',
  description:
    'Symptom-first fixes for the most common Spanlens problems: 401/403 auth, 429 rate limits, 502/503/504 upstream errors, missing requests, empty traces, and truncated streaming responses.',
}

/**
 * Symptom-oriented companion to /docs/api/errors.
 *
 * The error-codes page is organized by error.code (given a code, what does it
 * mean). This page is organized by observable symptom (given what you see, what
 * is the likely cause and fix) and links back to the matching code. Kept a
 * zero-JS static server component like errors/page.tsx: no 'use client', no
 * imports, plain prose + <pre> + <table>. The layout wraps this in .prose.
 *
 * Every claim here is grounded in the server behavior documented in CLAUDE.md
 * 'Known Gotchas' and the proxy / quick-start docs. When server behavior
 * changes, update the matching row here and in /docs/api/errors.
 */

interface SymptomRow {
  status: string
  cause: string
  fix: string
}

const STATUS_ROWS: SymptomRow[] = [
  {
    status: '401 UNAUTHORIZED',
    cause:
      'Missing, malformed, or wrong auth header. The runtime has no SPANLENS_API_KEY, or the upstream client is still pointed at the provider with the provider key.',
    fix: 'Send your Spanlens key (sl_live_…), not the provider key. OpenAI/Azure clients use Authorization: Bearer sl_live_…; Anthropic uses x-api-key: sl_live_…; Gemini uses x-goog-api-key: sl_live_…. Confirm SPANLENS_API_KEY is set in the runtime.',
  },
  {
    status: '403 PUBLIC_KEY_WRITE_FORBIDDEN',
    cause:
      'A public-scope key (sl_live_pub_…) was used on a write endpoint. Public keys are read-only by design and are rejected on /proxy/*, /ingest/*, and OTLP /v1/traces.',
    fix: 'Use a full-scope key (sl_live_… without the pub_ segment) for proxying and ingest. Keep public keys for MCP servers, BI tools, and read embeds only.',
  },
  {
    status: '429 RATE_LIMIT',
    cause:
      'A rate limit fired. Two distinct kinds: (1) a limit you configured on a key/project/end-user, or (2) your Spanlens plan monthly request quota.',
    fix: 'Read details.source. "customer_limit" is one you set, so back off using Retry-After, or raise it on the Projects page. A plan/quota 429 includes an upgrade link; upgrade or wait for the window to reset.',
  },
  {
    status: '400 NO_PROVIDER_KEY',
    cause:
      'The Spanlens key has no active provider key registered for the provider you called (inferred from the URL path).',
    fix: 'Open /projects, expand the Spanlens key, click Add provider key, pick the matching provider (OpenAI / Anthropic / Gemini / …), and paste your real AI key.',
  },
  {
    status: '502 UPSTREAM_FAILED',
    cause:
      'The upstream provider returned an error or the network to it failed. details.provider names which one.',
    fix: 'Usually a provider-side incident or a bad request the provider rejected. Check the provider status page, inspect the row in /requests for the upstream error body, then retry.',
  },
  {
    status: '503 DECRYPT_FAILED',
    cause:
      'The stored provider key could not be decrypted. Operator-side configuration drift: ENCRYPTION_KEY no longer matches the key used when the provider key was saved.',
    fix: 'Self-host only. The operator must restore the original ENCRYPTION_KEY, or re-enter every provider key under the new one. See the empty-decryption section below.',
  },
  {
    status: '504 UPSTREAM_TIMEOUT',
    cause:
      'A non-streaming upstream call did not return headers within the timeout (UPSTREAM_TIMEOUT_MS, 35s). The provider was slow or the generation was very long.',
    fix: 'Safe to retry. For long generations, switch to streaming (stream: true) so the first byte arrives in ~200 ms and you use the 290s stream budget instead of the 35s header timeout.',
  },
]

export default function TroubleshootingPage() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Troubleshooting</h1>
      <p className="lead">
        Start from the symptom you are seeing. Each section gives the likely cause and the
        fix. This page is organized by what you observe; the{' '}
        <a href="/docs/api/errors">error-codes reference</a> is organized by the stable{' '}
        <code>error.code</code> value, so branch your client logic there and use this page to
        diagnose.
      </p>

      <h2 id="status-quick-reference">HTTP status quick reference</h2>
      <p>
        Every 4xx / 5xx response carries the standard envelope (
        <code>error.code</code>, <code>error.message</code>, <code>error.details</code>,{' '}
        <code>error.requestId</code>). Match the status you got, then jump to the section
        below for the full walkthrough.
      </p>
      <table>
        <thead>
          <tr>
            <th>Status &amp; code</th>
            <th>Likely cause</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          {STATUS_ROWS.map((row) => (
            <tr key={row.status}>
              <td>
                <code>{row.status}</code>
              </td>
              <td>{row.cause}</td>
              <td>{row.fix}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="auth">Authentication and scope (401 / 403)</h2>
      <p>
        A <code>401 UNAUTHORIZED</code> means the server could not authenticate the request at
        all; a <code>403</code> means it authenticated you but the key is not allowed to do
        what you asked.
      </p>

      <h3>Send the Spanlens key on the header your provider SDK uses</h3>
      <p>
        You authenticate with your <em>Spanlens</em> key (<code>sl_live_…</code>), never the
        raw provider key. Each provider SDK puts the key on a different header, and the proxy
        accepts whichever one arrives:
      </p>
      <pre>{`OpenAI / Azure   Authorization: Bearer sl_live_...
Anthropic        x-api-key: sl_live_...
Gemini           x-goog-api-key: sl_live_...`}</pre>
      <p>
        If you use an official provider SDK, you do not set these by hand: pass the Spanlens
        key as the SDK&apos;s <code>api_key</code> and point <code>base_url</code> at the matching{' '}
        <a href="/docs/proxy">proxy URL</a>. A stray <code>401 &quot;Incorrect API key&quot;</code>
        almost always means one of: <code>SPANLENS_API_KEY</code> is missing in the runtime,
        the value has a typo or trailing whitespace, or the client is still constructed with
        the upstream <code>baseURL</code> so the request never reaches Spanlens.
      </p>

      <h3>403 PUBLIC_KEY_WRITE_FORBIDDEN (wrong key scope)</h3>
      <p>
        Spanlens keys come in two scopes. A <strong>full</strong> key (
        <code>sl_live_…</code>) can proxy, ingest, and read. A <strong>public</strong> key (
        <code>sl_live_pub_…</code>) is read-only and is deliberately rejected on every write
        path (<code>/proxy/*</code>, <code>/ingest/*</code>, and OTLP{' '}
        <code>/v1/traces</code>) with:
      </p>
      <pre>{`HTTP/1.1 403 Forbidden

{
  "error": {
    "code": "PUBLIC_KEY_WRITE_FORBIDDEN",
    "message": "Public scope keys cannot use proxy, ingest, or OTLP endpoints",
    "details": { "scope": "public" }
  }
}`}</pre>
      <p>
        Fix: use a full-scope key for proxying and ingest. Public keys are meant for places
        where the key is exposed in plaintext (MCP servers, BI dashboards, read-only embeds),
        so they can only call the read APIs. You issue full keys per project and public keys
        per workspace on the <a href="/projects">Projects</a> page.
      </p>

      <h2 id="rate-limits">Which rate limit fired (429)</h2>
      <p>
        A <code>429 RATE_LIMIT</code> can come from two very different places. Read{' '}
        <code>error.details.source</code> to tell them apart before you change anything.
      </p>

      <h3>Customer-configured limit (details.source = &quot;customer_limit&quot;)</h3>
      <p>
        This is a limit <em>you</em> set on a Spanlens key, a project, or an individual
        end-user from the <a href="/projects">Projects</a> page. It exists precisely to
        throttle that traffic, so exceeding it does reject the call. The body tells you which
        limit fired:
      </p>
      <pre>{`{
  "error": {
    "code": "RATE_LIMIT",
    "message": "Customer-configured rate limit exceeded (end_user): 60 requests per 60s.",
    "details": {
      "source": "customer_limit",
      "scope": "end_user",
      "limit": 60,
      "window_seconds": 60,
      "end_user_id": "user_123"
    }
  }
}`}</pre>
      <p>
        The response also carries <code>Retry-After</code> (window length in seconds) and{' '}
        <code>X-Spanlens-RateLimit-Scope</code> (<code>api_key</code>, <code>project</code>,
        or <code>end_user</code>). A <code>customer_limit</code> 429 never includes an upgrade
        link, which is how you distinguish it from a plan limit. Per-end-user limits bucket on
        the <code>X-Spanlens-User</code> header, so send it for those limits to apply. Fix:
        back off until <code>Retry-After</code>, or raise the limit on the Projects page.
      </p>

      <h3>Spanlens plan quota</h3>
      <p>
        Separate from your own limits, your plan has a monthly request quota. When that is the
        limit that fired, the error includes plan and upgrade context. Fix: upgrade the plan
        or wait for the quota window to reset. See{' '}
        <a href="/docs/features/billing">billing &amp; quotas</a>.
      </p>
      <p>
        There is also a high platform ceiling on <code>/proxy/*</code> that only exists to
        stop a runaway loop. Going over it does <strong>not</strong> reject the request: the
        call still passes through and the response carries{' '}
        <code>X-Spanlens-RateLimit-Overage: true</code> so you can spot the spike. Every
        proxy response also carries <code>X-RateLimit-Limit</code>,{' '}
        <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code> (unix epoch
        second), and <code>X-RateLimit-Window</code>; read <code>X-RateLimit-Reset</code>
        directly instead of parsing your own clock to avoid skew. Details in{' '}
        <a href="/docs/proxy#rate-limits">the proxy docs</a>.
      </p>

      <h2 id="upstream">Upstream and provider-key errors (502 / 503 / 504)</h2>
      <p>
        These are the failures that happen after your request is authenticated but before (or
        during) the call to the real provider.
      </p>
      <ul>
        <li>
          <code>502 UPSTREAM_FAILED</code> means the provider returned an error or the network to
          it failed. <code>details.provider</code> names which provider. Check the provider
          status page and the row in <a href="/requests">/requests</a> for the upstream error
          body, then retry.
        </li>
        <li>
          <code>504 UPSTREAM_TIMEOUT</code> means a non-streaming call did not return headers
          within the ~35s header timeout. The provider was slow or the generation was long.
          Safe to retry; better yet switch to streaming (see{' '}
          <a href="#truncated">truncated responses</a> below).
        </li>
        <li>
          <code>503 DECRYPT_FAILED</code> means the stored provider key could not be decrypted.
          This is operator-side configuration drift, not a client bug. See the next section.
        </li>
      </ul>

      <h2 id="no-requests">Requests are not appearing in the dashboard</h2>
      <p>
        You are making LLM calls but <a href="/requests">/requests</a> stays empty. Work
        through these in order; each is a real cause we have seen in the field.
      </p>
      <ol>
        <li>
          <strong>The Spanlens key is not set in the deployed environment.</strong> Setting{' '}
          <code>SPANLENS_API_KEY</code> in <code>.env.local</code> covers local dev only. Add
          it to your production environment (Vercel / Railway / Fly) as well, then{' '}
          <strong>redeploy</strong>, because new env values do not apply to existing deployments.
        </li>
        <li>
          <strong>The request is still going to the provider directly.</strong> In your
          Network tab the call should hit{' '}
          <code>server.spanlens.io/proxy/*</code>, not <code>api.openai.com</code> (or the
          equivalent). If it is not, the client is constructed with the upstream{' '}
          <code>baseURL</code>; use the SDK helper or set <code>base_url</code> to the proxy.
        </li>
        <li>
          <strong>No provider key is registered</strong> → the call returns{' '}
          <code>400 NO_PROVIDER_KEY</code> instead of logging. Add one under the Spanlens key
          on <a href="/projects">/projects</a>.
        </li>
        <li>
          <strong>Your app is silently in mock mode.</strong> Some apps return a canned 200
          &quot;mock&quot; response when an API key env var is missing, so the AI looks like
          it works but no real call is ever made and nothing reaches Spanlens. After adding
          env vars, confirm a real row lands in <a href="/requests">/requests</a> rather than
          trusting the app response.
        </li>
      </ol>
      <h3>Verify with one curl call</h3>
      <p>
        The fastest way to isolate app config from Spanlens config is to bypass your app
        entirely and hit the proxy directly. A row should appear in{' '}
        <a href="/requests">/requests</a> within a few seconds:
      </p>
      <pre>{`curl https://server.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "ping"}]
  }'`}</pre>
      <ul>
        <li>
          Get a <code>200</code> and a row appears → Spanlens is configured correctly; the
          gap is in your application (env not loaded, wrong base URL, or mock mode).
        </li>
        <li>
          Get a <code>401</code> → the key is wrong or not exported in this shell.
        </li>
        <li>
          Get a <code>400 NO_PROVIDER_KEY</code> → register a provider key (step 3 above).
        </li>
      </ul>

      <h2 id="empty-traces">Traces show Spans: 0 / Tokens: 0</h2>
      <p>
        A trace exists in <a href="/traces">/traces</a> but shows zero spans and zero tokens.
        This is the signature of an <strong>outdated SDK</strong>. Older SDK versions fired
        the trace and its child-span ingest POSTs concurrently, so a span could arrive before
        the trace row was committed and be silently dropped; a late <code>end()</code> patch
        then found no row to update. Short traces happened to pass, which is why it slips
        through in dev.
      </p>
      <p>
        Fix: upgrade the SDK. The ingest ordering race was fixed by chaining child POSTs
        after the parent creation promise; make sure you are on a current release:
      </p>
      <pre>{`pnpm add @spanlens/sdk@latest
# or: npm install @spanlens/sdk@latest`}</pre>
      <p>
        If you built a custom ingest client instead of using the SDK, replicate the same
        rule: do not POST a child span until the parent trace create has resolved, and do not
        send an <code>end()</code> patch until the span create has resolved. See the{' '}
        <a href="/docs/sdk">SDK reference</a>.
      </p>

      <h2 id="truncated">Response cut off or shows a &quot;truncated&quot; badge</h2>
      <p>
        A streaming response stops early and the row in <a href="/requests">/requests</a>
        carries a <code>truncated</code> badge. The proxy runs on Vercel Pro with a 300-second
        hard ceiling and gracefully closes streams at <strong>290 seconds</strong> to leave
        room to flush the log. A generation that runs past that budget is cut off, the
        partial output is logged with <code>truncated: true</code>, and your client sees the
        stream end before <code>[DONE]</code> / <code>message_stop</code>.
      </p>
      <p>Options, in order of preference:</p>
      <ul>
        <li>
          <strong>Lower the work per call.</strong> Reduce <code>max_tokens</code> or split
          the task so a single generation finishes well inside 290 seconds.
        </li>
        <li>
          <strong>Use streaming with chunked accumulation.</strong> For large{' '}
          <code>max_tokens</code> or JSON mode with big outputs, set{' '}
          <code>stream: true</code> and accumulate chunks, and the first byte arrives in ~200 ms
          and you get partial output even if the deadline is hit.
        </li>
        <li>
          <strong>Self-hosting?</strong> The deadline is tunable with the{' '}
          <code>STREAM_DEADLINE_MS</code> env var (default <code>290000</code>). On a Vercel
          Hobby plan, whose function ceiling is 60s, set it to about <code>50000</code>.
        </li>
      </ul>
      <p>
        Note: a non-streaming call that exceeds the header timeout returns{' '}
        <code>504 UPSTREAM_TIMEOUT</code> instead of a truncated row, which is the same
        underlying &quot;too slow&quot; problem, which is why streaming is the fix for both.
        More detail in <a href="/docs/proxy">the proxy docs</a>.
      </p>

      <h2 id="empty-decryption">Provider key decryption returns empty (self-host)</h2>
      <p>
        On a self-hosted instance, provider keys are stored encrypted with AES-256-GCM under
        your <code>ENCRYPTION_KEY</code>. If that key does not match the one in use when a
        provider key was saved, decryption can fail quietly and yield an empty string rather
        than an error, so the upstream call goes out with no credential and the provider
        rejects it. When the failure surfaces as a typed error it is{' '}
        <code>503 DECRYPT_FAILED</code>.
      </p>
      <p>Checklist for the operator:</p>
      <ul>
        <li>
          <code>ENCRYPTION_KEY</code> must be a 32-byte base64 value and must be{' '}
          <em>identical</em> across every instance and deploy that reads the same database.
        </li>
        <li>
          If the key was rotated, the old provider-key rows can no longer be decrypted.
          Restore the original <code>ENCRYPTION_KEY</code>, or re-enter every provider key on{' '}
          the <a href="/projects">Projects</a> page so they are re-encrypted under the new
          value.
        </li>
        <li>
          Watch for calls that reach the provider with no credential (upstream 401): an empty
          decryption result is the usual cause. See{' '}
          <a href="/docs/self-host">self-hosting</a> for environment setup.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Still stuck? Look up the exact code in the{' '}
        <a href="/docs/api/errors">error-codes reference</a>, review the{' '}
        <a href="/docs/proxy">proxy docs</a> for headers and the stream deadline, or open an
        issue at{' '}
        <a href="https://github.com/spanlens/Spanlens/issues">github.com/spanlens/Spanlens/issues</a>{' '}
        with the <code>error.requestId</code> from the response so the operator can pull the
        matching logs.
      </p>
    </div>
  )
}
