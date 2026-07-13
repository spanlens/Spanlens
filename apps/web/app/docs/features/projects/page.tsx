import { CodeBlock } from '../../_components/code-block'
import { ProjectsHierarchyDiagram } from '../../_components/diagrams'
import { DocsJsonLd } from '@/app/docs/_components/docs-jsonld'

export const metadata = {
  alternates: { canonical: '/docs/features/projects' },
  title: 'Projects, Spanlens keys & provider keys · Spanlens Docs',
  description:
    'Scope your traffic into projects (dev / staging / prod, per-service). Each Spanlens key (sl_live_…) carries its own pool of encrypted provider keys.',
}

export default function ProjectsDocs() {
  return (
    <div>
      <DocsJsonLd meta={metadata} />
      <h1>Projects, Spanlens keys &amp; provider keys</h1>
      <p className="lead">
        A Spanlens organization contains one or more <strong>projects</strong>. Each project
        owns one or more <strong>Spanlens keys</strong> (<code>sl_live_…</code>), the value
        you put in your app&apos;s <code>SPANLENS_API_KEY</code> env. Each Spanlens key in
        turn owns its own pool of <strong>provider keys</strong> (the real OpenAI / Anthropic
        / Gemini credentials), so two Spanlens keys in the same project can carry different
        underlying credentials. Projects let you separate dev/staging/prod, per-service, or
        per-team, whatever scoping makes sense.
      </p>

      <h2>Why projects</h2>
      <p>
        Without projects, every request from every service you own shows up in one giant
        stream. That&apos;s fine for a solo side project; painful for anything beyond.
        Projects let you:
      </p>
      <ul>
        <li>Filter <a href="/requests">/requests</a> by source service</li>
        <li>Compute cost per team for chargeback</li>
        <li>Apply different alert rules to prod vs staging</li>
        <li>Revoke one service&apos;s keys without affecting others</li>
      </ul>

      <h2>Why two key types</h2>
      <p>
        Spanlens keys are what your <em>app</em> ships with. Provider keys are what the{' '}
        <em>LLM provider</em> bills against. Splitting them gives you:
      </p>
      <ul>
        <li>
          <strong>Real provider keys never ship to clients.</strong> Frontend bundles, mobile
          apps, anywhere, they only ever see the revocable <code>sl_live_…</code>.
        </li>
        <li>
          <strong>Centralized rotation.</strong> Replace the OpenAI key on the dashboard
          (pencil icon on the provider key row) → next request flows through the new key. No
          redeploys, no env changes.
        </li>
        <li>
          <strong>Per-environment isolation without cross-env leakage.</strong> Issue two
          Spanlens keys (<code>prod</code>, <code>staging</code>), give each its own
          OpenAI/Anthropic/Gemini credentials, and a leaked staging key can never touch prod
          billing.
        </li>
      </ul>

      <h2>How keys work</h2>

      <ProjectsHierarchyDiagram />

      <h3>Spanlens key format</h3>
      <p>
        Keys are <code>sl_live_</code> + 48 random hex chars. At creation time the plaintext
        is shown once in the dashboard, copy it immediately. On the server we compute{' '}
        <strong>SHA-256</strong> over the key and store only the hash in{' '}
        <code>api_keys.key_hash</code>.
      </p>
      <p>
        Incoming proxy requests present the key in whichever transport the upstream SDK uses
        (see <a href="/docs/proxy">Direct proxy</a> for the full table). The{' '}
        <code>authApiKey</code> middleware extracts the key, hashes it, and looks it up. No
        plaintext comparison, no plaintext storage.
      </p>

      <h3>Provider key encryption</h3>
      <p>
        Provider keys (the real <code>sk-…</code> / <code>sk-ant-…</code> / <code>AIza…</code>{' '}
        values) are stored encrypted with <strong>AES-256-GCM</strong>. See{' '}
        <a href="/docs/features/settings">Keys &amp; encryption</a> for the cryptographic
        details, fresh IV per key, authenticated, decrypted only in memory for the duration
        of one upstream <code>fetch()</code>.
      </p>

      <h3>Per-key metadata tracked</h3>
      <ul>
        <li><code>name</code>, human label (e.g. &ldquo;prod-backend&rdquo;)</li>
        <li><code>key_prefix</code>, first 15 chars (Spanlens key only), shown in UI for ID</li>
        <li>
          <code>last_used_at</code>, updated on every successful auth (throttled to one
          write per key per 5 minutes so the proxy hot path stays cheap)
        </li>
        <li><code>is_active</code>, revoke flag; inactive keys return 401</li>
      </ul>

      <h3>Stale key surfacing</h3>
      <p>
        The dashboard classifies each active key by how long it has been idle and surfaces
        forgotten keys before they leak:
      </p>
      <ul>
        <li>
          <strong>30–89 days idle</strong> → neutral &ldquo;Stale&rdquo; badge on the key row
          in <a href="/projects">/projects</a>.
        </li>
        <li>
          <strong>90+ days idle</strong> → accent &ldquo;Consider revoking&rdquo; badge,
          surfaced in two extra places so it&apos;s hard to miss:
          <ul>
            <li>
              The sidebar <strong>Projects &amp; Keys</strong> entry carries a red count
              of stale + revoke-tier keys.
            </li>
            <li>
              The dashboard <strong>Needs Attention</strong> strip shows a warning card
              with a sample key name and a deep link to <a href="/projects">/projects</a>.
            </li>
          </ul>
        </li>
      </ul>
      <p>
        Keys that have never authenticated fall back to <code>created_at</code> as the
        idleness floor — a brand-new key isn&apos;t flagged for the first 30 days. Revoked
        keys (<code>is_active=false</code>) are excluded from staleness reporting entirely:
        once you&apos;ve already disabled a key, nagging about it is noise.
      </p>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>Go to <a href="/projects">/projects</a>. The flow is two steps:</p>
      <ol>
        <li>
          <strong>Issue a Spanlens key.</strong> On the project card click{' '}
          <em>+ New Spanlens key</em> → enter a name → the dialog returns the{' '}
          <code>sl_live_…</code> value <strong>once</strong>. Copy it immediately and put it
          in your app&apos;s <code>SPANLENS_API_KEY</code> env.
        </li>
        <li>
          <strong>Attach provider keys.</strong> The new Spanlens key now appears as a
          section. Click <em>+ Add provider key</em> on it → pick OpenAI / Anthropic / Gemini
          → paste your real provider credential. Repeat per provider you need.
        </li>
        <li>
          After you save a provider key the dialog flips to a success view showing the
          one-line integration snippet for that provider (<code>createOpenAI()</code>,{' '}
          <code>createAnthropic()</code>, <code>createGemini()</code>). Drop it into your
          code, no CLI re-run needed.
        </li>
      </ol>

      <p>
        Existing keys can be:
      </p>
      <ul>
        <li>
          <strong>Toggled active/inactive</strong> via the switch on the Spanlens key row.
          Inactive keys return 401 immediately, no cache to invalidate.
        </li>
        <li>
          <strong>Provider keys rotated</strong> via the pencil icon on each provider key
          row. The <code>sl_live_…</code> stays the same; only the underlying credential
          changes.
        </li>
        <li>
          <strong>Deleted with a 72-hour grace period.</strong> The trash icon on a
          Spanlens key or a provider key flips <code>is_active = false</code> right away
          so the proxy stops accepting it, then queues a hard delete that runs every six
          hours. While the row is in the queue you can restore it from{' '}
          <a href="/settings">Settings</a> → <strong>Pending deletions</strong>. After the
          grace window the hard delete runs and the row is gone for good.
        </li>
      </ul>

      <h3>Restoring an accidental deletion</h3>
      <p>
        Misclicked the trash icon? Open <a href="/settings">Settings</a> →{' '}
        <strong>Pending deletions</strong>. Every soft-deleted key, provider key, and
        prompt version shows up there with a timer; click <em>Restore</em> to reactivate
        the row. After the timer expires the row is hard-deleted and restore is no longer
        possible — you&apos;d have to issue a fresh key (the SHA-256 hash is irreversible).
      </p>
      <p>
        Audit events are recorded both for the original delete request
        (<code>api_key.delete</code> / <code>provider_key.delete</code>) and for the
        restore (<code>pending_deletion.restore</code>), so the trail stays intact even
        when the action is reversed.
      </p>

      <p>
        The page also surfaces a wizard hint: <code>npx @spanlens/cli init</code> can
        bootstrap an existing OpenAI/Anthropic/Gemini codebase by rewriting{' '}
        <code>new OpenAI(...)</code> → <code>createOpenAI()</code> in one pass. For{' '}
        <em>new</em> code, you don&apos;t need the CLI, copy the snippet from the dashboard
        and you&apos;re done.
      </p>

      <h3>API</h3>
      <CodeBlock language="bash">{`# ── Projects ──────────────────────────────────────────────────
GET    /api/v1/projects
POST   /api/v1/projects                      { "name": "backend-prod" }
DELETE /api/v1/projects/:id

# ── Spanlens keys (provider-agnostic, project-scoped) ─────────
GET    /api/v1/api-keys?projectId=<uuid>
POST   /api/v1/api-keys/issue                { "name": "prod-backend",
                                               "projectId": "<uuid>" }
# → { "id": "...", "key": "sl_live_..." }   ← shown ONCE
PATCH  /api/v1/api-keys/:id                  { "is_active": false }    # toggle
DELETE /api/v1/api-keys/:id                  # is_active=false + 72h delete queue

# ── Provider keys (under a specific Spanlens key) ─────────────
GET    /api/v1/provider-keys?apiKeyId=<spanlens-key-uuid>
POST   /api/v1/provider-keys                 { "api_key_id": "<uuid>",
                                               "provider": "openai",
                                               "key": "sk-...",
                                               "name": "prod-openai" }
PATCH  /api/v1/provider-keys/:id             { "key": "sk-rotated..." }   # rotate
PATCH  /api/v1/provider-keys/:id             { "name": "renamed" }        # rename
DELETE /api/v1/provider-keys/:id             # is_active=false + 72h delete queue

# ── Pending deletions queue (restore within 72h) ──────────────
GET    /api/v1/pending-deletions             # active queue
GET    /api/v1/pending-deletions/history     # terminal rows (executed or cancelled)
POST   /api/v1/pending-deletions/:id/restore # cancel + flip is_active back to true`}</CodeBlock>

      <h3>How requests get their project</h3>
      <p>
        A request&apos;s project is determined by <strong>which Spanlens key</strong> was used.
        One key = one project. To send traffic to a different project, issue a key under that
        project and use it for those calls. There is no per-request project override header.
      </p>

      <h2>Security design</h2>
      <ul>
        <li>
          <strong>No recovery.</strong> Lose a plaintext Spanlens key → create a new one. We
          can&apos;t retrieve it from the SHA-256 hash. Same for the underlying provider key
          plaintext after registration.
        </li>
        <li>
          <strong>Revocation is instantaneous.</strong> Flipping <code>is_active</code> to
          false blocks all subsequent traffic. No key cache to invalidate.
        </li>
        <li>
          <strong>Rate limits and quotas are enforced per-org.</strong> A leaked Spanlens key
          can be revoked without breaking your other keys, but while active it shares the
          org&apos;s quota. Rotate regularly for defense-in-depth.
        </li>
        <li>
          <strong>Provider keys are scoped to one Spanlens key.</strong> A stolen Spanlens
          key only unlocks the provider keys you registered under it, not the org&apos;s
          other Spanlens keys&apos; provider keys. (UNIQUE INDEX <code>(api_key_id,
          provider) WHERE is_active = true</code> enforces 1 active per Spanlens key per
          provider.)
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No per-key rate limits yet.</strong> Enterprise ask, on roadmap.
        </li>
        <li>
          <strong>No automatic rotation.</strong> Provider key rotation is manual (pencil
          icon or <code>PATCH /api/v1/provider-keys/:id</code>). Scheduled rotation is
          deferred to Phase 5.
        </li>
        <li>
          <strong>No IP allowlisting.</strong> Keys work from anywhere that presents them.
          Network-level allowlisting is an Enterprise request we&apos;re tracking.
        </li>
        <li>
          <strong>Spanlens key plaintext shown once.</strong> No &ldquo;reveal existing
          key&rdquo; escape hatch, by design. If CI lost the value, delete the key, create
          a new one, and update the secret in your CI settings.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/settings">Keys &amp; encryption (AES-256-GCM)</a>,{' '}
        <a href="/docs/quick-start">Quick start</a>,{' '}
        <a href="/docs/proxy">Direct proxy &amp; auth transports</a>,{' '}
        <a href="/projects">/projects</a> dashboard.
      </p>
    </div>
  )
}
