import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Keys & encryption · Spanlens Docs',
  description:
    'How Spanlens stores and protects your AI provider keys. AES-256-GCM encryption at rest, decrypted only in memory during proxy forwarding.',
}

export default function SettingsDocs() {
  return (
    <div>
      <h1>Keys &amp; encryption</h1>
      <p className="lead">
        Spanlens uses two kinds of keys. Your <strong>Spanlens key</strong> (
        <code>sl_live_…</code>) goes in your app&apos;s env. Your <strong>provider keys</strong>{' '}
        (the real OpenAI / Anthropic / Gemini keys) are registered separately on the dashboard
        and stored encrypted with <strong>AES-256-GCM</strong>. The proxy decrypts a provider
        key in memory for the duration of a single <code>fetch()</code>, then drops it. The real
        key is never logged, never returned by any API, never displayed again after registration.
      </p>

      <h2>Why this layer exists</h2>
      <p>
        Your client code authenticates to Spanlens with the <strong>Spanlens key</strong> only.
        The actual provider key that OpenAI / Anthropic / Gemini expect is swapped in
        server-side from our encrypted vault, scoped to the Spanlens key the client presented.
      </p>
      <p>This buys you two things:</p>
      <ol>
        <li>
          <strong>Your real keys never ship to the client.</strong> Frontend code, mobile apps,
          anywhere — none of them need the sensitive provider key. They only need your
          revocable Spanlens key.
        </li>
        <li>
          <strong>Centralized rotation.</strong> Replace the underlying provider key with the
          pencil icon on its card in <a href="/projects">/projects</a> — all your services pick
          it up next request. Your <code>sl_live_…</code> stays the same. No redeploys.
        </li>
      </ol>

      <h2>The two-key model</h2>
      <p>
        Each <strong>Spanlens key</strong> owns its own pool of provider keys. So two
        Spanlens keys in the same project can carry different OpenAI / Anthropic / Gemini
        credentials — useful for dev/prod splits or per-team accounting where the same
        provider key shouldn&apos;t be shared.
      </p>
      <ul>
        <li>
          A Spanlens key with <strong>no</strong> provider keys registered will accept calls but
          return <code>400 No active provider key registered for this Spanlens key</code> at
          the proxy layer.
        </li>
        <li>
          A Spanlens key with provider keys for OpenAI + Anthropic but <strong>not</strong>{' '}
          Gemini will route OpenAI and Anthropic calls correctly and reject Gemini calls
          with the same 400.
        </li>
        <li>
          Provider keys are uniquely active per <code>(spanlens_key, provider)</code> — only
          one OpenAI key per Spanlens key can be active at a time. Add a second OpenAI key
          when you want to rotate, then deactivate the old one.
        </li>
      </ul>

      <h2>How the encryption works</h2>

      <h3>Storage flow</h3>
      <ol>
        <li>
          You add a provider key to a Spanlens key in <a href="/projects">/projects</a> — click{' '}
          <em>+ Add provider key</em> next to the Spanlens key, pick the provider, paste your
          real <code>sk-…</code> / <code>sk-ant-…</code> / <code>AIza…</code> key
        </li>
        <li>
          Server reads <code>ENCRYPTION_KEY</code> from env (32 bytes, base64-encoded)
        </li>
        <li>
          Generates a fresh 12-byte <strong>IV</strong> (nonce) per key
        </li>
        <li>
          AES-256-GCM encrypts the plaintext under the master key with that IV
        </li>
        <li>
          Stores <code>iv || ciphertext || auth_tag</code> (concatenated) in the{' '}
          <code>provider_keys</code> table as base64, with a <code>api_key_id</code> FK
          pointing at the parent Spanlens key
        </li>
        <li>Plaintext is discarded from memory</li>
      </ol>

      <h3>Decryption flow (on every proxy request)</h3>
      <ol>
        <li>
          Your request arrives at <code>/proxy/&#123;openai|anthropic|gemini&#125;/…</code>{' '}
          carrying the Spanlens key in whichever transport the SDK uses (see{' '}
          <a href="/docs/proxy">Direct proxy</a> for the per-SDK mapping)
        </li>
        <li>
          Server hashes the Spanlens key with SHA-256 and looks it up in <code>api_keys</code>{' '}
          → resolves <code>apiKeyId</code>
        </li>
        <li>
          Provider is inferred from the URL path: <code>/proxy/openai/…</code> → OpenAI, etc.
        </li>
        <li>
          Loads the active <code>provider_keys</code> row for{' '}
          <code>(apiKeyId, provider) WHERE is_active = true</code>
        </li>
        <li>
          Decrypts with{' '}
          <code>aes256Decrypt(ENCRYPTION_KEY, iv, ciphertext, authTag)</code>
        </li>
        <li>
          Sets the upstream auth header (<code>Authorization: Bearer</code> for OpenAI,{' '}
          <code>x-api-key</code> for Anthropic, <code>?key=</code> for Gemini) on the
          forwarded request
        </li>
        <li>
          Plaintext lives in a local <code>const</code> for the duration of the{' '}
          <code>fetch()</code> call, then goes out of scope
        </li>
      </ol>

      <h3>Why AES-256-GCM, not just AES-256-CBC</h3>
      <ul>
        <li>
          <strong>Authenticated.</strong> GCM produces a 16-byte tag that verifies the
          ciphertext wasn&apos;t tampered with. CBC has no built-in integrity check.
        </li>
        <li>
          <strong>Nonce-misuse awareness.</strong> One fresh IV per key ensures no two
          ciphertexts share a keystream. (Reusing an IV with GCM is catastrophic — we
          don&apos;t.)
        </li>
        <li>
          <strong>Industry-standard for &ldquo;encrypt at rest&rdquo;.</strong> NIST, OWASP, and
          every major provider converge on this.
        </li>
      </ul>

      <h3>Where ENCRYPTION_KEY lives</h3>
      <ul>
        <li>
          <strong>Cloud (spanlens.io)</strong>: in Vercel environment variables, generated at
          org setup, never displayed, never logged, never shipped to the web bundle
        </li>
        <li>
          <strong>Self-host</strong>: you generate it yourself (
          <code>openssl rand -base64 32</code>) and set it on the container.{' '}
          <strong>Back it up.</strong> Losing the encryption key makes every stored provider
          key unrecoverable — you&apos;d need to re-register them all.
        </li>
      </ul>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        Open <a href="/projects">/projects</a>. The flow is two steps — issue a Spanlens key,
        then attach provider keys to it.
      </p>
      <ol>
        <li>
          On the project card click <strong>+ New Spanlens key</strong> → enter a name (e.g.{' '}
          &ldquo;prod-backend&rdquo;) → the dialog returns the <code>sl_live_…</code> value
          once. <strong>Copy it immediately.</strong>
        </li>
        <li>
          The new Spanlens key now appears as a section. Click <strong>+ Add provider key</strong>{' '}
          on that section to attach an OpenAI / Anthropic / Gemini key. Repeat per provider.
        </li>
        <li>
          After saving, the dialog flips to a success view showing the exact integration
          snippet for that provider — <code>createOpenAI()</code> /{' '}
          <code>createAnthropic()</code> / <code>createGemini()</code>. Copy it into your
          codebase. No CLI re-run needed; the same <code>SPANLENS_API_KEY</code> already covers
          the new provider.
        </li>
      </ol>

      <h3>Rotating a provider key</h3>
      <p>
        Each provider key row has a pencil icon. Click it, paste the new{' '}
        <code>sk-…</code> / <code>sk-ant-…</code> / <code>AIza…</code> value, save. Your{' '}
        <code>sl_live_…</code> Spanlens key and all deployed code stay unchanged — Spanlens
        silently swaps the underlying credential on the next request.
      </p>

      <h3>Deactivating a provider key</h3>
      <p>
        The trash icon next to a provider key flips <code>is_active = false</code>. Subsequent
        requests for that provider on that Spanlens key return{' '}
        <code>400 No active provider key</code> until you add a new one. Existing
        request logs are preserved.
      </p>

      <h3>Deleting a Spanlens key</h3>
      <p>
        The trash icon next to a Spanlens key hard-deletes it. Provider keys under it are
        removed by <code>ON DELETE CASCADE</code>. Apps using that key start failing with 401
        immediately.
      </p>

      <h3>API</h3>
      <CodeBlock language="bash">{`# ── Spanlens keys (provider-agnostic, project-scoped) ──────────
GET    /api/v1/api-keys?projectId=<uuid>
POST   /api/v1/api-keys/issue           { "name": "prod-backend", "projectId": "<uuid>" }
# → { "id": ..., "key": "sl_live_..." }   ← shown ONCE
PATCH  /api/v1/api-keys/:id             { "is_active": false }    # toggle
DELETE /api/v1/api-keys/:id             # hard delete (CASCADE removes provider_keys)

# ── Provider keys (under a specific Spanlens key) ──────────────
GET    /api/v1/provider-keys?apiKeyId=<spanlens-key-uuid>
POST   /api/v1/provider-keys            { "api_key_id": "<uuid>", "provider": "openai",
                                          "key": "sk-...", "name": "prod-openai" }
PATCH  /api/v1/provider-keys/:id        { "key": "sk-rotated..." }   # rotate
PATCH  /api/v1/provider-keys/:id        { "name": "renamed" }        # rename
DELETE /api/v1/provider-keys/:id        # soft delete (sets is_active=false)`}</CodeBlock>

      <h2>Security guarantees</h2>
      <ul>
        <li>
          <strong>Not in logs.</strong> Provider keys are never{' '}
          <code>console.log()</code>&apos;d, never stored in the <code>requests</code> table,
          never returned from any API.
        </li>
        <li>
          <strong>Not in the web bundle.</strong> The dashboard talks to the API server; it
          never receives provider key plaintext.
        </li>
        <li>
          <strong>Database compromise alone is insufficient.</strong> Without{' '}
          <code>ENCRYPTION_KEY</code>, the <code>provider_keys</code> ciphertext is useless.
          <code>ENCRYPTION_KEY</code> lives outside the DB (env var).
        </li>
        <li>
          <strong>Audit trail.</strong> Every decrypt-and-forward operation is logged (rate,
          timestamp, org, which Spanlens key) without the plaintext for forensics.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No envelope encryption with per-org DEK yet.</strong> All orgs share the
          same master <code>ENCRYPTION_KEY</code>. Per-org data encryption keys (envelope
          encryption) + KMS integration is on the Enterprise roadmap.
        </li>
        <li>
          <strong>No HSM support.</strong> Keys live in process memory during decryption.
          HSM offload is an Enterprise path (Phase 5+).
        </li>
        <li>
          <strong>No automatic rotation.</strong> Provider key rotation is manual (pencil
          icon or the <code>PATCH /api/v1/provider-keys/:id</code> endpoint). Scheduled
          rotation is deferred.
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/projects">Projects &amp; API keys</a>,{' '}
        <a href="/docs/self-host">Self-hosting</a> (ENCRYPTION_KEY setup),{' '}
        <a href="/projects">/projects</a> dashboard. Source:{' '}
        <code>apps/server/src/lib/crypto.ts</code>,{' '}
        <code>apps/server/src/api/providerKeys.ts</code>.
      </p>
    </div>
  )
}
