'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, Terminal, ExternalLink, Pencil, Trash2, Search, Check, Copy, Gauge } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type DemoProvKey = {
  id: string
  name: string
  provider: 'openai' | 'anthropic' | 'gemini' | 'azure'
  is_active: boolean
  /** Static labels — the demo never reads the clock, so SSR and client agree. */
  added_label: string
  last_used_label: string
  status: 'active' | 'stale'
}

type DemoApiKey = {
  id: string
  name: string
  key_prefix: string
  is_active: boolean
  created_label: string
  last_used_label: string
  /** Drives the STALE KEYS tile without a date computation. */
  is_stale: boolean
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
        created_label: '4mo ago',
        last_used_label: 'last used today',
        is_stale: false,
        provider_keys: [
          {
            id: 'pk-1',
            name: 'OpenAI prod',
            provider: 'openai',
            is_active: true,
            added_label: '4mo ago',
            last_used_label: 'last used today',
            status: 'active',
          },
          {
            id: 'pk-2',
            name: 'Anthropic prod',
            provider: 'anthropic',
            is_active: true,
            added_label: '4mo ago',
            last_used_label: 'last used today',
            status: 'active',
          },
        ],
      },
      {
        id: 'apk_01HZX9P2L4G3U8W7R6S5T4E3X2',
        name: 'support-bot',
        key_prefix: 'sl_live_b4d1',
        is_active: true,
        created_label: '2mo ago',
        last_used_label: 'last used 2d ago',
        is_stale: false,
        provider_keys: [
          {
            id: 'pk-3',
            name: 'OpenAI prod',
            provider: 'openai',
            is_active: true,
            added_label: '2mo ago',
            last_used_label: 'last used 2d ago',
            status: 'active',
          },
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
        created_label: '6mo ago',
        last_used_label: 'last used 38d ago',
        is_stale: true,
        provider_keys: [
          {
            id: 'pk-4',
            name: 'OpenAI staging',
            provider: 'openai',
            is_active: true,
            added_label: '6mo ago',
            last_used_label: 'last used 38d ago',
            status: 'stale',
          },
          {
            id: 'pk-5',
            name: 'Gemini staging',
            provider: 'gemini',
            is_active: false,
            added_label: '5mo ago',
            last_used_label: 'never used',
            status: 'stale',
          },
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
  created_label: string
  last_used_label: string
}

const DEMO_PUBLIC_KEYS: DemoPublicKey[] = [
  {
    id: 'pub_01HZXC7Q2R8K3M5N6P7S8T9U0V',
    name: 'Cursor MCP',
    masked_value: 'sl_live_pub_9c2a…7f4e',
    is_active: true,
    created_label: '1mo ago',
    last_used_label: 'last used today',
  },
  {
    id: 'pub_01HZXD1W4S9L4N6P7Q8T9U0V1X',
    name: 'Grafana embed',
    masked_value: 'sl_live_pub_3b8d…2a1c',
    is_active: true,
    created_label: '3mo ago',
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

// ── Shared surface classes ───────────────────────────────────────────────────
// Same table language as the live /projects page; head and row grids share one
// column template so they can never drift out of alignment.
const PILL_SECONDARY =
  'rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors'
const PILL_DISABLED =
  'rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text-muted opacity-60 cursor-not-allowed'
const PILL_ACCENT_DISABLED =
  'rounded-full bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg opacity-60 cursor-not-allowed'
const TABLE_CARD = 'rounded-card border border-border bg-bg-elev shadow-card overflow-hidden'
const TABLE_HEAD_CELL = 'font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint'
const SECTION_EYEBROW = 'font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint'
const STATUS_PILL =
  'inline-flex w-fit items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]'

const PROJECT_COLS =
  'grid grid-cols-[minmax(180px,1.2fr)_minmax(230px,1.4fr)_110px_minmax(230px,auto)] gap-3'
const KEY_COLS =
  'grid grid-cols-[minmax(210px,1.5fr)_84px_minmax(130px,1fr)_120px_minmax(140px,1fr)_minmax(330px,auto)] gap-3'
const PROVIDER_COLS =
  'grid grid-cols-[110px_minmax(150px,1.2fr)_minmax(160px,1fr)_120px_minmax(140px,1fr)_86px_minmax(190px,auto)] gap-3'

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
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-elev px-3 py-2">
      <span className={cn('text-[12.5px]', isActive ? 'text-text' : 'text-text-faint line-through')}>
        {label}
      </span>
      <span className={cn(STATUS_PILL, isActive ? 'bg-good-bg text-good' : 'bg-bg-chip text-text-muted')}>
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
            <button type="button" disabled title="Disabled in demo" className={cn(PILL_DISABLED, 'shrink-0')}>
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

  // Flat rows for the two key tables, narrowed to whatever the search left.
  const keyRows = useMemo(
    () => filtered.flatMap((p) => p.api_keys.map((k) => ({ key: k, projectName: p.name }))),
    [filtered],
  )
  const providerRows = useMemo(
    () =>
      filtered.flatMap((p) =>
        p.api_keys.flatMap((k) => k.provider_keys.map((pk) => ({ pk, parent: k.name }))),
      ),
    [filtered],
  )
  const publicRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return DEMO_PUBLIC_KEYS
    return DEMO_PUBLIC_KEYS.filter((k) => k.name.toLowerCase().includes(q))
  }, [query])

  // Stat tiles always cover the full dataset, not the filtered view.
  const stats = useMemo(() => {
    let fullKeys = 0
    let staleKeys = 0
    let providerKeys = 0
    const providers = new Set<string>()
    for (const p of DEMO_PROJECTS) {
      fullKeys += p.api_keys.length
      for (const k of p.api_keys) {
        if (k.is_stale) staleKeys += 1
        providerKeys += k.provider_keys.length
        for (const pk of k.provider_keys) providers.add(pk.provider)
      }
    }
    return {
      projects: DEMO_PROJECTS.length,
      spanlensKeys: fullKeys + DEMO_PUBLIC_KEYS.length,
      publicKeys: DEMO_PUBLIC_KEYS.length,
      fullKeys,
      staleKeys,
      providerKeys,
      providerCount: providers.size,
    }
  }, [])

  const statCards = [
    {
      label: 'Projects',
      value: String(stats.projects),
      note: DEMO_PROJECTS.map((p) => p.name).join(', '),
      tone: 'text-text-faint',
    },
    {
      label: 'Spanlens keys',
      value: String(stats.spanlensKeys),
      note: `${stats.publicKeys} public, ${stats.fullKeys} full`,
      tone: 'text-text-faint',
    },
    {
      label: 'Provider keys',
      value: String(stats.providerKeys),
      note: `across ${stats.providerCount} providers`,
      tone: 'text-text-faint',
    },
    {
      label: 'Stale keys',
      value: String(stats.staleKeys),
      note: stats.staleKeys > 0 ? 'no traffic in 30 days' : 'all keys used recently',
      tone: stats.staleKeys > 0 ? 'text-accent' : 'text-text-faint',
    },
  ]

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
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding the demo
          layout applies so its hairline spans the whole main column. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Projects & Keys' }]}
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
                title="Disabled in demo"
                className={cn(PILL_ACCENT_DISABLED, 'hidden sm:inline-flex items-center gap-1.5')}
              >
                <Plus className="h-3.5 w-3.5" /> New project
              </button>
            </div>
          }
        />
      </div>

      <div className="pt-4 md:pt-5 space-y-4">
        {/* The breadcrumb carries the visible page title, so the document
            heading is screen-reader only. */}
        <h1 className="sr-only">Projects &amp; Keys</h1>

        {/* Stat row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {statCards.map((s) => (
            <div
              key={s.label}
              className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]"
            >
              <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
                {s.label}
              </div>
              <div className="font-display text-[22px] track-h3 leading-[1.05] text-text mt-[7px] tabular-nums">
                {s.value}
              </div>
              <div className={cn('text-[11.5px] font-medium mt-[7px] truncate', s.tone)}>{s.note}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search projects, keys, providers…"
              className="w-full rounded-md border border-border bg-bg-elev pl-9 pr-9 py-2 text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors"
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
        <div className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 text-[13px] text-text-muted">
            <Terminal className="h-4 w-4 shrink-0 text-text-faint" />
            <span>
              Quick integrate:{' '}
              <code className="font-mono text-[12px] bg-bg-sunk border border-border px-1.5 py-0.5 rounded">
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
          <div className={cn(TABLE_CARD, 'px-6 py-12 text-center')}>
            <p className="text-[13px] text-text mb-3">No projects match your search</p>
            <button type="button" onClick={() => setQuery('')} className={PILL_SECONDARY}>
              Clear search
            </button>
          </div>
        ) : (
          <>
            {/* ── Projects ─────────────────────────────────────────────── */}
            <section className="space-y-2">
              <span className={SECTION_EYEBROW}>Projects</span>
              <div className={TABLE_CARD}>
                <div className="overflow-x-auto">
                  <div className="min-w-[840px]">
                    <div className={cn(PROJECT_COLS, 'bg-bg-muted border-b border-border px-[18px] py-2.5')}>
                      <span className={TABLE_HEAD_CELL}>Project</span>
                      <span className={TABLE_HEAD_CELL}>Project ID</span>
                      <span className={TABLE_HEAD_CELL}>Spanlens keys</span>
                      <span className={cn(TABLE_HEAD_CELL, 'text-right')}>Actions</span>
                    </div>
                    {filtered.map((proj) => (
                      <div
                        key={proj.id}
                        className={cn(
                          PROJECT_COLS,
                          'group items-center px-[18px] py-3 border-b border-border last:border-b-0',
                        )}
                      >
                        <span className="font-mono text-[12px] text-text truncate">{proj.name}</span>
                        <span className="flex items-center gap-1 min-w-0">
                          <span className="font-mono text-[12px] text-text-muted truncate">{proj.id}</span>
                          <CopyIdButton value={proj.id} />
                        </span>
                        <span className="font-mono text-[12px] text-text-muted tabular-nums">
                          {proj.api_keys.length}
                        </span>
                        <span className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled
                            title="Disabled in demo"
                            className={cn(PILL_DISABLED, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                          >
                            <Plus className="h-3.5 w-3.5" /> New key
                          </button>
                          <button
                            type="button"
                            disabled
                            title="Disabled in demo"
                            aria-label="Delete project"
                            className={cn(PILL_DISABLED, 'inline-flex items-center gap-1.5')}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Spanlens keys ────────────────────────────────────────────
                Full (project-scoped) and public (workspace-scoped) keys share
                one table, told apart by the SCOPE pill. */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className={SECTION_EYEBROW}>Spanlens keys</span>
                  <p className="text-[11.5px] text-text-faint mt-1">
                    Public keys are read-only credentials safe for MCP servers, BI tools, and embeds. They cannot make LLM calls or ingest traces.
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  title="Disabled in demo"
                  className={cn(PILL_DISABLED, 'inline-flex items-center gap-1.5 shrink-0')}
                >
                  <Plus className="h-3.5 w-3.5" /> New public key
                </button>
              </div>

              {keyRows.length === 0 && publicRows.length === 0 ? (
                <div className={cn(TABLE_CARD, 'px-6 py-8 text-center text-[12.5px] text-text-muted')}>
                  No Spanlens keys match the current search.
                </div>
              ) : (
                <div className={TABLE_CARD}>
                  <div className="overflow-x-auto">
                    <div className="min-w-[1120px]">
                      <div className={cn(KEY_COLS, 'bg-bg-muted border-b border-border px-[18px] py-2.5')}>
                        <span className={TABLE_HEAD_CELL}>Spanlens key</span>
                        <span className={TABLE_HEAD_CELL}>Scope</span>
                        <span className={TABLE_HEAD_CELL}>Project</span>
                        <span className={TABLE_HEAD_CELL}>Created</span>
                        <span className={TABLE_HEAD_CELL}>Last used</span>
                        <span className={cn(TABLE_HEAD_CELL, 'text-right')}>Actions</span>
                      </div>

                      {keyRows.map(({ key, projectName }) => (
                        <div
                          key={key.id}
                          className={cn(
                            KEY_COLS,
                            'items-center px-[18px] py-3 border-b border-border last:border-b-0',
                          )}
                        >
                          <span className="min-w-0">
                            <span
                              className={cn(
                                'block font-mono text-[12px] text-text truncate',
                                !key.is_active && 'line-through text-text-faint',
                              )}
                            >
                              {key.name}
                            </span>
                            <span className="block font-mono text-[10.5px] text-text-faint mt-0.5 truncate">
                              {key.key_prefix}…
                            </span>
                          </span>
                          <span className={cn(STATUS_PILL, 'bg-bg-chip text-text-muted')}>full</span>
                          <span className="font-mono text-[12px] text-text-muted truncate">{projectName}</span>
                          <span className="font-mono text-[12px] text-text-muted whitespace-nowrap">
                            {key.created_label}
                          </span>
                          <span className="font-mono text-[12px] text-text-muted truncate">
                            {key.last_used_label}
                          </span>
                          <span className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setRateLimitsKey({ id: key.id, name: key.name })}
                              title="Configure rate limits for this key"
                              className={cn(PILL_SECONDARY, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                            >
                              <Gauge className="h-3.5 w-3.5" /> Rate limits
                            </button>
                            <button
                              type="button"
                              disabled
                              title="Disabled in demo"
                              className={cn(PILL_DISABLED, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                            >
                              <Plus className="h-3.5 w-3.5" /> Provider key
                            </button>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={key.is_active}
                              disabled
                              title="Disabled in demo"
                              className={cn(
                                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors opacity-70 cursor-not-allowed',
                                key.is_active ? 'bg-good' : 'bg-border-strong',
                              )}
                            >
                              <span
                                className={cn(
                                  'inline-block h-3.5 w-3.5 rounded-full bg-bg-elev shadow transition-transform',
                                  key.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]',
                                )}
                              />
                            </button>
                            <button
                              type="button"
                              disabled
                              title="Disabled in demo"
                              aria-label="Delete Spanlens key"
                              className={cn(PILL_DISABLED, 'whitespace-nowrap')}
                            >
                              Delete
                            </button>
                          </span>
                        </div>
                      ))}

                      {publicRows.map((key) => (
                        <div
                          key={key.id}
                          className={cn(
                            KEY_COLS,
                            'items-center px-[18px] py-3 border-b border-border last:border-b-0',
                          )}
                        >
                          <span className="min-w-0">
                            <span
                              className={cn(
                                'block font-mono text-[12px] text-text truncate',
                                !key.is_active && 'line-through text-text-faint',
                              )}
                            >
                              {key.name}
                            </span>
                            <span className="block font-mono text-[10.5px] text-text-faint mt-0.5 truncate">
                              {key.masked_value}
                            </span>
                          </span>
                          <span className={cn(STATUS_PILL, 'bg-accent-bg text-accent')}>public</span>
                          <span className="font-mono text-[12px] text-text-muted truncate">workspace wide</span>
                          <span className="font-mono text-[12px] text-text-muted whitespace-nowrap">
                            {key.created_label}
                          </span>
                          <span className="font-mono text-[12px] text-text-muted truncate">
                            {key.last_used_label}
                          </span>
                          <span className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              disabled
                              title="Disabled in demo"
                              aria-label="Revoke public key"
                              className={cn(PILL_DISABLED, 'whitespace-nowrap')}
                            >
                              Revoke
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── Provider keys ────────────────────────────────────────── */}
            <section className="space-y-2">
              <span className={SECTION_EYEBROW}>Provider keys</span>
              {providerRows.length === 0 ? (
                <div className={cn(TABLE_CARD, 'px-6 py-8 text-center text-[12.5px] text-text-muted')}>
                  No provider keys match the current search.
                </div>
              ) : (
                <div className={TABLE_CARD}>
                  <div className="overflow-x-auto">
                    <div className="min-w-[1080px]">
                      <div className={cn(PROVIDER_COLS, 'bg-bg-muted border-b border-border px-[18px] py-2.5')}>
                        <span className={TABLE_HEAD_CELL}>Provider</span>
                        <span className={TABLE_HEAD_CELL}>Key name</span>
                        <span className={TABLE_HEAD_CELL}>Nested under</span>
                        <span className={TABLE_HEAD_CELL}>Added</span>
                        <span className={TABLE_HEAD_CELL}>Last used</span>
                        <span className={TABLE_HEAD_CELL}>Status</span>
                        <span className={cn(TABLE_HEAD_CELL, 'text-right')}>Actions</span>
                      </div>
                      {providerRows.map(({ pk, parent }) => (
                        <div
                          key={pk.id}
                          className={cn(
                            PROVIDER_COLS,
                            'items-center px-[18px] py-3 border-b border-border last:border-b-0',
                          )}
                        >
                          <span className="font-mono text-[12px] text-text truncate">{pk.provider}</span>
                          <span
                            className={cn(
                              'font-mono text-[12px] text-text-muted truncate',
                              !pk.is_active && 'line-through text-text-faint',
                            )}
                          >
                            {pk.name}
                          </span>
                          <span className="font-mono text-[12px] text-text-muted truncate">{parent}</span>
                          <span className="font-mono text-[12px] text-text-muted whitespace-nowrap">
                            {pk.added_label}
                          </span>
                          <span className="font-mono text-[12px] text-text-muted truncate">
                            {pk.last_used_label}
                          </span>
                          <span
                            className={cn(
                              STATUS_PILL,
                              !pk.is_active
                                ? 'bg-bg-chip text-text-muted'
                                : pk.status === 'stale'
                                  ? 'bg-warn-bg text-warn'
                                  : 'bg-good-bg text-good',
                            )}
                          >
                            {!pk.is_active ? 'inactive' : pk.status}
                          </span>
                          <span className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              disabled
                              title="Disabled in demo"
                              aria-label="Rotate provider key"
                              className={cn(PILL_DISABLED, 'inline-flex items-center gap-1.5')}
                            >
                              <Pencil className="h-3 w-3" /> Rotate
                            </button>
                            <button
                              type="button"
                              disabled
                              title="Disabled in demo"
                              aria-label="Delete provider key"
                              className={cn(PILL_DISABLED, 'whitespace-nowrap')}
                            >
                              Delete
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Rate limits dialog (per Spanlens key) — read-only static view */}
      <DemoRateLimitsDialog
        apiKey={rateLimitsKey}
        open={rateLimitsKey !== null}
        onClose={() => setRateLimitsKey(null)}
      />
    </>
  )
}
