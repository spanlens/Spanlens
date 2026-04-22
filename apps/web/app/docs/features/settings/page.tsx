import { CodeBlock } from '../../_components/code-block'

export const metadata = {
  title: 'Provider keys · Spanlens Docs',
  description:
    'Register your OpenAI / Anthropic / Gemini keys. Encrypted at rest with AES-256-GCM and only decrypted in memory when forwarding a request.',
}

export default function SettingsDocs() {
  return (
    <div>
      <h1>Provider keys</h1>
      <p className="lead">
        Your actual OpenAI / Anthropic / Gemini keys live in <a href="/settings">/settings</a>.
        We store them encrypted with <strong>AES-256-GCM</strong> and only decrypt them in memory,
        for a fraction of a second, when forwarding your request to the upstream provider. They
        are never logged, never exposed through an API, never displayed back to you after creation.
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
          <strong>Centralized rotation.</strong> Replace a provider key in one place, all your
          services pick it up next request.
        </li>
      </ol>

      <h2>How the encryption works</h2>

      <h3>Registration flow</h3>
      <ol>
        <li>You paste your provider key into <a href="/settings">/settings</a></li>
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
        <li>Server authenticates the Spanlens API key → resolves org</li>
        <li>Loads the org&apos;s encrypted provider key for this provider</li>
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
        Go to <a href="/settings">/settings</a>. For each provider you want to use:
      </p>
      <ol>
        <li>Click &ldquo;Add key&rdquo; under the provider</li>
        <li>Paste your actual <code>sk-...</code> / <code>sk-ant-...</code> / AIza... key</li>
        <li>Save</li>
      </ol>
      <p>
        The UI confirms the key is registered (you&apos;ll see masked prefix like <code>sk-...a1b2</code>)
        but never shows it in full again.
      </p>

      <h3>Rotation</h3>
      <p>
        To rotate: add the new key first (it becomes active immediately), then delete the old one.
        No downtime, no code change.
      </p>

      <h3>API</h3>
      <CodeBlock language="bash">{`# Register
POST /api/v1/provider-keys
{ "provider": "openai", "key": "sk-..." }

# List (returns masked prefixes only, never plaintext)
GET /api/v1/provider-keys

# Delete
DELETE /api/v1/provider-keys/:id`}</CodeBlock>

      <h2>Security guarantees</h2>
      <ul>
        <li>
          <strong>Not in logs.</strong> Provider keys are never <code>console.log()</code>&apos;d,
          never stored in the <code>requests</code> table, never exposed via an API. Static scan in
          CI enforces no string matching <code>sk-</code> in log output.
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

      <h2 id="overage">Overage billing controls (Pattern C)</h2>
      <p>
        Paid plans (Starter / Team) show an <strong>Overage billing</strong> card below{' '}
        <strong>Organization</strong> with two controls:
      </p>
      <ul>
        <li>
          <strong>Allow overage charges</strong> — when on (default), requests past your monthly
          quota keep flowing and are billed on your next invoice at the plan&apos;s overage rate.
          When off, requests past the quota return HTTP 429 immediately (Pattern A / legacy
          behavior).
        </li>
        <li>
          <strong>Max overage multiplier</strong> (1–100, default 5) — defines a hard cap. Even
          with overage enabled, requests past <em>limit × multiplier</em> are rejected. Protects
          against runaway usage spikes. Example: Starter 100K × 5 = 500K hard cap; past that,
          requests return 429 regardless of overage setting.
        </li>
      </ul>
      <p>
        Free plan hides these controls (quota is always a hard block). Enterprise is unlimited so
        the whole section is hidden.
      </p>
      <p>
        Each change takes effect on the next proxy request — no restart or cache-bust needed. The
        hourly quota-warning email picks up the current setting too: at 100% with overage enabled,
        the email tells you overage billing is active instead of reporting a block.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>
          <strong>One active key per (org, provider).</strong> If your OpenAI account has multiple
          keys for separate billing, Spanlens uses whichever is registered last. Multi-key routing
          is a future feature.
        </li>
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
        <a href="/settings">/settings</a> dashboard. Source:{' '}
        <code>apps/server/src/lib/crypto.ts</code>.
      </p>
    </div>
  )
}
