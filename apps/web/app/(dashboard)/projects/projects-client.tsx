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
import { cn, formatDate } from '@/lib/utils'
import { classifyStaleness, formatLastUsed } from '@/lib/api-key-staleness'
import { StaleBadge } from '@/components/ui/stale-badge'
import type { ApiKey, ProviderKey } from '@/lib/queries/types'
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
  baseURL: 'https://api.spanlens.io/proxy/azure',
  apiKey: process.env.SPANLENS_API_KEY,
})
// await azure.chat.completions.create({ model: 'gpt-4o', messages: [...] })`,
  mistral: `import OpenAI from 'openai'

// Mistral exposes an OpenAI-compatible API — point the OpenAI SDK at the
// Spanlens proxy and use any Mistral model id.
const mistral = new OpenAI({
  baseURL: 'https://api.spanlens.io/proxy/mistral/v1',
  apiKey: process.env.SPANLENS_API_KEY,
})
// await mistral.chat.completions.create({ model: 'mistral-large-latest', messages: [...] })`,
  openrouter: `import OpenAI from 'openai'

// OpenRouter is OpenAI-compatible and gives you 100+ models behind one key.
// Use the vendor-prefixed model id (e.g. 'openai/gpt-4o', 'anthropic/claude-sonnet-4').
const openrouter = new OpenAI({
  baseURL: 'https://api.spanlens.io/proxy/openrouter/v1',
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

// ── Shared surface classes ───────────────────────────────────────────────────
// Repeated verbatim across three tables; kept as constants so the row and head
// grids can never drift out of alignment.
const PILL_SECONDARY =
  'rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors disabled:opacity-40'
const PILL_ACCENT =
  'rounded-full bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg hover:bg-accent-strong transition-colors disabled:opacity-40'
const PILL_DESTRUCTIVE =
  'rounded-full border border-accent-border bg-accent-bg px-3.5 py-2 text-[12px] font-medium text-accent hover:bg-accent-bg/70 transition-colors disabled:opacity-40'
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

/**
 * Status pill copy for a provider key. `mounted` gates the staleness read
 * because it compares against `Date.now()` — before mount we render the
 * server-safe "active" so SSR and the hydration pass agree.
 */
function providerKeyStatus(
  pk: ProviderKey,
  mounted: boolean,
): { label: string; className: string } {
  if (!pk.is_active) return { label: 'inactive', className: 'bg-bg-chip text-text-muted' }
  if (!mounted) return { label: 'active', className: 'bg-good-bg text-good' }
  const { bucket } = classifyStaleness({
    lastUsedAt: pk.last_used_at ?? null,
    createdAt: pk.created_at,
  })
  if (bucket === 'stale' || bucket === 'consider_revoking') {
    return { label: 'stale', className: 'bg-warn-bg text-warn' }
  }
  return { label: 'active', className: 'bg-good-bg text-good' }
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
  // Memoised because the `?? []` fallback would otherwise hand a fresh array to
  // the key-table useMemos below on every render, defeating them.
  const publicKeys = useMemo(() => publicKeysQuery.data ?? [], [publicKeysQuery.data])

  // Rotate provider key dialog
  const [rotateProvKeyId, setRotateProvKeyId] = useState<string | null>(null)
  const [rotateProvNew, setRotateProvNew] = useState('')
  const [rotateProvError, setRotateProvError] = useState<string | null>(null)

  // Delete confirms
  const [deleteApiKeyId, setDeleteApiKeyId] = useState<string | null>(null)
  const [deleteApiKeyError, setDeleteApiKeyError] = useState<string | null>(null)
  const [deleteProvKeyId, setDeleteProvKeyId] = useState<string | null>(null)
  const [deleteProvKeyError, setDeleteProvKeyError] = useState<string | null>(null)
  // Public-key revoke confirm — mirrors the Spanlens-key delete flow so a
  // single misclick can't revoke a workspace credential. Separate state from
  // deleteApiKeyId because the two dialogs describe different consequences.
  const [revokePublicKeyId, setRevokePublicKeyId] = useState<string | null>(null)
  const [revokePublicError, setRevokePublicError] = useState<string | null>(null)
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
    setDeleteApiKeyError(null)
    try {
      await deleteApiKey.mutateAsync(deleteApiKeyId)
      setDeleteApiKeyId(null)
    } catch (err) {
      setDeleteApiKeyError(err instanceof Error ? err.message : 'Failed to delete key')
    }
  }

  async function handleRevokePublicKey() {
    if (!revokePublicKeyId) return
    setRevokePublicError(null)
    try {
      await deleteApiKey.mutateAsync(revokePublicKeyId)
      setRevokePublicKeyId(null)
    } catch (err) {
      setRevokePublicError(err instanceof Error ? err.message : 'Failed to revoke key')
    }
  }

  async function handleDeleteProviderKey() {
    if (!deleteProvKeyId) return
    setDeleteProvKeyError(null)
    try {
      await deleteProviderKey.mutateAsync(deleteProvKeyId)
      setDeleteProvKeyId(null)
    } catch (err) {
      setDeleteProvKeyError(err instanceof Error ? err.message : 'Failed to delete key')
    }
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

  // Public keys have their own query (workspace scope) but now share the
  // Spanlens-keys table with the project-scoped full keys, told apart by the
  // SCOPE pill. De-dupe by id in case /api/v1/api-keys already returned the
  // workspace rows too.
  const fullApiKeys = useMemo(() => allApiKeys.filter((k) => k.scope !== 'public'), [allApiKeys])
  const allKeys = useMemo<ApiKey[]>(() => {
    const seen = new Set(fullApiKeys.map((k) => k.id))
    return [...fullApiKeys, ...publicKeys.filter((k) => !seen.has(k.id))]
  }, [fullApiKeys, publicKeys])

  // Rows for the Spanlens-keys table: the search-narrowed project keys plus
  // public keys matched on their own name (they have no project to narrow by).
  const keyRows = useMemo<ApiKey[]>(() => {
    const visiblePublic = search
      ? publicKeys.filter((k) => k.name.toLowerCase().includes(search.toLowerCase()))
      : publicKeys
    const seen = new Set(apiKeys.map((k) => k.id))
    return [...apiKeys, ...visiblePublic.filter((k) => !seen.has(k.id))]
  }, [apiKeys, publicKeys, search])

  const projectNameById = useMemo(
    () => new Map(allProjects.map((p) => [p.id, p.name])),
    [allProjects],
  )
  const keyNameById = useMemo(
    () => new Map(allKeys.map((k) => [k.id, k.name])),
    [allKeys],
  )

  // Stat row totals — always from the unfiltered lists so the row is a
  // consistent overview, not a reflection of the current search. Anything
  // derived from `Date.now()` is read behind the `mounted` gate at render.
  const staleKeyCount = useMemo(() => {
    if (!mounted) return 0
    return allKeys.filter((k) => {
      const { bucket } = classifyStaleness({ lastUsedAt: k.last_used_at, createdAt: k.created_at })
      return bucket === 'stale' || bucket === 'consider_revoking'
    }).length
  }, [allKeys, mounted])

  const statCards = useMemo(() => {
    const providerCount = new Set(allProviderKeys.map((pk) => pk.provider)).size
    const publicCount = allKeys.filter((k) => k.scope === 'public').length
    const projectNames = allProjects.slice(0, 3).map((p) => p.name).join(', ')
    return [
      {
        label: 'Projects',
        value: String(allProjects.length),
        note: projectNames || 'none yet',
        tone: 'text-text-faint',
      },
      {
        label: 'Spanlens keys',
        value: String(allKeys.length),
        note: `${publicCount} public, ${allKeys.length - publicCount} full`,
        tone: 'text-text-faint',
      },
      {
        label: 'Provider keys',
        value: String(allProviderKeys.length),
        note: `across ${providerCount} provider${providerCount === 1 ? '' : 's'}`,
        tone: 'text-text-faint',
      },
      {
        label: 'Stale keys',
        value: String(staleKeyCount),
        note: staleKeyCount > 0 ? 'no traffic in 30 days' : 'all keys used recently',
        tone: staleKeyCount > 0 ? 'text-accent' : 'text-text-faint',
      },
    ]
  }, [allProjects, allKeys, allProviderKeys, staleKeyCount])

  function refreshAll() {
    void projectsQuery.refetch()
    void apiKeysQuery.refetch()
    void providerKeysQuery.refetch()
  }

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[{ label: 'Projects & Keys' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={mounted && isFetching} />
              <button
                type="button"
                onClick={refreshAll}
                disabled={mounted && isFetching}
                title="Refresh now"
                aria-label="Refresh now"
                className="rounded-md border border-border bg-bg-elev px-2.5 py-1.5 font-mono text-[11px] text-text-muted hover:text-text transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', mounted && isFetching && 'animate-spin')}>↻</span>
              </button>
              <PermissionGate need="edit">
                <button
                  type="button"
                  onClick={() => setProjDialogOpen(true)}
                  title="New project"
                  aria-label="New project"
                  className={cn(PILL_ACCENT, 'flex items-center gap-1.5 whitespace-nowrap shrink-0')}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">New project</span>
                </button>
              </PermissionGate>
            </div>
          }
        />
      </div>

      <div className="pt-4 md:pt-5 space-y-4">
        {/* The breadcrumb carries the visible page title, so the document
            heading is screen-reader only. */}
        <h1 className="sr-only">Projects &amp; Keys</h1>

        {/* New key banner — surfaces freshly minted keys (full OR public) at
            the very top of the canvas. The user just clicked "Create", so the
            plaintext value should be the first thing they see. */}
        {newKey && (
          <div className="rounded-card border border-good/30 bg-good-bg px-5 py-[18px]">
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

            <div className="rounded-lg border border-good/20 bg-bg-sunk px-4 py-3 mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
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

            <div className="rounded-lg border border-good/20 bg-bg-sunk px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="h-3.5 w-3.5 text-text-faint" />
                <span className="font-mono text-[10.5px] text-text-faint uppercase tracking-[0.1em]">
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
              <p className="font-mono text-[10.5px] text-text-faint">
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

        {/* Stat row — always over the unfiltered lists so it reads as a
            workspace overview, not a reflection of the current search. */}
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
                {mounted ? s.value : ' '}
              </div>
              <div className={cn('text-[11.5px] font-medium mt-[7px] truncate', s.tone)}>
                {mounted ? s.note : ' '}
              </div>
            </div>
          ))}
        </div>

        {/* Search — URL-backed, matches project, Spanlens key, and provider
            key names. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
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
              className="w-full rounded-md border border-border bg-bg-elev pl-9 pr-3 py-2 text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          {search && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
              className={PILL_SECONDARY}
            >
              Clear
            </button>
          )}
          <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">
            {mounted
              ? (projects.length === allProjects.length
                ? `${allProjects.length} projects`
                : `${projects.length} of ${allProjects.length}`)
              : ' '}
          </span>
        </div>

        {/* Integration hint */}
        {!newKey && allProjects.length > 0 && (
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
        )}

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className={cn(TABLE_CARD, 'p-5 space-y-3')}>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        ) : listError ? (
          <div className={cn(TABLE_CARD, 'px-6 py-10 text-center')}>
            <h2 className="text-[13.5px] font-semibold text-text mb-1.5">Couldn&apos;t load projects</h2>
            <p className="text-[12.5px] text-text-muted max-w-md mx-auto mb-4">
              We couldn&apos;t reach the server just now. Your projects and keys are safe.
            </p>
            <button type="button" onClick={refreshAll} className={PILL_SECONDARY}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* ── Projects ─────────────────────────────────────────────────
                Not in the Figma board, but project create / delete and the
                per-project "New Spanlens key" flow have to live somewhere
                now that the key list is flat. Same table language as the
                two boards below. */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={SECTION_EYEBROW}>Projects</span>
              </div>
              {allProjects.length === 0 ? (
                <div className={cn(TABLE_CARD, 'px-6 py-10 text-center')}>
                  <h2 className="text-[13.5px] font-semibold text-text mb-1.5">No projects yet</h2>
                  <p className="text-[12.5px] text-text-muted max-w-md mx-auto mb-4">
                    Create a project to start grouping Spanlens keys and the provider keys they call.
                  </p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <PermissionGate need="edit">
                      <button
                        type="button"
                        onClick={() => setProjDialogOpen(true)}
                        className={cn(PILL_ACCENT, 'inline-flex items-center gap-1.5')}
                      >
                        <Plus className="h-3.5 w-3.5" /> Create first project
                      </button>
                    </PermissionGate>
                    <Link href="/docs/features/projects" className={PILL_SECONDARY}>
                      How projects work →
                    </Link>
                  </div>
                </div>
              ) : projects.length === 0 ? (
                <div className={cn(TABLE_CARD, 'px-6 py-10 text-center')}>
                  <p className="text-[12.5px] text-text-muted mb-3">No projects match the current search.</p>
                  <button
                    type="button"
                    onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                    className={PILL_SECONDARY}
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className={TABLE_CARD}>
                  <div className="overflow-x-auto">
                    <div className="min-w-[840px]">
                      <div className={cn(PROJECT_COLS, 'bg-bg-muted border-b border-border px-[18px] py-2.5')}>
                        <span className={TABLE_HEAD_CELL}>Project</span>
                        <span className={TABLE_HEAD_CELL}>Project ID</span>
                        <span className={TABLE_HEAD_CELL}>Spanlens keys</span>
                        <span className={cn(TABLE_HEAD_CELL, 'text-right')}>Actions</span>
                      </div>
                      {projects.map((proj) => {
                        const projKeyCount = apiKeys.filter((k) => k.project_id === proj.id).length
                        return (
                          <div
                            key={proj.id}
                            className={cn(
                              PROJECT_COLS,
                              'group items-center px-[18px] py-3 border-b border-border last:border-b-0',
                            )}
                          >
                            <span className="font-mono text-[12px] text-text truncate" title={proj.name}>
                              {proj.name}
                            </span>
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="font-mono text-[12px] text-text-muted truncate">{proj.id}</span>
                              <CopyIdButton value={proj.id} label="Copy project ID" />
                            </span>
                            <span className="font-mono text-[12px] text-text-muted tabular-nums">
                              {projKeyCount}
                            </span>
                            <span className="flex items-center justify-end gap-2">
                              <PermissionGate need="edit">
                                <button
                                  type="button"
                                  className={cn(PILL_SECONDARY, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                                  onClick={() => openIssueDialog(proj.id)}
                                  title="New Spanlens key"
                                  aria-label="New Spanlens key"
                                >
                                  <Plus className="h-3.5 w-3.5" /> New key
                                </button>
                              </PermissionGate>
                              <PermissionGate need="edit">
                                <button
                                  type="button"
                                  onClick={() => openDeleteProjectDialog(proj.id, proj.name)}
                                  title="Delete project"
                                  aria-label="Delete project"
                                  className={cn(PILL_DESTRUCTIVE, 'inline-flex items-center gap-1.5')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Delete
                                </button>
                              </PermissionGate>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── Spanlens keys ────────────────────────────────────────────
                Full (project-scoped) and public (workspace-scoped) keys share
                one table, told apart by the SCOPE pill, exactly as in the
                Figma board. */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className={SECTION_EYEBROW}>Spanlens keys</span>
                  <p className="text-[11.5px] text-text-faint mt-1">
                    Public keys are read-only credentials safe for MCP servers, BI tools, and embeds. They cannot make LLM calls or ingest traces.
                  </p>
                </div>
                <PermissionGate need="edit">
                  <button
                    type="button"
                    onClick={openIssuePublicDialog}
                    className={cn(PILL_SECONDARY, 'inline-flex items-center gap-1.5 shrink-0')}
                  >
                    <Plus className="h-3.5 w-3.5" /> New public key
                  </button>
                </PermissionGate>
              </div>

              {keyRows.length === 0 ? (
                <div className={cn(TABLE_CARD, 'px-6 py-8 text-center text-[12.5px] text-text-muted')}>
                  {search
                    ? 'No Spanlens keys match the current search.'
                    : 'No Spanlens keys yet. Create one on a project to start.'}
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
                      {keyRows.map((key) => {
                        const isPublic = key.scope === 'public'
                        return (
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
                                  'flex items-center gap-2 font-mono text-[12px] text-text',
                                  !key.is_active && 'line-through text-text-faint',
                                )}
                              >
                                <span className="truncate">{key.name}</span>
                                {/* Stale indicator only after client mount — it is
                                    computed against `Date.now()`. */}
                                {mounted && key.is_active && (
                                  <StaleBadge lastUsedAt={key.last_used_at} createdAt={key.created_at} />
                                )}
                              </span>
                              <span className="block font-mono text-[10.5px] text-text-faint mt-0.5 truncate">
                                {key.key_prefix}…
                              </span>
                            </span>
                            <span
                              className={cn(
                                STATUS_PILL,
                                isPublic ? 'bg-accent-bg text-accent' : 'bg-bg-chip text-text-muted',
                              )}
                            >
                              {key.scope}
                            </span>
                            <span className="font-mono text-[12px] text-text-muted truncate">
                              {isPublic ? 'workspace wide' : (projectNameById.get(key.project_id ?? '') ?? '—')}
                            </span>
                            <span className="font-mono text-[12px] text-text-muted whitespace-nowrap">
                              {formatDate(key.created_at)}
                            </span>
                            <span className="font-mono text-[12px] text-text-muted truncate">
                              {mounted
                                ? formatLastUsed({ lastUsedAt: key.last_used_at, createdAt: key.created_at })
                                : '…'}
                            </span>
                            <span className="flex items-center justify-end gap-2">
                              {!isPublic && (
                                <>
                                  <button
                                    type="button"
                                    className={cn(PILL_SECONDARY, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                                    onClick={() => setRateLimitsKey({ id: key.id, name: key.name })}
                                    title="Configure rate limits for this key"
                                  >
                                    <Gauge className="h-3.5 w-3.5" /> Rate limits
                                  </button>
                                  <PermissionGate need="edit">
                                    <button
                                      type="button"
                                      className={cn(PILL_SECONDARY, 'inline-flex items-center gap-1.5 whitespace-nowrap')}
                                      onClick={() => openAddProvDialog(key.id)}
                                    >
                                      <Plus className="h-3.5 w-3.5" /> Provider key
                                    </button>
                                  </PermissionGate>
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
                                        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
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
                                  </PermissionGate>
                                </>
                              )}
                              <PermissionGate need="edit">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isPublic) {
                                      setRevokePublicError(null)
                                      setRevokePublicKeyId(key.id)
                                    } else {
                                      setDeleteApiKeyId(key.id)
                                    }
                                  }}
                                  title={isPublic ? 'Revoke public key' : 'Delete Spanlens key'}
                                  aria-label={isPublic ? 'Revoke public key' : 'Delete Spanlens key'}
                                  className={cn(PILL_DESTRUCTIVE, 'whitespace-nowrap')}
                                >
                                  {isPublic ? 'Revoke' : 'Delete'}
                                </button>
                              </PermissionGate>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── Provider keys ────────────────────────────────────────────
                Flat list across the workspace, each row naming the Spanlens
                key it is nested under. */}
            <section className="space-y-2">
              <span className={SECTION_EYEBROW}>Provider keys</span>
              {providerKeys.length === 0 ? (
                <div className={cn(TABLE_CARD, 'px-6 py-8 text-center text-[12.5px] text-text-muted')}>
                  {search
                    ? 'No provider keys match the current search.'
                    : 'No provider keys yet. Add OpenAI / Anthropic / Gemini under a Spanlens key to enable calls through it.'}
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
                      {providerKeys.map((pk) => {
                        const status = providerKeyStatus(pk, mounted)
                        return (
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
                              title={pk.name}
                            >
                              {pk.name}
                            </span>
                            <span className="font-mono text-[12px] text-text-muted truncate">
                              {keyNameById.get(pk.api_key_id) ?? '—'}
                            </span>
                            <span className="font-mono text-[12px] text-text-muted whitespace-nowrap">
                              {formatDate(pk.created_at)}
                            </span>
                            <span className="font-mono text-[12px] text-text-muted truncate">
                              {mounted
                                ? formatLastUsed({ lastUsedAt: pk.last_used_at ?? null, createdAt: pk.created_at })
                                : '…'}
                            </span>
                            <span className={cn(STATUS_PILL, status.className)}>{status.label}</span>
                            <span className="flex items-center justify-end gap-2">
                              <PermissionGate need="edit">
                                <button
                                  type="button"
                                  onClick={() => openRotateProvDialog(pk.id)}
                                  title="Rotate provider key"
                                  aria-label="Rotate provider key"
                                  className={cn(PILL_SECONDARY, 'inline-flex items-center gap-1.5')}
                                >
                                  <Pencil className="h-3 w-3" /> Rotate
                                </button>
                              </PermissionGate>
                              <PermissionGate need="edit">
                                <button
                                  type="button"
                                  onClick={() => setDeleteProvKeyId(pk.id)}
                                  title="Delete provider key"
                                  aria-label="Delete provider key"
                                  className={cn(PILL_DESTRUCTIVE, 'whitespace-nowrap')}
                                >
                                  Delete
                                </button>
                              </PermissionGate>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
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
                className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
            {projError && (
              <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
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
            <code className="font-mono bg-bg-sunk border border-border px-1 rounded text-[11px]">sl_live_…</code>{' '}
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
                className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>

            {issueError && (
              <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
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
            <code className="font-mono bg-bg-sunk border border-border px-1 rounded text-[11px]">
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
                className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>

            {issuePublicError && (
              <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
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
                <div className="rounded-lg border border-border bg-bg-sunk px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-text-faint">
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
                      className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
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
                    className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
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
                    className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                </div>

                {addProvError && (
                  <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
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
                className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
            {rotateProvError && (
              <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
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
        onOpenChange={(open) => { if (!open) { setDeleteApiKeyId(null); setDeleteApiKeyError(null) } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Spanlens key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            This permanently deletes the key right away and cannot be undone. All
            provider keys under this Spanlens key are deleted with it, and apps
            using this key stop working immediately.
          </DialogDescription>

          <div className="space-y-4 mt-2">
            {deleteApiKeyError && (
              <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
                {deleteApiKeyError}
              </div>
            )}
            <div className="flex gap-3">
              <GhostBtn className="flex-1" onClick={() => { setDeleteApiKeyId(null); setDeleteApiKeyError(null) }}>
                Cancel
              </GhostBtn>
              <button
                type="button"
                onClick={() => void handleDeleteApiKey()}
                disabled={deleteApiKey.isPending}
                className="flex-1 h-9 rounded-md bg-bad text-bg font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {deleteApiKey.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke public key confirm */}
      <Dialog
        open={revokePublicKeyId !== null}
        onOpenChange={(open) => { if (!open) { setRevokePublicKeyId(null); setRevokePublicError(null) } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke public key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            This permanently revokes the public key. Any MCP server, BI tool, or
            embed using it will stop reading your workspace data immediately.
          </DialogDescription>

          <div className="space-y-4 mt-2">
            {revokePublicError && (
              <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
                {revokePublicError}
              </div>
            )}
            <div className="flex gap-3">
              <GhostBtn className="flex-1" onClick={() => { setRevokePublicKeyId(null); setRevokePublicError(null) }}>
                Cancel
              </GhostBtn>
              <button
                type="button"
                onClick={() => void handleRevokePublicKey()}
                disabled={deleteApiKey.isPending}
                className="flex-1 h-9 rounded-md bg-bad text-bg font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {deleteApiKey.isPending ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete provider key confirm */}
      <Dialog
        open={deleteProvKeyId !== null}
        onOpenChange={(open) => { if (!open) { setDeleteProvKeyId(null); setDeleteProvKeyError(null) } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete provider key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            This provider key is permanently removed right away and cannot be
            undone. The parent Spanlens key will fail when calling this provider
            until you add a new one. Existing request logs stay intact.
          </DialogDescription>

          <div className="space-y-4 mt-2">
            {deleteProvKeyError && (
              <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
                {deleteProvKeyError}
              </div>
            )}
            <div className="flex gap-3">
              <GhostBtn className="flex-1" onClick={() => { setDeleteProvKeyId(null); setDeleteProvKeyError(null) }}>
                Cancel
              </GhostBtn>
              <button
                type="button"
                onClick={() => void handleDeleteProviderKey()}
                disabled={deleteProviderKey.isPending}
                className="flex-1 h-9 rounded-md bg-bad text-bg font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
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
                  <code className="font-mono text-[12px] bg-bg-sunk border border-border px-1.5 py-0.5 rounded-[4px] text-text">
                    {deleteProject_target.name}
                  </code>
                  {' '}to confirm.
                </label>
                <input
                  value={deleteProject_input}
                  onChange={(e) => { setDeleteProject_input(e.target.value); setDeleteProject_error(null) }}
                  placeholder={deleteProject_target.name}
                  autoFocus
                  className="w-full h-9 px-3 rounded-md border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                />
              </div>

              {deleteProject_error && (
                <div className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] text-bad">
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
                  className="flex-1 h-9 rounded-md bg-bad text-bg font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {deleteProject.isPending ? 'Deleting…' : 'Delete project'}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
