'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Plus, Trash2, Copy, Terminal, Check, ExternalLink } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/queries/use-api-keys'
import {
  useProviderKeys,
  useCreateProviderKey,
  useRevokeProviderKey,
} from '@/lib/queries/use-provider-keys'
import { cn } from '@/lib/utils'

const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const
type ProviderName = typeof PROVIDERS[number]

export default function ProjectsPage() {
  const projectsQuery = useProjects()
  const apiKeysQuery = useApiKeys()
  const providerKeysQuery = useProviderKeys()
  const createProject = useCreateProject()
  const createApiKey = useCreateApiKey()
  const revokeApiKey = useRevokeApiKey()
  const createProviderKey = useCreateProviderKey()
  const revokeProviderKey = useRevokeProviderKey()

  const [newKey, setNewKey] = useState<string | null>(null)
  const [cmdCopied, setCmdCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  const [projDialogOpen, setProjDialogOpen] = useState(false)
  const [projName, setProjName] = useState('')

  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyProjectId, setKeyProjectId] = useState('')

  // Provider key override dialog state
  const [pkDialogOpen, setPkDialogOpen] = useState(false)
  const [pkProjectId, setPkProjectId] = useState('')
  const [pkProvider, setPkProvider] = useState<ProviderName>('openai')
  const [pkName, setPkName] = useState('')
  const [pkKey, setPkKey] = useState('')
  const [pkError, setPkError] = useState<string | null>(null)

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

  async function handleCreateApiKey() {
    const key = await createApiKey.mutateAsync({ name: keyName, projectId: keyProjectId })
    setNewKey(key.key)
    setKeyName('')
    setKeyDialogOpen(false)
  }

  function openProviderKeyDialog(projectId: string) {
    setPkProjectId(projectId)
    setPkProvider('openai')
    setPkName('')
    setPkKey('')
    setPkError(null)
    setPkDialogOpen(true)
  }

  async function handleCreateProviderKey() {
    setPkError(null)
    try {
      await createProviderKey.mutateAsync({
        provider: pkProvider,
        key: pkKey.trim(),
        name: pkName.trim() || `${pkProvider} override`,
        project_id: pkProjectId,
      })
      setPkDialogOpen(false)
    } catch (err) {
      setPkError(err instanceof Error ? err.message : 'Failed to save provider key')
    }
  }

  const loading = projectsQuery.isLoading || apiKeysQuery.isLoading
  const projects = projectsQuery.data ?? []
  const apiKeys = apiKeysQuery.data ?? []
  const providerKeys = providerKeysQuery.data ?? []
  const orgDefaults = providerKeys.filter((k) => k.project_id === null && k.is_active)

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
              Projects & API Keys
            </h1>
            <p className="text-[13px] text-text-muted">Manage your projects and access keys</p>
          </div>

          {/* New key banner */}
          {newKey && (
            <div className="rounded-xl border border-good/30 bg-good-bg px-5 py-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-medium text-good">
                  API key created — copy now (won&apos;t be shown again)
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
                  Paste your API key when asked. ~30 seconds.{' '}
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
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg">
                      <div>
                        <h2 className="text-[14px] font-semibold text-text">{proj.name}</h2>
                        <p className="font-mono text-[10.5px] text-text-faint mt-0.5">{proj.id}</p>
                      </div>
                      <PermissionGate need="edit">
                        <GhostBtn
                          className="flex items-center gap-1.5 text-[12px] px-3 py-[5px]"
                          onClick={() => {
                            setKeyProjectId(proj.id)
                            setKeyDialogOpen(true)
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" /> New API key
                        </GhostBtn>
                      </PermissionGate>
                    </div>

                    <div>
                      {keys.length === 0 ? (
                        <p className="px-6 py-4 text-[13px] text-text-faint">No API keys yet.</p>
                      ) : (
                        <div className="divide-y divide-border">
                          {keys.map((key) => (
                            <div
                              key={key.id}
                              className="flex items-center justify-between px-6 py-3"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <code className="font-mono text-[12px] text-text-faint shrink-0">
                                  {key.key_prefix}••••••••
                                </code>
                                <span
                                  className={cn(
                                    'text-[13px] font-medium truncate',
                                    !key.is_active && 'line-through text-text-faint',
                                  )}
                                >
                                  {key.name}
                                </span>
                                {!key.is_active && (
                                  <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-text-faint border border-border px-1.5 py-0.5 rounded-full shrink-0">
                                    Revoked
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0 ml-4">
                                <span className="text-[12px] text-text-faint">
                                  {key.last_used_at
                                    ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                                    : 'Never used'}
                                </span>
                                {key.is_active && (
                                  <PermissionGate need="edit">
                                    <button
                                      type="button"
                                      onClick={() => void revokeApiKey.mutateAsync(key.id)}
                                      disabled={revokeApiKey.isPending}
                                      className="p-1.5 rounded hover:bg-accent-bg text-text-faint hover:text-accent transition-colors disabled:opacity-40"
                                      aria-label="Revoke key"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </PermissionGate>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Provider keys section */}
                    <div className="border-t border-border">
                      <div className="flex items-center justify-between px-6 py-3 bg-bg">
                        <div>
                          <h3 className="text-[12.5px] font-semibold text-text-muted uppercase tracking-[0.04em]">
                            Provider keys
                          </h3>
                          <p className="text-[11.5px] text-text-faint mt-0.5">
                            Overrides the workspace default for this project only
                          </p>
                        </div>
                        <PermissionGate need="edit">
                          <GhostBtn
                            className="flex items-center gap-1.5 text-[12px] px-3 py-[5px]"
                            onClick={() => openProviderKeyDialog(proj.id)}
                          >
                            <Plus className="h-3.5 w-3.5" /> Override
                          </GhostBtn>
                        </PermissionGate>
                      </div>
                      <div className="divide-y divide-border">
                        {PROVIDERS.map((provider) => {
                          const override = providerKeys.find(
                            (k) => k.project_id === proj.id && k.provider === provider && k.is_active,
                          )
                          const hasDefault = orgDefaults.some((k) => k.provider === provider)
                          return (
                            <div key={provider} className="flex items-center justify-between px-6 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="font-mono text-[11.5px] uppercase tracking-[0.05em] text-text-muted w-20 shrink-0">
                                  {provider}
                                </span>
                                {override ? (
                                  <>
                                    <span className="text-[13px] font-medium text-text truncate">
                                      {override.name}
                                    </span>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-accent-border bg-accent-bg text-accent shrink-0">
                                      project override
                                    </span>
                                  </>
                                ) : hasDefault ? (
                                  <>
                                    <span className="text-[12.5px] text-text-muted">Using workspace default</span>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-border text-text-faint shrink-0">
                                      inherit
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[12.5px] text-text-faint">Not configured</span>
                                    <PermissionGate need="edit">
                                      <Link
                                        href="/settings"
                                        className="font-mono text-[10.5px] text-accent hover:opacity-80 transition-opacity"
                                      >
                                        Add default →
                                      </Link>
                                    </PermissionGate>
                                  </>
                                )}
                              </div>
                              {override && (
                                <PermissionGate need="edit">
                                  <button
                                    type="button"
                                    onClick={() => void revokeProviderKey.mutateAsync(override.id)}
                                    disabled={revokeProviderKey.isPending}
                                    className="p-1.5 rounded hover:bg-accent-bg text-text-faint hover:text-accent transition-colors disabled:opacity-40 shrink-0"
                                    aria-label="Remove override"
                                    title="Remove override (falls back to workspace default)"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </PermissionGate>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Project name</label>
              <input
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
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

      {/* Create API key dialog */}
      <Dialog
        open={keyDialogOpen}
        onOpenChange={(open) => {
          setKeyDialogOpen(open)
          if (!open) setKeyProjectId('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Key name</label>
              <input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="Production key"
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
            <PrimaryBtn
              onClick={() => void handleCreateApiKey()}
              disabled={!keyName.trim() || createApiKey.isPending}
            >
              {createApiKey.isPending ? 'Creating…' : 'Create'}
            </PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>

      {/* Provider key override dialog */}
      <Dialog open={pkDialogOpen} onOpenChange={setPkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override provider key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-[12.5px] text-text-muted">
              This key will be used only for requests from this project. Other projects keep using the workspace default.
            </p>

            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Provider</label>
              <Select value={pkProvider} onValueChange={(v) => setPkProvider(v as ProviderName)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Name (optional)</label>
              <input
                value={pkName}
                onChange={(e) => setPkName(e.target.value)}
                placeholder="e.g. Production OpenAI"
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">API key</label>
              <input
                value={pkKey}
                onChange={(e) => setPkKey(e.target.value)}
                placeholder="sk-..."
                type="password"
                autoComplete="off"
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
              <p className="font-mono text-[10.5px] text-text-faint">
                Encrypted with AES-256-GCM. Never logged.
              </p>
            </div>

            {pkError && (
              <div className="rounded-md border border-accent-border bg-accent-bg px-3 py-2 text-[12px] text-accent">
                {pkError}
              </div>
            )}

            <PrimaryBtn
              onClick={() => void handleCreateProviderKey()}
              disabled={!pkKey.trim() || createProviderKey.isPending}
            >
              {createProviderKey.isPending ? 'Saving…' : 'Save override'}
            </PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
