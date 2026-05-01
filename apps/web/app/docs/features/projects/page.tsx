import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Projects & API keys · Spanlens Docs',
  description:
    'Scope your traffic into projects (dev / staging / prod, per-service) and issue API keys with SHA-256 hashed storage.',
}

export default function ProjectsDocs() {
  return (
    <div>
      <h1>Projects &amp; API keys</h1>
      <p className="lead">
        A Spanlens organization contains one or more <strong>projects</strong>. Each project owns
        its own <strong>API keys</strong>, which are what you paste into your <code>.env</code> as{' '}
        <code>SPANLENS_API_KEY</code>. Projects let you separate dev/staging/prod, or per-service,
        or per-team — whatever scoping makes sense.
      </p>

      <h2>Why projects</h2>
      <p>
        Without projects, every request from every service you own shows up in one giant stream.
        That&apos;s fine for a solo side project; painful for anything beyond. Projects let you:
      </p>
      <ul>
        <li>Filter <a href="/requests">/requests</a> by source service</li>
        <li>Compute cost per team for chargeback</li>
        <li>Apply different alert rules to prod vs staging</li>
        <li>Revoke one service&apos;s keys without affecting others</li>
      </ul>

      <h2>Why API keys (not JWT)</h2>
      <p>
        Traffic hitting <code>/proxy/*</code> uses API keys (not Supabase JWT) because those
        requests come from your backend servers — no user session, no cookie. API keys are:
      </p>
      <ul>
        <li>Long-lived (no expiry by default)</li>
        <li>Revocable (one button in the dashboard)</li>
        <li>Scoped to one project</li>
        <li>Hashed server-side (we never store the plaintext)</li>
      </ul>

      <h2>How it works</h2>

      <h3>Key format</h3>
      <p>
        Keys are <code>sl_live_</code> + 40 random base62 chars. At creation time the plaintext is
        shown once in the dashboard — copy it immediately. On the server we compute{' '}
        <strong>SHA-256</strong> over the key and store only the hash in <code>api_keys.key_hash</code>.
      </p>
      <p>
        Incoming proxy requests present <code>Authorization: Bearer sl_live_...</code>. The{' '}
        <code>authApiKey</code> middleware hashes the presented key and looks it up. No plaintext
        comparison, no plaintext storage.
      </p>

      <h3>Per-key metadata tracked</h3>
      <ul>
        <li><code>name</code> — human label (e.g. &ldquo;prod-backend&rdquo;)</li>
        <li><code>key_prefix</code> — first 10 chars, shown in UI for identification</li>
        <li><code>last_used_at</code> — updated on every successful auth</li>
        <li><code>is_active</code> — revoke flag; inactive keys return 401</li>
      </ul>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>Go to <a href="/projects">/projects</a>. From there you can:</p>
      <ol>
        <li>Create a new project</li>
        <li>Click <strong>&ldquo;+ New Spanlens key&rdquo;</strong> — select provider, enter your real AI key, give it a name</li>
        <li>Copy the <code>sl_live_...</code> key (shown once — won&apos;t be displayed again)</li>
        <li>Toggle a key active / inactive with the switch — inactive keys return 401 immediately</li>
        <li>Update the underlying AI key (pencil icon) without changing <code>sl_live_...</code></li>
        <li>Delete a key entirely (trash icon) — removes both the Spanlens key and the stored AI key</li>
      </ol>
      <p>
        The page also shows a wizard hint: <code>npx @spanlens/cli init</code> will prompt for
        the key and wire up <code>.env.local</code> + SDK imports automatically.
      </p>

      <h3>API</h3>
      <CodeBlock language="bash">{`# Projects
GET    /api/v1/projects
POST   /api/v1/projects              { "name": "backend-prod" }
DELETE /api/v1/projects/:id

# API keys — issue (creates Spanlens key + stores encrypted AI key in one step)
POST   /api/v1/api-keys/issue        { "provider": "openai", "key": "sk-...", "name": "prod", "projectId": "<uuid>" }
# → { "key": "sl_live_...", "provider": "openai", ... } — shown ONCE

GET    /api/v1/api-keys?projectId=<uuid>   # list (never returns plaintext AI keys)

PATCH  /api/v1/api-keys/:id          { "is_active": false }          # toggle active/inactive
PATCH  /api/v1/api-keys/:id/rotate-ai-key  { "key": "sk-new-..." }   # replace AI key only
DELETE /api/v1/api-keys/:id          # hard delete — removes Spanlens key + linked AI key`}</CodeBlock>

      <h3>Tagging requests with a project from client code</h3>
      <p>
        By default, a request&apos;s project is determined by <strong>which API key</strong> was
        used. One key = one project. If you want to override per-request, pass:
      </p>
      <CodeBlock language="bash">{`X-Spanlens-Project: my-project-slug`}</CodeBlock>
      <p>
        ...in the proxy request headers. The SDK also accepts a <code>project</code> option on{' '}
        <code>createOpenAI()</code> / <code>createAnthropic()</code> / <code>createGemini()</code>.
      </p>

      <h2>Security design</h2>
      <ul>
        <li>
          <strong>No recovery.</strong> Lose a plaintext key, create a new one. We can&apos;t
          retrieve it from the hash — that&apos;s the point.
        </li>
        <li>
          <strong>Revocation is instantaneous.</strong> Flipping <code>is_active</code> to false
          blocks all subsequent traffic. No key cache to invalidate.
        </li>
        <li>
          <strong>Rate limits and quotas are enforced per-org, not per-key.</strong> A leaked key
          can be revoked without breaking your other keys, but while active it shares the org&apos;s
          quota. Rotate regularly for defense-in-depth.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No per-key rate limits yet.</strong> Enterprise ask — on roadmap.
        </li>
        <li>
          <strong>No automatic rotation.</strong> AI key rotation is manual (pencil icon or{' '}
          <code>PATCH /rotate-ai-key</code>). Scheduled / automated rotation is deferred to Phase 5.
        </li>
        <li>
          <strong>No IP allowlisting.</strong> Keys work from anywhere that presents them.
          Network-level allowlisting is an Enterprise request we&apos;re tracking.
        </li>
        <li>
          <strong>Spanlens key plaintext shown once.</strong> No &ldquo;reveal existing key&rdquo;
          escape hatch — by design. If you need CI to have access, delete the key, create a new
          one, and update the secret in your CI settings.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/settings">Keys &amp; encryption (AES-256-GCM)</a>,{' '}
        <a href="/docs/quick-start">Quick start</a>,{' '}
        <a href="/projects">/projects</a> dashboard.
      </p>
    </div>
  )
}
