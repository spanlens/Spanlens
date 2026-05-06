'use client'
import Link from 'next/link'
import { useState } from 'react'
import {
  Plus,
  Copy,
  Terminal,
  Check,
  ExternalLink,
  Pencil,
  Trash2,
  Key as KeyIcon,
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
import { Topbar } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { GhostBtn, PrimaryBtn } from '@/components/ui/primitives'
import { useCreateProject, useProjects } from '@/lib/queries/use-projects'
import {
  useApiKeys,
  useIssueApiKey,
  useToggleApiKey,
  useDeleteApiKey,
} from '@/lib/queries/use-api-keys'
import {
  useProviderKeys,
  useAddProviderKey,
  useRotateProviderKey,
  useDeleteProviderKey,
} from '@/lib/queries/use-provider-keys'
import { cn } from '@/lib/utils'

const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const
type ProviderName = typeof PROVIDERS[number]

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

const PROVIDER_PLACEHOLDERS: Record<ProviderName, string> = {
  openai: 'sk-…',
  anthropic: 'sk-ant-…',
  gemini: 'AIza…',
}

/**
 * Code snippet shown after a provider key is added — the customer pastes
 * this into their app and the call routes through Spanlens automatically.
 * No CLI re-run needed once SPANLENS_API_KEY is in their .env.local.
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
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
// await model.generateContent('...')`,
}

export default function ProjectsPage() {
  const projectsQuery = useProjects()
  const apiKeysQuery = useApiKeys()
  const providerKeysQuery = useProviderKeys() // org-wide list, grouped client-side by api_key_id

  const createProject = useCreateProject()
  const issueApiKey = useIssueApiKey()
  const toggleApiKey = useToggleApiKey()
  const deleteApiKey = useDeleteApiKey()
  const addProviderKey = useAddProviderKey()
  const rotateProviderKey = useRotateProviderKey()
  const deleteProviderKey = useDeleteProviderKey()

  // Banner shown once after a Spanlens key is created
  const [newKey, setNewKey] = useState<string | null>(null)
  const [cmdCopied, setCmdCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  // Create project dialog
  const [projDialogOpen, setProjDialogOpen] = useState(false)
  const [projName, setProjName] = useState('')

  // Add provider key dialog (now scoped to a Spanlens key)
  const [addProvDialogOpen, setAddProvDialogOpen] = useState(false)
  const [addProvApiKeyId, setAddProvApiKeyId] = useState('')
  const [addProvProvider, setAddProvProvider] = useState<ProviderName>('openai')
  const [addProvName, setAddProvName] = useState('')
  const [addProvKey, setAddProvKey] = useState('')
  const [addProvError, setAddProvError] = useState<string | null>(null)
  // After a successful add, show the integration snippet instead of closing.
  const [addProvAdded, setAddProvAdded] = useState<ProviderName | null>(null)
  const [snippetCopied, setSnippetCopied] = useState(false)

  // Issue Spanlens key dialog
  const [issueDialogOpen, setIssueDialogOpen] = useState(false)
  const [issueProjectId, setIssueProjectId] = useState('')
  const [issueName, setIssueName] = useState('')
  const [issueError, setIssueError] = useState<string | null>(null)

  // Rotate provider key dialog
  const [rotateProvKeyId, setRotateProvKeyId] = useState<string | null>(null)
  const [rotateProvNew, setRotateProvNew] = useState('')
  const [rotateProvError, setRotateProvError] = useState<string | null>(null)

  // Delete confirms
  const [deleteApiKeyId, setDeleteApiKeyId] = useState<string | null>(null)
  const [deleteProvKeyId, setDeleteProvKeyId] = useState<string | null>(null)

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
    await createProject.mutateAsync({ name: projName })
    setProjName('')
    setProjDialogOpen(false)
  }

  function openAddProvDialog(apiKeyId: string) {
    setAddProvApiKeyId(apiKeyId)
    setAddProvProvider('openai')
    setAddProvName('')
    setAddProvKey('')
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

  const loading =
    projectsQuery.isLoading ||
    apiKeysQuery.isLoading ||
    providerKeysQuery.isLoading
  const projects = projectsQuery.data ?? []
  const apiKeys = apiKeysQuery.data ?? []
  const providerKeys = providerKeysQuery.data ?? []

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Projects' }]}
        right={
          <PermissionGate need="edit">
            <GhostBtn
              onClick={() => setProjDialogOpen(true)}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px]"
            >
              <Plus className="h-3.5 w-3.5" /> New project
            </GhostBtn>
          </PermissionGate>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-7 py-6 max-w-4xl">
          <div className="mb-6">
            <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px] mb-1">
              Projects & Keys
            </h1>
            <p className="text-[13px] text-text-muted">
              Each Spanlens key holds its own AI provider keys. Expand a key to see and add OpenAI / Anthropic / Gemini keys it can call.
            </p>
          </div>

          {/* New key banner */}
          {newKey && (
            <div className="rounded-xl border border-good/30 bg-good-bg px-5 py-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-medium text-good">
                  Spanlens key created — copy now (won&apos;t be shown again)
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
          ) : (
            <div className="space-y-6">
              {projects.map((proj) => {
                const projApiKeys = apiKeys.filter((k) => k.project_id === proj.id)
                return (
                  <div
                    key={proj.id}
                    className="rounded-xl border border-border bg-bg-elev overflow-hidden"
                  >
                    {/* Project header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg">
                      <div>
                        <h2 className="text-[14px] font-semibold text-text">{proj.name}</h2>
                        <p className="font-mono text-[10.5px] text-text-faint mt-0.5">{proj.id}</p>
                      </div>
                      <PermissionGate need="edit">
                        <PrimaryBtn
                          className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px]"
                          onClick={() => openIssueDialog(proj.id)}
                        >
                          <Plus className="h-3.5 w-3.5" /> New Spanlens key
                        </PrimaryBtn>
                      </PermissionGate>
                    </div>

                    {/* Spanlens key sections — each is a self-contained group:
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
                              {/* Spanlens key header — name + meta + add button + actions */}
                              <div className="flex items-center gap-3 px-6 py-3 bg-bg/30">
                                <KeyIcon className="h-3.5 w-3.5 text-text-faint shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={cn(
                                      'text-[13.5px] font-semibold truncate',
                                      !key.is_active && 'line-through text-text-faint',
                                    )}
                                  >
                                    {key.name}
                                  </div>
                                  <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                                    {key.key_prefix}…
                                    <span suppressHydrationWarning className="ml-2">
                                      {key.last_used_at
                                        ? `· last used ${Math.floor((Date.now() - Date.parse(key.last_used_at)) / 86_400_000)}d ago`
                                        : '· never used'}
                                    </span>
                                  </div>
                                </div>
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

                              {/* Provider keys under this Spanlens key — always visible */}
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
      <Dialog open={projDialogOpen} onOpenChange={setProjDialogOpen}>
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
                onKeyDown={(e) => { if (e.key === 'Enter' && projName.trim()) void handleCreateProject() }}
                placeholder="e.g. Production"
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
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
                Spanlens. No CLI re-run needed — your existing{' '}
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
                  request — no redeploy needed.
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
                  disabled={!addProvKey.trim() || !addProvName.trim() || addProviderKey.isPending}
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

      {/* Deactivate provider key confirm */}
      <Dialog
        open={deleteProvKeyId !== null}
        onOpenChange={(open) => { if (!open) setDeleteProvKeyId(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate provider key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            The Spanlens key will fail when calling this provider until you add a new active key.
            Existing logs are preserved.
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
                {deleteProviderKey.isPending ? 'Deactivating…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
