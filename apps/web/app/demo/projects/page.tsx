'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, Terminal, ExternalLink, Pencil, Trash2, Key as KeyIcon, Search, Check, Copy, Gauge } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type DemoProvKey = {
  id: string
  name: string
  provider: 'openai' | 'anthropic' | 'gemini' | 'azure'
  is_active: boolean
}

type DemoApiKey = {
  id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_used_days_ago: number | null
  provider_keys: DemoProvKey[]
}

type DemoProject = {
  id: string
  name: string
  api_keys: DemoApiKey[]
}

const DEMO_PROJECTS: DemoProject[] = [
  {
    id: 'prj_01HZX9N8K3F2T7V6Q5R4S3D2W1',
    name: 'Production',
    api_keys: [
      {
        id: 'apk_01HZX9N8K3F2T7V6Q5R4S3D2W1',
        name: 'web-frontend',
        key_prefix: 'sl_live_8a3f',
        is_active: true,
        last_used_days_ago: 0,
        provider_keys: [
          { id: 'pk-1', name: 'OpenAI prod', provider: 'openai', is_active: true },
          { id: 'pk-2', name: 'Anthropic prod', provider: 'anthropic', is_active: true },
        ],
      },
      {
        id: 'apk_01HZX9P2L4G3U8W7R6S5T4E3X2',
        name: 'support-bot',
        key_prefix: 'sl_live_b4d1',
        is_active: true,
        last_used_days_ago: 2,
        provider_keys: [
          { id: 'pk-3', name: 'OpenAI prod', provider: 'openai', is_active: true },
        ],
      },
    ],
  },
  {
    id: 'prj_01HZXA1Z9M5H4V8X7S6T5F4G3Y2',
    name: 'Staging',
    api_keys: [
      {
        id: 'apk_01HZXA1Z9M5H4V8X7S6T5F4G3Y3',
        name: 'staging-key',
        key_prefix: 'sl_live_c5e2',
        is_active: true,
        last_used_days_ago: 5,
        provider_keys: [
          { id: 'pk-4', name: 'OpenAI staging', provider: 'openai', is_active: true },
          { id: 'pk-5', name: 'Gemini staging', provider: 'gemini', is_active: false },
        ],
      },
    ],
  },
  {
    id: 'prj_01HZXB4N7P6J5W9Y8T7U6G5H4I3',
    name: 'Internal Tools',
    api_keys: [],
  },
]

// Workspace-scoped public keys (sl_live_pub_*). Read-only credentials safe for
// MCP servers, BI tools, and read embeds. Values are masked the same way the
// real product masks them (prefix … suffix), never the full secret.
type DemoPublicKey = {
  id: string
  name: string
  masked_value: string
  is_active: boolean
  last_used_label: string
}

const DEMO_PUBLIC_KEYS: DemoPublicKey[] = [
  {
    id: 'pub_01HZXC7Q2R8K3M5N6P7S8T9U0V',
    name: 'Cursor MCP',
    masked_value: 'sl_live_pub_9c2a…7f4e',
    is_active: true,
    last_used_label: 'last used today',
  },
  {
    id: 'pub_01HZXD1W4S9L4N6P7Q8T9U0V1X',
    name: 'Grafana embed',
    masked_value: 'sl_live_pub_3b8d…2a1c',
    is_active: true,
    last_used_label: 'last used 3d ago',
  },
]

// Static rate-limit config per Spanlens key, keyed by api key id. Mirrors the
// real RateLimitsDialog: one optional key-level cap plus per-end-user caps.
type DemoRateLimit = {
  id: string
  label: string
  is_active: boolean
}

type DemoRateLimitConfig = {
  keyLimit: DemoRateLimit | null
  endUserLimits: DemoRateLimit[]
}

const DEMO_RATE_LIMITS: Record<string, DemoRateLimitConfig> = {
  apk_01HZX9N8K3F2T7V6Q5R4S3D2W1: {
    keyLimit: { id: 'rl-1', label: '600 requests per minute', is_active: true },
    endUserLimits: [
      { id: 'rl-2', label: 'free-tier: 20 requests per minute', is_active: true },
      { id: 'rl-3', label: 'trial: 100 requests per day', is_active: false },
    ],
  },
  apk_01HZX9P2L4G3U8W7R6S5T4E3X2: {
    keyLimit: { id: 'rl-4', label: '120 requests per minute', is_active: true },
    endUserLimits: [],
  },
  apk_01HZXA1Z9M5H4V8X7S6T5F4G3Y3: {
    keyLimit: null,
    endUserLimits: [],
  },
}

