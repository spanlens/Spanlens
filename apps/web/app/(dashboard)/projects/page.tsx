'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Plus, Copy, Terminal, Check, ExternalLink, Pencil, Trash2 } from 'lucide-react'
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
  useRotateApiKeyAiKey,
  useDeleteApiKey,
} from '@/lib/queries/use-api-keys'
import { cn } from '@/lib/utils'

const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const
type ProviderName = typeof PROVIDERS[number]

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

export default function ProjectsPage() {
  const projectsQuery = useProjects()
  const apiKeysQuery = useApiKeys()
  const createProject = useCreateProject()
  const issueApiKey = useIssueApiKey()
  const toggleApiKey = useToggleApiKey()
  const rotateApiKeyAiKey = useRotateApiKeyAiKey()
  const deleteApiKey = useDeleteApiKey()

  // New key banner
  const [newKey, setNewKey] = useState<{ key: string; provider: string | null } | null>(null)
  const [cmdCopied, setCmdCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  // Create project dialog
  const [projDialogOpen, setProjDialogOpen] = useState(false)
  const [projName, setProjName] = useState('')

  // New Spanlens key dialog
  const [issueDialogOpen, setIssueDialogOpen] = useState(false)
  const [issueProjectId, setIssueProjectId] = useState('')
  const [issueProvider, setIssueProvider] = useState<ProviderName>('openai')
  const [issueName, setIssueName] = useState('')
  const [issueAiKey, setIssueAiKey] = useState('')
  const [issueError, setIssueError] = useState<string | null>(null)

  // Rotate AI key dialog
  const [rotateDialogKeyId, setRotateDialogKeyId] = useState<string | null>(null)
  const [rotateAiKey, setRotateAiKey] = useState('')
  const [rotateError, setRotateError] = useState<string | null>(null)

  // Delete confirm
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null)

  // Track which specific toggle is pending to avoid disabling all toggles
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null)

  function copyWizardCmd() {
    void navigator.clipboard.writeText('npx @spanlens/cli init')
    setCmdCopied(true)
    setTimeout(() => setCmdCopied(false), 1500)
  }

  function copyNewKey() {
    if (!newKey) return
    void navigator.clipboard.writeText(newKey.key)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 1500)
  }

  async function handleCreateProject() {
    await createProject.mutateAsync({ name: projName })
    setProjName('')
    setProjDialogOpen(false)
  }

  function openIssueDialog(projectId: string) {
    setIssueProjectId(projectId)
    setIssueProvider('openai')
    setIssueName('')
    setIssueAiKey('')
    setIssueError(null)
    setIssueDialogOpen(true)
  }

  async function handleIssueApiKey() {
    setIssueError(null)
    try {
      const result = await issueApiKey.mutateAsync({
        provider: issueProvider,
        key: issueAiKey.trim(),
        name: issueName.trim(),
        projectId: issueProjectId,
      })
      setNewKey({ key: result?.key ?? '', provider: result?.provider ?? null })
      setIssueDialogOpen(false)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : 'Failed to issue key')
    }
  }

  function openRotateDialog(keyId: string) {
    setRotateDialogKeyId(keyId)
    setRotateAiKey('')
    setRotateError(null)
  }

  async function handleRotateAiKey() {
    if (!rotateDialogKeyId) return
    setRotateError(null)
    try {
      await rotateApiKeyAiKey.mutateAsync({ id: rotateDialogKeyId, key: rotateAiKey.trim() })
      setRotateDialogKeyId(null)
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : 'Failed to rotate key')
    }
  }

  async function handleDeleteKey() {
    if (!deleteKeyId) return
    await deleteApiKey.mutateAsync(deleteKeyId)
    setDeleteKeyId(null)
  }

  const loading = projectsQuery.isLoading || apiKeysQuery.isLoading
  const projects = projectsQuery.data ?? []
  const apiKeys = apiKeysQuery.data ?? []

  const providerEnvVar = newKey?.provider
    ? { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' }[newKey.provider]
    : 'SPANLENS_API_KEY'

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden">
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
            <p className="text-[13px] text-text-muted">Manage your projects and Spanlens API keys</p>
          </div>

          {/* New key banner */}
          {newKey && (
            <div className="rounded-xl border border-good/30 bg-good-bg px-5 py-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-medium text-good">
                  Key created — copy now (won&apos;t be shown again)
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
                    {providerEnvVar}
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
                  {newKey.key}
                </code>
              </div>

              <div className="rounded-lg border border-good/20 bg-[#1a1816] px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="h-3.5 w-3.5 text-[#7c7770]" />
                  <span className="font-mono text-[10.5px] text-[#7c7770] uppercase tracking-[0.05em]">
                    Integrate in your project
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
                  Paste your key when asked. ~30 seconds.{' '}
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

          {/* Loading */}
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
            <div className="space-y-4">
              {projects.map((proj) => {
                const keys = apiKeys.filter((k) => k.project_id === proj.id)
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
                          className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[30px]"
                          onClick={() => openIssueDialog(proj.id)}
                        >
                          <Plus className="h-3.5 w-3.5" /> New Spanlens key
                        </PrimaryBtn>
                      </PermissionGate>
                    </div>

                    {/* Key list */}
                    {keys.length === 0 ? (
                      <p className="px-6 py-5 text-[13px] text-text-faint">
                        No keys yet. Create your first Spanlens key to start.
                      </p>
                    ) : (
                      <div className="divide-y divide-border">
                        {/* Column headers */}
                        <div className="grid grid-cols-[1fr_100px_120px_80px] gap-4 px-6 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                          <span>Name</span>
                          <span>Provider</span>
                          <span>Last used</span>
                          <span />
                        </div>
                        {keys.map((key) => (
                          <div
                            key={key.id}
                            className="grid grid-cols-[1fr_100px_120px_80px] gap-4 px-6 py-3 items-center"
                          >
                            {/* Name */}
                            <span
                              className={cn(
                                'text-[13px] font-medium truncate',
                                !key.is_active && 'line-through text-text-faint',
                              )}
                            >
                              {key.name}
                            </span>

                            {/* Provider badge */}
                            {key.provider ? (
                              <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-border text-text-muted w-fit">
                                {key.provider}
                              </span>
                            ) : (
                              <span className="font-mono text-[11px] text-text-faint">—</span>
                            )}

                            {/* Last used */}
                            <span className="font-mono text-[11px] text-text-muted">
                              {key.last_used_at
                                ? `${Math.floor((Date.now() - Date.parse(key.last_used_at)) / 86_400_000)}d ago`
                                : 'Never'}
                            </span>

                            {/* Actions */}
                            <div className="flex items-center gap-1 justify-end">
                              {/* Active toggle */}
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
                                      'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                                      key.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]',
                                    )}
                                  />
                                </button>
                              </PermissionGate>

                              {/* Edit AI key — only for linked keys */}
                              {key.provider_key_id && (
                                <PermissionGate need="edit">
                                  <button
                                    type="button"
                                    onClick={() => openRotateDialog(key.id)}
                                    title="Update AI provider key"
                                    className="p-1.5 rounded hover:bg-bg text-text-faint hover:text-text transition-colors"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                </PermissionGate>
                              )}

                              {/* Delete */}
                              <PermissionGate need="edit">
                                <button
                                  type="button"
                                  onClick={() => setDeleteKeyId(key.id)}
                                  title="Delete key"
                                  className="p-1.5 rounded hover:bg-bad/10 text-text-faint hover:text-bad transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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

      {/* New Spanlens key dialog */}
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
            Enter your AI provider key. We store it encrypted and issue a{' '}
            <code className="font-mono bg-bg-elev border border-border px-1 rounded text-[11px]">sl_live_…</code>{' '}
            key as a drop-in replacement.
          </DialogDescription>

          <form
            onSubmit={(e) => { e.preventDefault(); void handleIssueApiKey() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Provider</label>
              <Select value={issueProvider} onValueChange={(v) => setIssueProvider(v as ProviderName)}>
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
                {PROVIDER_LABELS[issueProvider]} API key
              </label>
              <input
                value={issueAiKey}
                onChange={(e) => setIssueAiKey(e.target.value)}
                placeholder="sk-… / sk-ant-… / AIza…"
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
                value={issueName}
                onChange={(e) => setIssueName(e.target.value)}
                placeholder="e.g. Production OpenAI"
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
              disabled={!issueAiKey.trim() || !issueName.trim() || issueApiKey.isPending}
            >
              {issueApiKey.isPending ? 'Creating…' : 'Create key'}
            </PrimaryBtn>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rotate AI key dialog */}
      <Dialog
        open={rotateDialogKeyId !== null}
        onOpenChange={(open) => { if (!open) setRotateDialogKeyId(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update AI provider key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            Enter the new AI provider key. Your Spanlens key (<code className="font-mono text-[11px]">sl_live_…</code>) stays the same.
          </DialogDescription>

          <form
            onSubmit={(e) => { e.preventDefault(); void handleRotateAiKey() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">New AI provider key</label>
              <input
                value={rotateAiKey}
                onChange={(e) => setRotateAiKey(e.target.value)}
                placeholder="sk-… / sk-ant-… / AIza…"
                type="password"
                autoComplete="off"
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
            {rotateError && (
              <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                {rotateError}
              </div>
            )}
            <PrimaryBtn
              type="submit"
              disabled={!rotateAiKey.trim() || rotateApiKeyAiKey.isPending}
            >
              {rotateApiKeyAiKey.isPending ? 'Updating…' : 'Update key'}
            </PrimaryBtn>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteKeyId !== null}
        onOpenChange={(open) => { if (!open) setDeleteKeyId(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete key</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px] text-text-muted mt-1">
            This will permanently delete the Spanlens key and its linked AI provider key. Any apps using this key will stop working immediately.
          </DialogDescription>

          <div className="space-y-4 mt-2">
            <div className="flex gap-3">
              <GhostBtn
                className="flex-1"
                onClick={() => setDeleteKeyId(null)}
              >
                Cancel
              </GhostBtn>
              <button
                type="button"
                onClick={() => void handleDeleteKey()}
                disabled={deleteApiKey.isPending}
                className="flex-1 h-9 rounded-[6px] bg-bad text-white font-medium text-[13px] hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {deleteApiKey.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
