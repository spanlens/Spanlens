'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Plus,
  Copy,
  Terminal,
  Check,
  ExternalLink,
  Pencil,
  Search,
  Trash2,
  Key as KeyIcon,
  Gauge,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { GhostBtn, PrimaryBtn } from '@/components/ui/primitives'
import { useCreateProject, useDeleteProject, useProjects } from '@/lib/queries/use-projects'
import { useCurrentRoleLoading } from '@/lib/queries/use-current-role'
import {
  useApiKeys,
  useIssueApiKey,
  useToggleApiKey,
  useDeleteApiKey,
  usePublicKeys,
} from '@/lib/queries/use-api-keys'
import {
  useProviderKeys,
  useAddProviderKey,
  useRotateProviderKey,
  useDeleteProviderKey,
} from '@/lib/queries/use-provider-keys'
import { cn } from '@/lib/utils'
import { formatLastUsed } from '@/lib/api-key-staleness'
import { StaleBadge } from '@/components/ui/stale-badge'
import { RateLimitsDialog } from './_components/rate-limits-dialog'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

// Click-to-copy text element. Shows a transient "Copied" affordance.
function CopyIdButton({ value, label = 'Copy ID' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={label}
      aria-label={label}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-text-faint hover:text-text"
    >
      {copied ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

const PROVIDERS = [
  'openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter',
  'groq', 'deepseek', 'xai', 'cohere',
] as const
type ProviderName = typeof PROVIDERS[number]

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  azure: 'Azure OpenAI',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  xai: 'xAI (Grok)',
  cohere: 'Cohere',
}

const PROVIDER_PLACEHOLDERS: Record<ProviderName, string> = {
  openai: 'sk-…',
  anthropic: 'sk-ant-…',
  gemini: 'AIza…',
  // Azure keys are 32-char hex strings with no prefix — show two groups so users
  // recognize the format.
  azure: '0123456789abcdef0123456789abcdef',
  mistral: 'mistral-…',
  openrouter: 'sk-or-v1-…',
  groq: 'gsk_…',
  deepseek: 'sk-…',
  xai: 'xai-…',
  cohere: 'Cohere API key',
}

/**
 * Code snippet shown after a provider key is added — the customer pastes
 * this into their app and the call routes through Spanlens automatically.
 * No CLI re-run needed once SPANLENS_API_KEY is in their .env.local.
 *
 * Azure uses the OpenAI SDK with a Spanlens-routed baseURL. The customer's
 * Azure resource URL is held server-side on the provider key row — they
 * don't need to repeat it in client code.
 */
const PROVIDER_SNIPPETS: Record<ProviderName, string> = {
  openai: `import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI()
// Use the OpenAI SDK as usual:
// await openai.chat.completions.create({ ... })`,
  anthropic: `import { createAnthropic } from '@spanlens/sdk/anthropic'

const anthropic = createAnthropic()
// Use the Anthropic SDK as usual:
// await anthropic.messages.create({ ... })`,
  gemini: `import { createGemini } from '@spanlens/sdk/gemini'

const genAI = createGemini()
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
// await model.generateContent('...')`,
  azure: `import OpenAI from 'openai'

// Azure resource URL is stored on the Spanlens provider key — your client
// just talks to /proxy/azure and Spanlens forwards to the right Azure endpoint.
const azure = new OpenAI({
  baseURL: 'https://server.spanlens.io/proxy/azure',
  apiKey: process.env.SPANLENS_API_KEY,
})
// await azure.chat.completions.create({ model: 'gpt-4o', messages: [...] })`,
  mistral: `import OpenAI from 'openai'

// Mistral exposes an OpenAI-compatible API — point the OpenAI SDK at the
// Spanlens proxy and use any Mistral model id.
const mistral = new OpenAI({
  baseURL: 'https://server.spanlens.io/proxy/mistral/v1',
  apiKey: process.env.SPANLENS_API_KEY,
})
// await mistral.chat.completions.create({ model: 'mistral-large-latest', messages: [...] })`,
  openrouter: `import OpenAI from 'openai'

// OpenRouter is OpenAI-compatible and gives you 100+ models behind one key.
// Use the vendor-prefixed model id (e.g. 'openai/gpt-4o', 'anthropic/claude-sonnet-4').
const openrouter = new OpenAI({
  baseURL: 'https://server.spanlens.io/proxy/openrouter/v1',
  apiKey: process.env.SPANLENS_API_KEY,
})
// await openrouter.chat.completions.create({ model: 'anthropic/claude-sonnet-4', messages: [...] })`,
  groq: `import { createGroq } from '@spanlens/sdk/groq'

// Groq is OpenAI-compatible — createGroq() points the OpenAI SDK at the
// Spanlens proxy. Use any Groq model id.
const groq = createGroq()
// await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [...] })`,
  deepseek: `import { createDeepSeek } from '@spanlens/sdk/deepseek'

// DeepSeek is OpenAI-compatible — createDeepSeek() routes through Spanlens.
const deepseek = createDeepSeek()
// await deepseek.chat.completions.create({ model: 'deepseek-chat', messages: [...] })`,
  xai: `import { createXai } from '@spanlens/sdk/xai'

// xAI (Grok) is OpenAI-compatible — createXai() routes through Spanlens.
const xai = createXai()
// await xai.chat.completions.create({ model: 'grok-4.3', messages: [...] })`,
  cohere: `import { createCohere } from '@spanlens/sdk/cohere'

// Cohere's OpenAI-compat layer routes through Spanlens. Use Cohere model ids.
const cohere = createCohere()
// await cohere.chat.completions.create({ model: 'command-a-03-2025', messages: [...] })`,
}

export function ProjectsClient() {
  const projectsQuery = useProjects()
  const apiKeysQuery = useApiKeys()
  const providerKeysQuery = useProviderKeys() // org-wide list, grouped client-side by api_key_id

  const createProject = useCreateProject()
  const deleteProject = useDeleteProject()
  const issueApiKey = useIssueApiKey()
  const toggleApiKey = useToggleApiKey()
  const deleteApiKey = useDeleteApiKey()
  const addProviderKey = useAddProviderKey()
  const rotateProviderKey = useRotateProviderKey()
  const deleteProviderKey = useDeleteProviderKey()

  // Banner shown once after a Spanlens key is created
  const [newKey, setNewKey] = useState<string | null>(null)
  // Rate-limits dialog target (Spanlens key). null = closed.
  const [rateLimitsKey, setRateLimitsKey] = useState<{ id: string; name: string } | null>(null)
  const [cmdCopied, setCmdCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  // Create project dialog
  const [projDialogOpen, setProjDialogOpen] = useState(false)
  const [projName, setProjName] = useState('')
  const [projError, setProjError] = useState<string | null>(null)

  // Add provider key dialog (now scoped to a Spanlens key)
  const [addProvDialogOpen, setAddProvDialogOpen] = useState(false)
  const [addProvApiKeyId, setAddProvApiKeyId] = useState('')
  const [addProvProvider, setAddProvProvider] = useState<ProviderName>('openai')
  const [addProvName, setAddProvName] = useState('')
  const [addProvKey, setAddProvKey] = useState('')
  // Azure only — empty for all other providers. Server validates + normalizes.
  const [addProvAzureUrl, setAddProvAzureUrl] = useState('')
  const [addProvError, setAddProvError] = useState<string | null>(null)
  // After a successful add, show the integration snippet instead of closing.
  const [addProvAdded, setAddProvAdded] = useState<ProviderName | null>(null)
  const [snippetCopied, setSnippetCopied] = useState(false)

  // Issue Spanlens key dialog
  const [issueDialogOpen, setIssueDialogOpen] = useState(false)
  const [issueProjectId, setIssueProjectId] = useState('')
  const [issueName, setIssueName] = useState('')
  const [issueError, setIssueError] = useState<string | null>(null)

  // Issue workspace-level public key dialog (separate from the per-project flow)
  const [issuePublicDialogOpen, setIssuePublicDialogOpen] = useState(false)
  const [issuePublicName, setIssuePublicName] = useState('')
  const [issuePublicError, setIssuePublicError] = useState<string | null>(null)
  const publicKeysQuery = usePublicKeys()
  const publicKeys = publicKeysQuery.data ?? []

  // Rotate provider key dialog
  const [rotateProvKeyId, setRotateProvKeyId] = useState<string | null>(null)
  const [rotateProvNew, setRotateProvNew] = useState('')
  const [rotateProvError, setRotateProvError] = useState<string | null>(null)

  // Delete confirms
  const [deleteApiKeyId, setDeleteApiKeyId] = useState<string | null>(null)
  const [deleteProvKeyId, setDeleteProvKeyId] = useState<string | null>(null)
  // Project delete requires typing the project name as confirmation —
  // deleting a project cascades through every Spanlens key, provider key,
  // and (in ClickHouse) every request row's project_id reference.
  const [deleteProject_target, setDeleteProject_target] = useState<{ id: string; name: string } | null>(null)
  const [deleteProject_input, setDeleteProject_input] = useState('')
  const [deleteProject_error, setDeleteProject_error] = useState<string | null>(null)

  // Track which specific toggle is pending
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  function copyWizardCmd() {
    void navigator.clipboard.writeText('npx @spanlens/cli init')
    setCmdCopied(true)
    setTimeout(() => setCmdCopied(false), 1500)
  }

  function copyNewKey() {
    if (!newKey) return
    void navigator.clipboard.writeText(newKey)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 1500)
  }

  async function handleCreateProject() {
    setProjError(null)
    try {
      await createProject.mutateAsync({ name: projName.trim() })
      setProjName('')
      setProjDialogOpen(false)
    } catch (err) {
      setProjError(err instanceof Error ? err.message : 'Failed to create project')
    }
  }

  function openAddProvDialog(apiKeyId: string) {
    setAddProvApiKeyId(apiKeyId)
    setAddProvProvider('openai')
    setAddProvName('')
    setAddProvKey('')
    setAddProvAzureUrl('')
    setAddProvError(null)
    setAddProvAdded(null)
    setAddProvDialogOpen(true)
  }

  async function handleAddProviderKey() {
    setAddProvError(null)
    try {
      await addProviderKey.mutateAsync({
        provider: addProvProvider,
        key: addProvKey.trim(),
        name: addProvName.trim(),
        api_key_id: addProvApiKeyId,
        // Server enforces the resource_url shape (https + Azure host); we just
        // pass through what the user typed and surface any validation error.
        ...(addProvProvider === 'azure'
          ? { provider_metadata: { resource_url: addProvAzureUrl.trim() } }
          : {}),
      })
      // Don't close yet — switch the dialog to the snippet view so the
      // customer can copy the integration code immediately. They'll click
      // "Done" to dismiss.
      setAddProvAdded(addProvProvider)
    } catch (err) {
      setAddProvError(err instanceof Error ? err.message : 'Failed to add key')
    }
  }

  function copyProviderSnippet() {
    if (!addProvAdded) return
    void navigator.clipboard.writeText(PROVIDER_SNIPPETS[addProvAdded])
    setSnippetCopied(true)
    setTimeout(() => setSnippetCopied(false), 1500)
  }

  function openIssueDialog(projectId: string) {
    setIssueProjectId(projectId)
    setIssueName('')
    setIssueError(null)
    setIssueDialogOpen(true)
  }

  async function handleIssueApiKey() {
    setIssueError(null)
    try {
      const result = await issueApiKey.mutateAsync({
        name: issueName.trim(),
        projectId: issueProjectId,
      })
      setNewKey(result?.key ?? null)
      setIssueDialogOpen(false)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : 'Failed to issue key')
    }
  }

  function openIssuePublicDialog() {
    setIssuePublicName('')
    setIssuePublicError(null)
    setIssuePublicDialogOpen(true)
  }

  async function handleIssuePublicKey() {
    setIssuePublicError(null)
    try {
      const result = await issueApiKey.mutateAsync({
        name: issuePublicName.trim(),
        scope: 'public',
      })
      setNewKey(result?.key ?? null)
      setIssuePublicDialogOpen(false)
    } catch (err) {
      setIssuePublicError(err instanceof Error ? err.message : 'Failed to issue key')
    }
  }

  function openRotateProvDialog(keyId: string) {
    setRotateProvKeyId(keyId)
    setRotateProvNew('')
    setRotateProvError(null)
  }

  async function handleRotateProviderKey() {
    if (!rotateProvKeyId) return
    setRotateProvError(null)
    try {
      await rotateProviderKey.mutateAsync({ id: rotateProvKeyId, key: rotateProvNew.trim() })
      setRotateProvKeyId(null)
    } catch (err) {
      setRotateProvError(err instanceof Error ? err.message : 'Failed to rotate key')
    }
  }

  async function handleDeleteApiKey() {
    if (!deleteApiKeyId) return
    await deleteApiKey.mutateAsync(deleteApiKeyId)
    setDeleteApiKeyId(null)
  }

  async function handleDeleteProviderKey() {
    if (!deleteProvKeyId) return
    await deleteProviderKey.mutateAsync(deleteProvKeyId)
    setDeleteProvKeyId(null)
  }

  function openDeleteProjectDialog(id: string, name: string) {
    setDeleteProject_target({ id, name })
    setDeleteProject_input('')
    setDeleteProject_error(null)
  }

  function closeDeleteProjectDialog() {
    setDeleteProject_target(null)
    setDeleteProject_input('')
    setDeleteProject_error(null)
  }

  async function handleDeleteProject() {
    if (!deleteProject_target) return
    if (deleteProject_input !== deleteProject_target.name) {
      setDeleteProject_error('Project name does not match.')
      return
    }
    setDeleteProject_error(null)
    try {
      await deleteProject.mutateAsync(deleteProject_target.id)
      closeDeleteProjectDialog()
    } catch (err) {
      setDeleteProject_error(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  // Includes role loading — otherwise the page paints with PermissionGate'd
  // write buttons hidden (role still null), then the buttons pop in a moment
  // later. Most visible right after sign-up when no role cache exists.
  const roleLoading = useCurrentRoleLoading()
  const loading =
    projectsQuery.isLoading ||
    apiKeysQuery.isLoading ||
    providerKeysQuery.isLoading ||
    roleLoading
  const isFetching =
    projectsQuery.isFetching ||
    apiKeysQuery.isFetching ||
    providerKeysQuery.isFetching
  // List-load failure (distinct from the create-dialog's projError). Without
  // this, a 500 falls through to the "No projects yet" onboarding CTA even for
  // a workspace that has projects. Show an error + retry instead.
  const listError =
    projectsQuery.isError ||
    apiKeysQuery.isError ||
    providerKeysQuery.isError
  const allProjects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const allApiKeys = useMemo(() => apiKeysQuery.data ?? [], [apiKeysQuery.data])
  const allProviderKeys = useMemo(() => providerKeysQuery.data ?? [], [providerKeysQuery.data])

  // URL-backed search — matches project name, Spanlens key name, and
  // provider key name. Hides projects whose tree contains zero matches.
  const search = sp.get('q') ?? ''
  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/projects?${next.toString()}`)
  }
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  // After filter: a project is visible if its name matches OR any nested
  // Spanlens key or provider key matches.
  const { projects, apiKeys, providerKeys } = useMemo(() => {
    if (!search) {
      return { projects: allProjects, apiKeys: allApiKeys, providerKeys: allProviderKeys }
    }
    const needle = search.toLowerCase()
    const provHit = allProviderKeys.filter((pk) => (pk.name ?? '').toLowerCase().includes(needle))
    const provHitKeyIds = new Set(provHit.map((pk) => pk.api_key_id))
    const akHit = allApiKeys.filter((k) =>
      k.name.toLowerCase().includes(needle) || provHitKeyIds.has(k.id),
    )
    // Public keys (project_id null) are surfaced in their own card above
    // the project list — drop them from the search-narrowed project view.
    const akHitProjIds = new Set(
      akHit.map((k) => k.project_id).filter((id): id is string => id !== null),
    )
    const projHit = allProjects.filter((p) =>
      p.name.toLowerCase().includes(needle) || akHitProjIds.has(p.id),
    )
    const projHitIds = new Set(projHit.map((p) => p.id))
    const visibleApiKeys = allApiKeys.filter(
      (k) => k.project_id !== null && projHitIds.has(k.project_id),
    )
    const visibleApiKeyIds = new Set(visibleApiKeys.map((k) => k.id))
    const visibleProviderKeys = allProviderKeys.filter((pk) => visibleApiKeyIds.has(pk.api_key_id))
    return { projects: projHit, apiKeys: visibleApiKeys, providerKeys: visibleProviderKeys }
  }, [allProjects, allApiKeys, allProviderKeys, search])

  // Stat strip totals — always from the unfiltered list so the strip is a
  // consistent overview, not a reflection of the current search.
  const activeApiKeys = allApiKeys.filter((k) => k.is_active).length

  function refreshAll() {
    void projectsQuery.refetch()
    void apiKeysQuery.refetch()
    void providerKeysQuery.refetch()
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Projects' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={mounted && isFetching} />
              <button
                type="button"
                onClick={refreshAll}
                disabled={mounted && isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', mounted && isFetching && 'animate-spin')}>↻</span>
              </button>
              <PermissionGate need="edit">
                <GhostBtn
                  onClick={() => setProjDialogOpen(true)}
                  title="New project"
                  aria-label="New project"
                  className="flex items-center gap-1.5 text-[12.5px] px-2 sm:px-3 py-[5px] whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">New project</span>
                </GhostBtn>
              </PermissionGate>
            </div>
          }
        />
      </div>

      {/* Stat strip — unfiltered overview. 2 cols on mobile, 4 on md+. */}
      <div className="shrink-0 border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            { label: 'Projects',       value: String(allProjects.length) },
            { label: 'Spanlens keys',  value: String(allApiKeys.length) },
            { label: 'Active keys',    value: String(activeApiKeys),    warn: false },
            { label: 'Provider keys',  value: String(allProviderKeys.length) },
          ].map((s, i) => (
            <div
              key={s.label}
              className={cn(
                'px-[18px] py-[14px] border-border',
                i % 2 === 0 && 'border-r',
                i === 1 && 'border-b md:border-b-0 md:border-r',
                i === 0 && 'border-b md:border-b-0',
                i === 2 && 'md:border-r',
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className="text-[22px] sm:text-[24px] font-medium leading-none tracking-[-0.6px] tabular-nums text-text">
                {mounted ? s.value : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Search bar */}
      <div className="px-[22px] py-[10px] border-b border-border flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative max-w-md flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchInput('')
                updateQuery({ q: null })
              }
            }}
            placeholder="Search project, Spanlens key, or provider key…"
            className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
            className="font-mono text-[11px] text-text-faint hover:text-text transition-colors"
          >
            Clear
          </button>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">
          {mounted ? (projects.length === allProjects.length ? `${allProjects.length} projects` : `${projects.length} of ${allProjects.length}`) : ' '}
        </span>
      </div>

      <div>
        <div className="px-7 py-6 max-w-4xl">
          {/* New key banner — surfaces freshly minted keys (full OR public)
              at the very top of the content, between the search bar and the
              Public Keys card. The user just clicked "Create", so the
              plaintext value should be the first thing they see. */}
          {newKey && (
            <div className="rounded-xl border border-good/30 bg-good-bg px-5 py-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-medium text-good">
                  Spanlens key created, copy now (won&apos;t be shown again)
                </p>
                <button
                  type="button"
                  onClick={() => setNewKey(null)}
                  className="font-mono text-[11px] text-good/60 hover:text-good transition-colors"
                >
                  Dismiss
                </button>
              </div>

              <div className="rounded-lg border border-good/20 bg-[#1a1816] px-4 py-3 mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-[#7c7770]">
                    SPANLENS_API_KEY
                  </span>
                  <button
                    type="button"
                    onClick={copyNewKey}
                    className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity flex items-center gap-1"
                  >
                    {keyCopied ? (
                      <><Check className="h-3 w-3" /> Copied!</>
                    ) : (
                      <><Copy className="h-3 w-3" /> Copy</>
                    )}
                  </button>
                </div>
                <code className="font-mono text-[12.5px] text-good break-all leading-relaxed">
                  {newKey}
                </code>
              </div>

              <div className="rounded-lg border border-good/20 bg-[#1a1816] px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="h-3.5 w-3.5 text-[#7c7770]" />
                  <span className="font-mono text-[10.5px] text-[#7c7770] uppercase tracking-[0.05em]">
                    Next: add provider keys to this Spanlens key, then run the CLI
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <pre className="flex-1 font-mono text-[12.5px] text-good">
                    npx @spanlens/cli init
                  </pre>
                  <button
                    type="button"
                    onClick={copyWizardCmd}
                    className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity flex items-center gap-1 shrink-0"
                  >
                    {cmdCopied ? (
                      <><Check className="h-3 w-3" /> Copied</>
                    ) : (
                      <><Copy className="h-3 w-3" /> Copy</>
                    )}
                  </button>
                </div>
                <p className="font-mono text-[10.5px] text-[#5c5752]">
                  The CLI auto-patches every provider you registered under this key.{' '}
                  <Link
                    href="/docs/quick-start"
                    className="text-accent hover:opacity-80 transition-opacity underline inline-flex items-center gap-0.5"
                  >
                    Manual setup <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                </p>
              </div>
            </div>
          )}

          {/* Public Keys card — workspace-level credentials for MCP servers,
              BI tools, and read embeds. Placed above the page title so it
              reads as a distinct workspace-scope concept, separate from the
              per-project key list below. */}
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
              <PermissionGate need="edit">
                <PrimaryBtn
                  onClick={openIssuePublicDialog}
                  className="shrink-0 flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px]"
                >
                  <Plus className="h-3.5 w-3.5" /> New public key
                </PrimaryBtn>
              </PermissionGate>
            </div>

            {publicKeys.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-3 text-[12px] text-text-faint">
                No public keys yet. Generate one to read your workspace&apos;s stats from outside Spanlens.
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border bg-bg/40">
                {publicKeys.map((key) => (
                  <li key={key.id} className="flex items-center gap-3 px-3 py-2.5">
                    <KeyIcon className="h-3.5 w-3.5 text-text-faint shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'flex items-center gap-2 text-[13px] font-medium',
                          !key.is_active && 'line-through text-text-faint',
                        )}
                      >
                        <span className="truncate">{key.name}</span>
                        {/* Stale indicator only meaningful after client mount,
                            otherwise SSR may render a different badge than the
                            client computes against `Date.now()`. */}
                        {mounted && key.is_active && (
                          <StaleBadge
                            lastUsedAt={key.last_used_at}
                            createdAt={key.created_at}
                          />
                        )}
                      </div>
                      <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                        {key.key_prefix}…
                        <span className="ml-2">
                          {!mounted
                            ? '· …'
                            : `· ${formatLastUsed({ lastUsedAt: key.last_used_at, createdAt: key.created_at })}`}
                        </span>
                      </div>
                    </div>
                    <PermissionGate need="edit">
                      <button
                        type="button"
                        onClick={() => deleteApiKey.mutate(key.id)}
                        className="text-text-faint hover:text-bad transition-colors p-1"
                        title="Revoke"
                        aria-label="Revoke public key"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </PermissionGate>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mb-6">
            <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px] mb-1">
              Projects & Keys
            </h1>
            <p className="text-[13px] text-text-muted">
              Each Spanlens key holds its own AI provider keys. Expand a key to see and add OpenAI / Anthropic / Gemini keys it can call.
            </p>
          </div>

          {/* Integration hint */}
          {!newKey && projects.length > 0 && (
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
          )}

          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-border bg-bg-elev p-6">
                  <Skeleton className="h-5 w-40 mb-2" />
                  <Skeleton className="h-3 w-64" />
                </div>
              ))}
            </div>
          ) : listError ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <h2 className="text-[14px] font-semibold text-text mb-1.5">Couldn&apos;t load projects</h2>
              <p className="text-[12.5px] text-text-muted max-w-md mx-auto mb-4">
                We couldn&apos;t reach the server just now. Your projects and keys are safe.
              </p>
              <button
                type="button"
                onClick={() => {
                  void projectsQuery.refetch()
                  void apiKeysQuery.refetch()
                  void providerKeysQuery.refetch()
                }}
                className="font-mono text-[11.5px] px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors inline-block"
              >
                Retry
              </button>
            </div>
          ) : allProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <h2 className="text-[14px] font-semibold text-text mb-1.5">No projects yet</h2>
              <p className="text-[12.5px] text-text-muted max-w-md mx-auto mb-4">
                Create a project to start grouping Spanlens keys and the provider keys they call.
              </p>
              <PermissionGate need="edit">
                <PrimaryBtn
                  onClick={() => setProjDialogOpen(true)}
                  className="inline-flex items-center gap-1.5 text-[12.5px] px-3 py-[6px]"
                >
                  <Plus className="h-3.5 w-3.5" /> Create first project
                </PrimaryBtn>
              </PermissionGate>
              <div className="mt-3">
                <Link
                  href="/docs/features/projects"
                  className="font-mono text-[11.5px] px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors inline-block"
                >
                  How projects work →
                </Link>
              </div>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <p className="text-[12.5px] text-text-muted">No projects match the current search.</p>
              <button
                type="button"
                onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                className="font-mono text-[11.5px] mt-3 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {projects.map((proj) => {
                const projApiKeys = apiKeys.filter((k) => k.project_id === proj.id)
                return (
                  <div
                    key={proj.id}
                    className="rounded-xl border border-border bg-bg-elev overflow-hidden"
                  >
                    {/* Project header — buttons collapse to icon on mobile so
                        the action row never wraps under the project name. */}
                    <div className="flex items-center justify-between gap-2 px-6 py-4 border-b border-border bg-bg flex-wrap">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[14px] font-semibold text-text break-all">{proj.name}</h2>
                        <div className="group flex items-center gap-1 mt-0.5">
                          <p className="font-mono text-[10.5px] text-text-faint truncate">{proj.id}</p>
                          <CopyIdButton value={proj.id} label="Copy project ID" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <PermissionGate need="edit">
                          <PrimaryBtn
                            className="flex items-center gap-1.5 text-[12px] px-2 sm:px-3 py-[5px] h-[28px] whitespace-nowrap"
                            onClick={() => openIssueDialog(proj.id)}
                            title="New Spanlens key"
                            aria-label="New Spanlens key"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">New Spanlens key</span>
                          </PrimaryBtn>
                        </PermissionGate>
                        <PermissionGate need="edit">
                          <button
                            type="button"
                            onClick={() => openDeleteProjectDialog(proj.id, proj.name)}
                            title="Delete project"
                            aria-label="Delete project"
                            className="p-1.5 rounded hover:bg-bad/10 text-text-faint hover:text-bad transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </PermissionGate>
                      </div>
                    </div>

                    {/* Spanlens key sections, each is a self-contained group:
                        the key name acts as the header and "+ Add provider key"
                        sits next to it. Provider keys stay always-visible. */}
                    {projApiKeys.length === 0 ? (
                      <p className="px-6 py-5 text-[13px] text-text-faint">
                        No Spanlens keys yet. Create one to start.
                      </p>
                    ) : (
                      <div className="divide-y divide-border">
                        {projApiKeys.map((key) => {
                          const keyProvKeys = providerKeys.filter(
                            (pk) => pk.api_key_id === key.id,
                          )
                          return (
                            <div key={key.id}>
                              {/* Spanlens key header, name + meta + add button + actions */}
                              <div className="flex items-center gap-3 px-6 py-3 bg-bg/30">
                                <KeyIcon className="h-3.5 w-3.5 text-text-faint shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={cn(
                                      'flex items-center gap-2 text-[13.5px] font-semibold',
                                      !key.is_active && 'line-through text-text-faint',
                                    )}
                                  >
                                    <span className="truncate">{key.name}</span>
                                    {mounted && key.is_active && (
                                      <StaleBadge
                                        lastUsedAt={key.last_used_at}
                                        createdAt={key.created_at}
                                      />
                                    )}
                                  </div>
                                  <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                                    {key.key_prefix}…
                                    <span className="ml-2">
                                      {!mounted
                                        ? '· …'
                                        : `· ${formatLastUsed({ lastUsedAt: key.last_used_at, createdAt: key.created_at })}`}
                                    </span>
                                  </div>
                                </div>
                                <GhostBtn
                                  className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] shrink-0"
                                  onClick={() => setRateLimitsKey({ id: key.id, name: key.name })}
                                  title="Configure rate limits for this key"
                                >
                                  <Gauge className="h-3.5 w-3.5" /> Rate limits
                                </GhostBtn>
                                <PermissionGate need="edit">
                                  <GhostBtn
                                    className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] shrink-0"
                                    onClick={() => openAddProvDialog(key.id)}
                                  >
                                    <Plus className="h-3.5 w-3.5" /> Add provider key
                                  </GhostBtn>
                                </PermissionGate>
                                <div className="flex items-center gap-1 shrink-0">
                                  <PermissionGate need="edit">
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={key.is_active}
                                      disabled={pendingToggleId === key.id}
                                      onClick={async () => {
                                        setPendingToggleId(key.id)
                                        try {
                                          await toggleApiKey.mutateAsync({ id: key.id, is_active: !key.is_active })
                                        } finally {
                                          setPendingToggleId(null)
                                        }
                                      }}
                                      title={key.is_active ? 'Deactivate' : 'Activate'}
                                      className={cn(
                                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40',
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
                                  </PermissionGate>
                                  <PermissionGate need="edit">
                                    <button
                                      type="button"
                                      onClick={() => setDeleteApiKeyId(key.id)}
                                      title="Delete Spanlens key"
                                      className="p-1.5 rounded hover:bg-bad/10 text-text-faint hover:text-bad transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </PermissionGate>
                                </div>
                              </div>

                              {/* Provider keys under this Spanlens key, always visible */}
                              {keyProvKeys.length === 0 ? (
                                <p className="px-12 py-2.5 text-[12px] text-text-faint">
                                  No provider keys yet. Add OpenAI / Anthropic / Gemini to enable calls through this Spanlens key.
                                </p>
                              ) : (
                                <div>
                                  {keyProvKeys.map((pk) => (
                                    <div
                                      key={pk.id}
                                      className="grid grid-cols-[1fr_100px_60px] gap-4 px-12 py-2 items-center"
                                    >
                                      <span
                                        className={cn(
                                          'text-[12.5px] truncate',
                                          !pk.is_active && 'line-through text-text-faint',
                                        )}
                                      >
                                        {pk.name}
                                      </span>
                                      <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-border text-text-muted w-fit">
                                        {pk.provider}
                                      </span>
                                      <div className="flex items-center gap-1 justify-end">
                                        <PermissionGate need="edit">
                                          <button
                                            type="button"
                                            onClick={() => openRotateProvDialog(pk.id)}
                                            title="Rotate provider key"
                                            className="p-1 rounded hover:bg-bg text-text-faint hover:text-text transition-colors"
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                        </PermissionGate>
                                        <PermissionGate need="edit">
                                          <button
                                            type="button"
                                            onClick={() => setDeleteProvKeyId(pk.id)}
                                            title="Deactivate"
                                            className="p-1 rounded hover:bg-bad/10 text-text-faint hover:text-bad transition-colors"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </PermissionGate>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              {projects.length === 0 && (
                <div className="rounded-xl border border-border bg-bg-elev px-6 py-12 text-center">
                  <p className="text-[13px] text-text-faint mb-4">No projects yet.</p>
                  <PermissionGate need="edit">
                    <GhostBtn
                      onClick={() => setProjDialogOpen(true)}
                      className="inline-flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" /> Create your first project
                    </GhostBtn>
                  </PermissionGate>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create project dialog */}
      <Dialog
        open={projDialogOpen}
        onOpenChange={(open) => {
          setProjDialogOpen(open)
          if (!open) setProjError(null)
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Project name</label>
              <input
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && projName.trim() && !createProject.isPending) void handleCreateProject() }}
                placeholder="e.g. Production"
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
            {projError && (
              <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                {projError}
              </div>
            )}
            <PrimaryBtn
              onClick={() => void handleCreateProject()}
              disabled={!projName.trim() || createProject.isPending}
            >
              {createProject.isPending ? 'Creating…' : 'Create'}
            </PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>

      {/* Issue Spanlens key dialog */}
      <Dialog
        open={issueDialogOpen}
        onOpenChange={(open) => {
          setIssueDialogOpen(open)
          if (!open) { setIssueProjectId(''); setIssueError(null) }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Spanlens key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            Issue a{' '}
            <code className="font-mono bg-bg-elev border border-border px-1 rounded text-[11px]">sl_live_…</code>{' '}
            key. After creating, expand it to add provider AI keys it can call.
          </DialogDescription>

          <form
            onSubmit={(e) => { e.preventDefault(); void handleIssueApiKey() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Key name</label>
              <input
                value={issueName}
                onChange={(e) => setIssueName(e.target.value)}
                placeholder="e.g. Production"
                autoFocus
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>

            {issueError && (
              <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                {issueError}
              </div>
            )}

            <PrimaryBtn
              type="submit"
              disabled={!issueName.trim() || issueApiKey.isPending}
            >
              {issueApiKey.isPending ? 'Creating…' : 'Create key'}
            </PrimaryBtn>
          </form>
        </DialogContent>
      </Dialog>

      {/* Issue workspace-level public key dialog */}
      <Dialog
        open={issuePublicDialogOpen}
        onOpenChange={(open) => {
          setIssuePublicDialogOpen(open)
          if (!open) {
            setIssuePublicName('')
            setIssuePublicError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New public key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            Issues a{' '}
            <code className="font-mono bg-bg-elev border border-border px-1 rounded text-[11px]">
              sl_live_pub_…
            </code>{' '}
            key scoped to this workspace. Safe to paste into MCP servers, BI tools, or read-only embeds — it can only read dashboard data, never trigger LLM spend.
          </DialogDescription>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleIssuePublicKey()
            }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Key name</label>
              <input
                value={issuePublicName}
                onChange={(e) => setIssuePublicName(e.target.value)}
                placeholder="e.g. Cursor MCP"
                autoFocus
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>

            {issuePublicError && (
              <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                {issuePublicError}
              </div>
            )}

            <PrimaryBtn
              type="submit"
              disabled={!issuePublicName.trim() || issueApiKey.isPending}
            >
              {issueApiKey.isPending ? 'Creating…' : 'Create public key'}
            </PrimaryBtn>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rate limits dialog (per Spanlens key) */}
      <RateLimitsDialog
        apiKeyId={rateLimitsKey?.id ?? null}
        apiKeyName={rateLimitsKey?.name ?? ''}
        open={rateLimitsKey !== null}
        onClose={() => setRateLimitsKey(null)}
      />

      {/* Add provider key dialog */}
      <Dialog
        open={addProvDialogOpen}
        onOpenChange={(open) => {
          setAddProvDialogOpen(open)
          if (!open) {
            setAddProvApiKeyId('')
            setAddProvError(null)
            setAddProvAdded(null)
          }
        }}
      >
        <DialogContent>
          {addProvAdded ? (
            // ── Success view: show the integration snippet ─────────────────
            <>
              <DialogHeader>
                <DialogTitle>{PROVIDER_LABELS[addProvAdded]} key added</DialogTitle>
              </DialogHeader>
              <DialogDescription className="text-[12.5px] text-text-muted mt-1">
                Drop this into your code to call {PROVIDER_LABELS[addProvAdded]} through
                Spanlens. No CLI re-run needed, your existing{' '}
                <code className="font-mono text-[11px]">SPANLENS_API_KEY</code> already
                covers this provider.
              </DialogDescription>

              <div className="space-y-4 mt-3">
                <div className="rounded-lg border border-border bg-[#1a1816] px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-[#7c7770]">
                      Integration snippet
                    </span>
                    <button
                      type="button"
                      onClick={copyProviderSnippet}
                      className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity flex items-center gap-1"
                    >
                      {snippetCopied ? (
                        <><Check className="h-3 w-3" /> Copied!</>
                      ) : (
                        <><Copy className="h-3 w-3" /> Copy</>
                      )}
                    </button>
                  </div>
                  <pre className="font-mono text-[12px] text-good leading-relaxed whitespace-pre-wrap break-words">
                    {PROVIDER_SNIPPETS[addProvAdded]}
                  </pre>
                </div>

                <p className="font-mono text-[10.5px] text-text-faint">
                  Already running this code? It picks up the new provider on the next
                  request, no redeploy needed.
                </p>

                <PrimaryBtn onClick={() => setAddProvDialogOpen(false)}>
                  Done
                </PrimaryBtn>
              </div>
            </>
          ) : (
            // ── Form view: collect provider + key ──────────────────────────
            <>
              <DialogHeader>
                <DialogTitle>Add provider key</DialogTitle>
              </DialogHeader>
              <DialogDescription className="text-[12.5px] text-text-muted mt-1">
                Register an AI provider key under this Spanlens key. Encrypted with AES-256-GCM.
              </DialogDescription>

              <form
                onSubmit={(e) => { e.preventDefault(); void handleAddProviderKey() }}
                className="space-y-4 mt-2"
              >
                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium">Provider</label>
                  <Select value={addProvProvider} onValueChange={(v) => setAddProvProvider(v as ProviderName)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>{PROVIDER_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {addProvProvider === 'azure' && (
                  <div className="space-y-1.5">
                    <label className="text-[12.5px] text-text-muted font-medium">
                      Azure resource URL
                    </label>
                    <input
                      value={addProvAzureUrl}
                      onChange={(e) => setAddProvAzureUrl(e.target.value)}
                      placeholder="https://my-resource.openai.azure.com"
                      autoComplete="off"
                      className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                    />
                    <p className="text-[10.5px] text-text-faint">
                      Copy from your Azure portal, the endpoint shown on your OpenAI resource overview. Must end in <code>.openai.azure.com</code> or <code>.services.ai.azure.com</code>.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium">
                    {PROVIDER_LABELS[addProvProvider]} API key
                  </label>
                  <input
                    value={addProvKey}
                    onChange={(e) => setAddProvKey(e.target.value)}
                    placeholder={PROVIDER_PLACEHOLDERS[addProvProvider]}
                    type="password"
                    autoComplete="off"
                    className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                  <p className="font-mono text-[10.5px] text-text-faint">
                    Encrypted with AES-256-GCM. Never logged or exposed after this point.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium">Key name</label>
                  <input
                    value={addProvName}
                    onChange={(e) => setAddProvName(e.target.value)}
                    placeholder="e.g. Production OpenAI"
                    className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                </div>

                {addProvError && (
                  <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                    {addProvError}
                  </div>
                )}

                <PrimaryBtn
                  type="submit"
                  disabled={
                    !addProvKey.trim() ||
                    !addProvName.trim() ||
                    (addProvProvider === 'azure' && !addProvAzureUrl.trim()) ||
                    addProviderKey.isPending
                  }
                >
                  {addProviderKey.isPending ? 'Saving…' : 'Add provider key'}
                </PrimaryBtn>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Rotate provider key dialog */}
      <Dialog
        open={rotateProvKeyId !== null}
        onOpenChange={(open) => { if (!open) setRotateProvKeyId(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate provider key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            Replace the AI provider key. Your Spanlens key (
            <code className="font-mono text-[11px]">sl_live_…</code>) stays the same.
          </DialogDescription>

          <form
            onSubmit={(e) => { e.preventDefault(); void handleRotateProviderKey() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">New AI provider key</label>
              <input
                value={rotateProvNew}
                onChange={(e) => setRotateProvNew(e.target.value)}
                placeholder="sk-… / sk-ant-… / AIza…"
                type="password"
                autoComplete="off"
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
            {rotateProvError && (
              <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                {rotateProvError}
              </div>
            )}
            <PrimaryBtn
              type="submit"
              disabled={!rotateProvNew.trim() || rotateProviderKey.isPending}
            >
              {rotateProviderKey.isPending ? 'Updating…' : 'Update key'}
            </PrimaryBtn>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Spanlens key confirm */}
      <Dialog
        open={deleteApiKeyId !== null}
        onOpenChange={(open) => { if (!open) setDeleteApiKeyId(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Spanlens key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            All provider keys under this Spanlens key will also be deleted (CASCADE). Apps using
            this key will stop working immediately.
          </DialogDescription>

          <div className="space-y-4 mt-2">
            <div className="flex gap-3">
              <GhostBtn className="flex-1" onClick={() => setDeleteApiKeyId(null)}>
                Cancel
              </GhostBtn>
              <button
                type="button"
                onClick={() => void handleDeleteApiKey()}
                disabled={deleteApiKey.isPending}
                className="flex-1 h-9 rounded-[6px] bg-bad text-white font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {deleteApiKey.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete provider key confirm */}
      <Dialog
        open={deleteProvKeyId !== null}
        onOpenChange={(open) => { if (!open) setDeleteProvKeyId(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete provider key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            This provider key will be permanently removed. The parent Spanlens
            key will fail when calling this provider until you add a new one.
            Existing request logs stay intact.
          </DialogDescription>

          <div className="space-y-4 mt-2">
            <div className="flex gap-3">
              <GhostBtn className="flex-1" onClick={() => setDeleteProvKeyId(null)}>
                Cancel
              </GhostBtn>
              <button
                type="button"
                onClick={() => void handleDeleteProviderKey()}
                disabled={deleteProviderKey.isPending}
                className="flex-1 h-9 rounded-[6px] bg-bad text-white font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {deleteProviderKey.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete project confirm, requires typing the project name */}
      <Dialog
        open={deleteProject_target !== null}
        onOpenChange={(open) => { if (!open) closeDeleteProjectDialog() }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            This permanently deletes the project and cascades through every
            Spanlens key and provider key under it. Apps using these keys will
            stop working immediately. Historical request logs are preserved
            but the project name will no longer resolve.
          </DialogDescription>

          {deleteProject_target && (
            <form
              onSubmit={(e) => { e.preventDefault(); void handleDeleteProject() }}
              className="space-y-4 mt-3"
            >
              <div className="space-y-1.5">
                <label className="text-[12.5px] text-text-muted">
                  Type{' '}
                  <code className="font-mono text-[12px] bg-bg-elev border border-border px-1.5 py-0.5 rounded-[4px] text-text">
                    {deleteProject_target.name}
                  </code>
                  {' '}to confirm.
                </label>
                <input
                  value={deleteProject_input}
                  onChange={(e) => { setDeleteProject_input(e.target.value); setDeleteProject_error(null) }}
                  placeholder={deleteProject_target.name}
                  autoFocus
                  className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                />
              </div>

              {deleteProject_error && (
                <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                  {deleteProject_error}
                </div>
              )}

              <div className="flex gap-3">
                <GhostBtn type="button" className="flex-1" onClick={closeDeleteProjectDialog}>
                  Cancel
                </GhostBtn>
                <button
                  type="submit"
                  disabled={deleteProject_input !== deleteProject_target.name || deleteProject.isPending}
                  className="flex-1 h-9 rounded-[6px] bg-bad text-white font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {deleteProject.isPending ? 'Deleting…' : 'Delete project'}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