function rateLimitConfigFor(apiKeyId: string): DemoRateLimitConfig {
  return DEMO_RATE_LIMITS[apiKeyId] ?? { keyLimit: null, endUserLimits: [] }
}

function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          },
          () => {},
        )
      }}
      aria-label="Copy project ID"
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-faint hover:text-text transition-opacity shrink-0"
    >
      {copied ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

/** Keep a project if its name, any key name/prefix, or any provider key name/provider matches. */
function projectMatches(p: DemoProject, q: string): boolean {
  if (p.name.toLowerCase().includes(q)) return true
  return p.api_keys.some(
    (k) =>
      k.name.toLowerCase().includes(q) ||
      k.key_prefix.toLowerCase().includes(q) ||
      k.provider_keys.some((pk) => pk.name.toLowerCase().includes(q) || pk.provider.includes(q)),
  )
}

/** Read-only limit row for the demo rate-limits dialog. */
function DemoLimitRow({ label, isActive }: { label: string; isActive: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[6px] border border-border bg-bg-elev px-3 py-2">
      <span className={cn('text-[12.5px]', isActive ? 'text-text' : 'text-text-faint line-through')}>
        {label}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-text-faint shrink-0">
        {isActive ? 'active' : 'disabled'}
      </span>
    </div>
  )
}

/**
 * Static, read-only mirror of the real per-key RateLimitsDialog. Opening it is
 * a safe read interaction, but every mutation control is disabled with the same
 * "Disabled in demo" affordance used elsewhere on this page.
 */
function DemoRateLimitsDialog({
  apiKey,
  open,
  onClose,
}: {
  apiKey: { id: string; name: string } | null
  open: boolean
  onClose: () => void
}) {
  const config = apiKey ? rateLimitConfigFor(apiKey.id) : { keyLimit: null, endUserLimits: [] }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rate limits</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-[12.5px] text-text-muted mt-1">
          Throttle traffic through <span className="font-mono">{apiKey?.name}</span>. A request over
          a configured limit gets a 429. Per-end-user limits bucket on the{' '}
          <code>x-spanlens-user</code> header.
        </DialogDescription>

        <div className="mt-3 space-y-6">
          {/* Key-level limit */}
          <section className="space-y-2">
            <h3 className="text-[12.5px] font-medium text-text">Key limit</h3>
            {config.keyLimit ? (
              <DemoLimitRow label={config.keyLimit.label} isActive={config.keyLimit.is_active} />
            ) : (
              <p className="text-[11.5px] text-text-faint">No key-level limit set.</p>
            )}
          </section>

          {/* Per-end-user limits */}
          <section className="space-y-2">
            <h3 className="text-[12.5px] font-medium text-text">Per end-user limits</h3>
            {config.endUserLimits.length === 0 ? (
              <p className="text-[11.5px] text-text-faint">
                None yet. Add a cap for a specific end-user identifier.
              </p>
            ) : (
              config.endUserLimits.map((l) => (
                <DemoLimitRow key={l.id} label={l.label} isActive={l.is_active} />
              ))
            )}
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-[11.5px] text-text-faint">Sign up to configure rate limits for your keys.</p>
            <button
              type="button"
              disabled
              title="Disabled in demo"
              className="text-[12px] px-3 py-[5px] h-[28px] rounded-[5px] bg-text text-bg font-medium opacity-60 cursor-not-allowed shrink-0"
            >
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function DemoProjectsPage() {
  const [query, setQuery] = useState('')
  // Rate-limits dialog target (Spanlens key). null = closed.
  const [rateLimitsKey, setRateLimitsKey] = useState<{ id: string; name: string } | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return DEMO_PROJECTS
    return DEMO_PROJECTS.filter((p) => projectMatches(p, q))
  }, [query])

  // Stat strip values (always over the full dataset, not the filtered view).
  const stats = useMemo(() => {
    let spanlensKeys = 0
    let activeKeys = 0
    let providerKeys = 0
    for (const p of DEMO_PROJECTS) {
      spanlensKeys += p.api_keys.length
      for (const k of p.api_keys) {
        if (k.is_active) activeKeys += 1
        providerKeys += k.provider_keys.length
      }
    }
    return { projects: DEMO_PROJECTS.length, spanlensKeys, activeKeys, providerKeys }
  }, [])

  const isFiltered = query.trim().length > 0

  // Flatten Spanlens keys for export (one row per key).
  const exportRows = useMemo(
    () =>
      filtered.flatMap((p) =>
        p.api_keys.map((k) => ({
          project: p.name,
          key_name: k.name,
          key_prefix: k.key_prefix,
          active: k.is_active,
          provider_keys: k.provider_keys.map((pk) => `${pk.provider}:${pk.name}`).join(' | '),
        })),
      ),
    [filtered],
  )

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Projects' }]}
          right={
            <div className="flex items-center gap-2">
              <DemoExportButton
                base="projects"
                rows={exportRows}
                columns={[
                  { header: 'Project', value: (r) => r.project },
                  { header: 'Spanlens key', value: (r) => r.key_name },
                  { header: 'Prefix', value: (r) => r.key_prefix },
                  { header: 'Active', value: (r) => r.active },
                  { header: 'Provider keys', value: (r) => r.provider_keys },
                ]}
              />
              <button
                type="button"
                disabled
                className="hidden sm:flex items-center gap-1.5 text-[12.5px] px-3 py-[5px] rounded-[5px] border border-border bg-bg-elev text-text-muted opacity-60 cursor-not-allowed"
                title="Disabled in demo"
              >
                <Plus className="h-3.5 w-3.5" /> New project
              </button>
            </div>
          }
        />
      </div>

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-4 min-w-[420px]">
          {[
            { label: 'Projects', value: String(stats.projects) },
            { label: 'Spanlens keys', value: String(stats.spanlensKeys) },
            { label: 'Active keys', value: String(stats.activeKeys) },
            { label: 'Provider keys', value: String(stats.providerKeys) },
          ].map((s, i) => (
            <div key={s.label} className={cn('px-[18px] py-[14px]', i < 3 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
                {s.label}
              </div>
              <div className="text-[20px] font-medium tracking-[-0.4px] text-text">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1">
        <div className="px-7 py-6 max-w-4xl">
          {/* Public Keys card — workspace-level credentials for MCP servers,
              BI tools, and read embeds. Sits above the project list so it reads
              as a distinct workspace-scope concept. */}
          <div className="rounded-xl border border-border bg-bg-elev px-5 py-4 mb-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h2 className="text-[14px] font-semibold text-text">Public keys</h2>
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.05em] px-1.5 py-0.5 rounded border border-border text-text-faint">
                    workspace
                  </span>
                </div>
                <p className="text-[12px] text-text-muted">
                  Read-only credentials safe for MCP servers, BI tools, and embeds. Cannot make LLM calls or ingest traces.
                </p>
              </div>
              <button
                type="button"
                disabled
                title="Disabled in demo"
                className="shrink-0 flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] rounded-[5px] bg-text text-bg font-medium opacity-60 cursor-not-allowed"
              >
                <Plus className="h-3.5 w-3.5" /> New public key
              </button>
            </div>

            <ul className="divide-y divide-border rounded-md border border-border bg-bg/40">
              {DEMO_PUBLIC_KEYS.map((key) => (
                <li key={key.id} className="flex items-center gap-3 px-3 py-2.5">
                  <KeyIcon className="h-3.5 w-3.5 text-text-faint shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        'text-[13px] font-medium truncate',
                        !key.is_active && 'line-through text-text-faint',
                      )}
                    >
                      {key.name}
                    </div>
                    <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                      {key.masked_value}
                      <span className="ml-2">· {key.last_used_label}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled
                    title="Disabled in demo"
                    aria-label="Revoke public key"
                    className="text-text-faint opacity-60 cursor-not-allowed p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-5">
            <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px] mb-1">Projects &amp; Keys</h1>
            <p className="text-[13px] text-text-muted">
              Each Spanlens key holds its own AI provider keys. Expand a key to see and add OpenAI / Anthropic / Gemini keys it can call.
            </p>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 mb-5">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder="Search projects, keys, providers…"
                className="w-full pl-8 pr-8 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
            {isFiltered && (
              <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">
                {filtered.length} of {stats.projects}
              </span>
            )}
          </div>

          {/* Integration hint */}
          <div className="rounded-lg border border-border bg-bg-elev px-4 py-3 mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-[13px] text-text-muted">
              <Terminal className="h-4 w-4 shrink-0 text-text-faint" />
              <span>
                Quick integrate:{' '}
                <code className="font-mono text-[12px] bg-bg border border-border px-1.5 py-0.5 rounded-[4px]">
                  npx @spanlens/cli init
                </code>
              </span>
            </div>
            <Link
              href="/docs/quick-start"
              className="text-[12.5px] text-accent hover:opacity-80 transition-opacity shrink-0 inline-flex items-center gap-0.5"
            >
              Full guide <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-bg-elev px-6 py-12 text-center">
              <p className="text-[13px] text-text mb-1.5">No projects match your search</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {filtered.map((proj) => (
                <div key={proj.id} className="rounded-xl border border-border bg-bg-elev overflow-hidden">
                  {/* Project header */}
                  <div className="group flex items-center justify-between px-6 py-4 border-b border-border bg-bg">
                    <div className="min-w-0">
                      <h2 className="text-[14px] font-semibold text-text">{proj.name}</h2>
                      <p className="font-mono text-[10.5px] text-text-faint mt-0.5 flex items-center gap-1.5">
                        <span className="truncate">{proj.id}</span>
                        <CopyIdButton value={proj.id} />
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled
                        className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] rounded-[5px] bg-text text-bg font-medium opacity-60 cursor-not-allowed"
                        title="Disabled in demo"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">New Spanlens key</span>
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Disabled in demo"
                        className="p-1.5 rounded text-text-faint opacity-60 cursor-not-allowed"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Spanlens keys */}
                  {proj.api_keys.length === 0 ? (
                    <p className="px-6 py-5 text-[13px] text-text-faint">No Spanlens keys yet. Create one to start.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {proj.api_keys.map((key) => (
                        <div key={key.id}>
                          <div className="flex items-center gap-3 px-6 py-3 bg-bg/30">
                            <KeyIcon className="h-3.5 w-3.5 text-text-faint shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className={cn('text-[13.5px] font-semibold truncate', !key.is_active && 'line-through text-text-faint')}>
                                {key.name}
                              </div>
                              <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                                {key.key_prefix}…
                                <span className="ml-2">
                                  {key.last_used_days_ago == null
                                    ? '· never used'
                                    : key.last_used_days_ago === 0
                                      ? '· last used today'
                                      : `· last used ${key.last_used_days_ago}d ago`}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setRateLimitsKey({ id: key.id, name: key.name })}
                              className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] shrink-0 rounded-[5px] border border-border bg-bg-elev text-text-muted hover:text-text transition-colors"
                              title="Configure rate limits for this key"
                            >
                              <Gauge className="h-3.5 w-3.5" /> Rate limits
                            </button>
                            <button
                              type="button"
                              disabled
                              className="hidden sm:flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] shrink-0 rounded-[5px] border border-border bg-bg-elev text-text-muted opacity-60 cursor-not-allowed"
                              title="Disabled in demo"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add provider key
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={key.is_active}
                                disabled
                                title="Disabled in demo"
                                className={cn(
                                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors opacity-70 cursor-not-allowed',
                                  key.is_active ? 'bg-good' : 'bg-border-strong',
                                )}
                              >
                                <span
                                  className={cn(
                                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                                    key.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]',
                                  )}
                                />
                              </button>
                              <button
                                type="button"
                                disabled
                                title="Disabled in demo"
                                className="p-1.5 rounded text-text-faint opacity-60 cursor-not-allowed"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Provider keys */}
                          {key.provider_keys.length === 0 ? (
                            <p className="px-12 py-2.5 text-[12px] text-text-faint">
                              No provider keys yet. Add OpenAI / Anthropic / Gemini to enable calls through this Spanlens key.
                            </p>
                          ) : (
                            <div>
                              {key.provider_keys.map((pk) => (
                                <div key={pk.id} className="grid grid-cols-[1fr_100px_60px] gap-4 px-12 py-2 items-center">
                                  <span className={cn('text-[12.5px] truncate', !pk.is_active && 'line-through text-text-faint')}>
                                    {pk.name}
                                  </span>
                                  <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-border text-text-muted w-fit">
                                    {pk.provider}
                                  </span>
                                  <div className="flex items-center gap-1 justify-end">
                                    <button
                                      type="button"
                                      disabled
                                      title="Disabled in demo"
                                      className="p-1 rounded text-text-faint opacity-60 cursor-not-allowed"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled
                                      title="Disabled in demo"
                                      className="p-1 rounded text-text-faint opacity-60 cursor-not-allowed"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rate limits dialog (per Spanlens key) — read-only static view */}
      <DemoRateLimitsDialog
        apiKey={rateLimitsKey}
        open={rateLimitsKey !== null}
        onClose={() => setRateLimitsKey(null)}
      />
    </div>
  )
}
