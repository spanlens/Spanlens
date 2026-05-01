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
        When you create a Spanlens key in <a href="/projects">/projects</a>, you enter your real
        OpenAI / Anthropic / Gemini key. Spanlens stores it encrypted with{' '}
        <strong>AES-256-GCM</strong> and only decrypts it in memory, for a fraction of a second,
        when forwarding your request to the upstream provider. The real key is never logged, never
        exposed through an API, never displayed again after creation.
      </p>

      <h2>Why this layer exists</h2>
      <p>
        Your client code sends requests to Spanlens using a <strong>Spanlens API key</strong>{' '}
        (<code>sl_live_...</code>). The actual provider key that OpenAI / Anthropic / Gemini
        expect is swapped in server-side from our encrypted vault.
      </p>
      <p>This buys you two things:</p>
      <ol>
        <li>
          <strong>Your real keys never ship to the client.</strong> Frontend code, mobile apps,
          anywhere — none of them need the sensitive key. They only need your revocable Spanlens
          key.
        </li>
        <li>
          <strong>Centralized rotation.</strong> Replace the underlying AI key in one place (the
          edit button in <a href="/projects">/projects</a>), all your services pick it up next
          request. Your <code>sl_live_...</code> key stays the same — no redeploys.
        </li>
      </ol>

      <h2>How the encryption works</h2>

      <h3>Storage flow</h3>
      <ol>
        <li>You enter your AI provider key when creating a Spanlens key in <a href="/projects">/projects</a></li>
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
          <code>provider_keys</code> table as base64
        </li>
        <li>Plaintext is discarded from memory</li>
      </ol>

      <h3>Decryption flow (on every proxy request)</h3>
      <ol>
        <li>Your request arrives at <code>/proxy/openai/v1/...</code> with Spanlens API key</li>
        <li>Server authenticates the Spanlens API key → resolves the linked provider key ID</li>
        <li>Loads the encrypted provider key from the vault</li>
        <li>
          Decrypts with <code>aes256Decrypt(ENCRYPTION_KEY, iv, ciphertext, authTag)</code>
        </li>
        <li>
          Sets <code>Authorization: Bearer &lt;plaintext&gt;</code> on the forwarded request
        </li>
        <li>
          Plaintext lives in a local <code>const</code> for the duration of the <code>fetch()</code>
          call, then goes out of scope
        </li>
      </ol>

      <h3>Why AES-256-GCM, not just AES-256-CBC</h3>
      <ul>
        <li>
          <strong>Authenticated.</strong> GCM produces a 16-byte tag that verifies the ciphertext
          wasn&apos;t tampered with. CBC has no built-in integrity check.
        </li>
        <li>
          <strong>Nonce-misuse awareness.</strong> One fresh IV per key ensures no two ciphertexts
          share a keystream. (Reusing an IV with GCM is catastrophic — we don&apos;t.)
        </li>
        <li>
          <strong>Industry-standard for &ldquo;encrypt at rest&rdquo;.</strong> NIST, OWASP, and
          every major provider converge on this.
        </li>
      </ul>

      <h3>Where ENCRYPTION_KEY lives</h3>
      <ul>
        <li>
          <strong>Cloud (spanlens.io)</strong>: in Vercel environment variables, generated at org
          setup, never displayed, never logged, never shipped to the web bundle
        </li>
        <li>
          <strong>Self-host</strong>: you generate it yourself (<code>openssl rand -base64 32</code>)
          and set it on the container. <strong>Back it up.</strong> Losing the encryption key
          makes every stored provider key unrecoverable — you&apos;d need to re-register them all.
        </li>
      </ul>

      <h2>Using it</h2>

      <h3>Dashboard</h3>
      <p>
        Go to <a href="/projects">/projects</a>. Under any project, click{' '}
        <strong>&ldquo;+ New Spanlens key&rdquo;</strong>:
      </p>
      <ol>
        <li>Select a provider (OpenAI / Anthropic / Gemini)</li>
        <li>Paste your actual <code>sk-...</code> / <code>sk-ant-...</code> / <code>AIza...</code> key</li>
        <li>Give the key a name and click &ldquo;Create key&rdquo;</li>
      </ol>
      <p>
        The UI shows your new <code>sl_live_...</code> key once — copy it immediately. The underlying
        AI key is never shown again. The key row in the list shows the provider badge, active
        toggle, and an edit button to update the AI key without changing your <code>sl_live_...</code>.
      </p>

      <h3>Rotating the AI key</h3>
      <p>
        Click the pencil icon next to any key, enter the new AI provider key, and save. Your{' '}
        <code>sl_live_...</code> key and all deployed code stay unchanged — Spanlens silently swaps
        the underlying key on the next request.
      </p>

      <h3>API</h3>
      <CodeBlock language="bash">{`# Create Spanlens key + store encrypted AI key in one step
POST /api/v1/api-keys/issue
{ "provider": "openai", "key": "sk-...", "name": "prod-backend", "projectId": "<uuid>" }
# → { "key": "sl_live_...", "provider": "openai", ... } — shown ONCE

# List (never returns plaintext AI keys)
GET /api/v1/api-keys?projectId=<uuid>

# Toggle active / inactive
PATCH /api/v1/api-keys/:id
{ "is_active": false }

# Replace the underlying AI key (sl_live_... stays the same)
PATCH /api/v1/api-keys/:id/rotate-ai-key
{ "key": "sk-new-..." }

# Hard delete (removes both Spanlens key and stored AI key)
DELETE /api/v1/api-keys/:id`}</CodeBlock>

      <h2>Security guarantees</h2>
      <ul>
        <li>
          <strong>Not in logs.</strong> Provider keys are never <code>console.log()</code>&apos;d,
          never stored in the <code>requests</code> table, never exposed via an API.
        </li>
        <li>
          <strong>Not in the web bundle.</strong> The dashboard talks to the API server; it never
          receives provider keys.
        </li>
        <li>
          <strong>Database compromise alone is insufficient.</strong> Without{' '}
          <code>ENCRYPTION_KEY</code>, the <code>provider_keys</code> ciphertext is useless.
          <code>ENCRYPTION_KEY</code> lives outside the DB (env var).
        </li>
        <li>
          <strong>Audit trail.</strong> Every decrypt-and-forward operation is logged (rate,
          timestamp, org) without the plaintext for forensics.
        </li>
      </ul>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>No envelope encryption with per-org DEK yet.</strong> All orgs share the same
          master <code>ENCRYPTION_KEY</code>. Per-org data encryption keys (envelope encryption) +
          KMS integration is on the Enterprise roadmap.
        </li>
        <li>
          <strong>No HSM support.</strong> Keys live in process memory during decryption. HSM
          offload is an Enterprise path (Phase 5+).
        </li>
      </ul>

      <hr />
      <p className="text-sm text-muted-foreground">
        Related: <a href="/docs/features/projects">Projects &amp; API keys</a>,{' '}
        <a href="/docs/self-host">Self-hosting</a> (ENCRYPTION_KEY setup),{' '}
        <a href="/projects">/projects</a> dashboard. Source:{' '}
        <code>apps/server/src/lib/crypto.ts</code>.
      </p>
    </div>
  )
}
