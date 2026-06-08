import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Shared links · Spanlens Docs',
  description:
    'Publish a public read-only render of any trace or request via /share/<token>. Manage every link from the workspace Shared links page with redaction presets, view counts, and one-click revoke.',
}

export default function SharesDocs() {
  return (
    <div>
      <h1>Shared links</h1>
      <p className="lead">
        Anyone you give a Spanlens share link to can read the trace or request without
        signing up. The token in the URL is the only credential, and you stay in control:
        each link respects the redaction settings you picked, expires when you said it
        would, and can be revoked the moment it leaks.
      </p>

      <h2>When to use a share link</h2>
      <ul>
        <li>
          <strong>Bug reports.</strong> Paste the link in an issue so a teammate or vendor
          can see the exact LLM call without an account.
        </li>
        <li>
          <strong>Marketing and content.</strong> Embed a redacted trace in a blog post
          showing how your agent handled a tough prompt.
        </li>
        <li>
          <strong>Customer success.</strong> Send a customer the trace from their support
          ticket so they can see what their request actually returned.
        </li>
      </ul>

      <h2>Create a share</h2>
      <p>
        Open any trace at <code>/traces/&lt;id&gt;</code> or any request at{' '}
        <code>/requests/&lt;id&gt;</code> and click the <strong>Share</strong> icon in the
        top right. The dialog asks for two decisions.
      </p>

      <h3>Expiry</h3>
      <p>
        <strong>7 days</strong>, <strong>30 days</strong> (default), or <strong>Never</strong>.
        A link past its expiry returns 404 instead of 410 so a token cannot be enumerated
        by probing expired URLs.
      </p>

      <h3>Redaction preset</h3>
      <p>Pick one of three intents instead of toggling each field by hand.</p>
      <ul>
        <li>
          <strong>Marketing / external.</strong> PII patterns plus cost plus token counts
          all hidden. The viewer still sees the conversation, latency, and HTTP status, and
          that is usually what you want for a public post.
        </li>
        <li>
          <strong>Internal team.</strong> Everything visible. Best for a Slack channel where
          every reader is already inside your trust boundary and the debugging value of
          token counts outweighs the leak risk.
        </li>
        <li>
          <strong>Custom.</strong> Flip the individual toggles. The preset chip switches to
          Custom the moment you change anything, so the dialog never lies about what is
          selected.
        </li>
      </ul>
      <p>
        The defaults are fail safe. New shares start with PII masking and cost hiding on.
        Token counts stay visible by default since they carry most of the debugging signal,
        and search engine indexing stays off.
      </p>

      <h3>What gets masked</h3>
      <ul>
        <li>
          <strong>PII.</strong> Provider keys (<code>sk-…</code>, <code>sk-ant-…</code>,{' '}
          <code>AIza…</code>) and Spanlens keys (<code>sl_live_…</code>) inside request and
          response bodies. Pattern based, so it catches the typical accidental paste.
        </li>
        <li>
          <strong>Cost.</strong> The cost column reads <code>$&middot;&middot;&middot;</code>
          in the viewer.
        </li>
        <li>
          <strong>Token counts.</strong> Prompt, completion, and total counts read{' '}
          <code>&middot;&middot;&middot;</code> in the viewer.
        </li>
      </ul>

      <h2>What the viewer looks like</h2>
      <p>
        The shared page renders a clean read-only view with input and output side by side
        on desktop (stacked on mobile), latency and token stats at the top, and a Spanlens
        attribution footer that links to the signup page. Every visit bumps the share view
        count by one.
      </p>
      <p>
        The page also emits Open Graph and Twitter card metadata, so a link posted to
        Slack, X, or LinkedIn shows the trace name plus the provider and model in the
        preview. Search engines stay blocked unless you explicitly flip the{' '}
        <code>indexable</code> toggle when creating the share.
      </p>

      <h2>Manage your shares</h2>
      <p>
        The workspace <a href="/shares"><strong>Shared links</strong></a> page lists every
        active share in your organization, not just the ones you created. Any organization
        member can revoke any share, so a leaked link from a teammate does not require
        admin intervention.
      </p>
      <p>Each row shows:</p>
      <ul>
        <li>
          <strong>Target.</strong> Trace name when the share is a trace, otherwise{' '}
          <code>Request &lt;short-id&gt;</code>. Click to open the public viewer in a new
          tab.
        </li>
        <li>
          <strong>Redaction chips.</strong> Three chips for PII, Cost, and Tokens, plus an
          extra warning chip when <code>indexable</code> is on. A glance tells you which
          shares are still leaking workload intel.
        </li>
        <li>
          <strong>Views.</strong> Cumulative view count since the link was published.
        </li>
        <li>
          <strong>Created and Expires.</strong> Expiry under seven days surfaces in a
          warning color so renewals do not slip.
        </li>
        <li>
          <strong>Revoke.</strong> Soft delete with a confirm prompt. The public URL starts
          returning 404 immediately and cannot be undone.
        </li>
      </ul>

      <h3>Sort and filter</h3>
      <p>
        Filter by <strong>Workspace</strong> (default, every member) or <strong>My
        shares</strong> (only what you published). Sort by <strong>Newest</strong> (default),
        <strong>Most viewed</strong>, or <strong>Expiring soonest</strong>.
      </p>

      <h2>API</h2>
      <p>
        The dashboard uses these endpoints; you can call them from a script too if you need
        to bulk audit or revoke. All three require a Spanlens dashboard JWT, which you can
        grab from your browser session.
      </p>
      <CodeBlock language="bash">{`# List every active share in the workspace, sorted by view count
curl 'https://server.spanlens.io/api/v1/shares?scope=org&sort=views' \\
  -H "Authorization: Bearer $SPANLENS_JWT"

# Create a share with the Marketing redaction preset
curl -X POST https://server.spanlens.io/api/v1/shares \\
  -H "Authorization: Bearer $SPANLENS_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "scope": "trace",
    "targetId": "<trace-uuid>",
    "ttl": "30d",
    "redactPii": true,
    "redactCost": true,
    "redactTokens": true
  }'

# Revoke a share immediately (soft delete, view_count preserved)
curl -X DELETE https://server.spanlens.io/api/v1/shares/<token> \\
  -H "Authorization: Bearer $SPANLENS_JWT"`}</CodeBlock>

      <h2>Security model</h2>
      <p>
        The token in the URL is the only credential. There is no per-viewer ACL. Tokens are
        128 bits of entropy generated server side, well above any brute force threshold for
        a rate limited public endpoint. Treat a share link the same way you treat a
        signed S3 URL: anyone who gets the URL gets read access until you revoke or the
        link expires.
      </p>
      <p>
        Server-side enforcement runs through the service role client and reads the
        underlying Postgres or ClickHouse row directly. The retention bypass keeps a
        long-lived share resolvable past your plan&apos;s normal retention window, up to the
        365 day ceiling on the analytics table.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/traces">Traces</a> (where you create most shares),{' '}
        <a href="/docs/features/security">Security</a> (PII masking patterns),{' '}
        <a href="/docs/features/projects">Projects &amp; API keys</a> (the other
        externally-issued credential type).
      </p>
    </div>
  )
}
