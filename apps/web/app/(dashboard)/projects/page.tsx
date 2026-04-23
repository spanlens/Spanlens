'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Plus, Trash2, Copy, Terminal, Check, ExternalLink } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Topbar } from '@/components/layout/topbar'
import { GhostBtn, PrimaryBtn } from '@/components/ui/primitives'
import { useCreateProject, useProjects } from '@/lib/queries/use-projects'
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/queries/use-api-keys'
import { cn } from '@/lib/utils'

export default function ProjectsPage() {
  const projectsQuery = useProjects()
  const apiKeysQuery = useApiKeys()
  const createProject = useCreateProject()
  const createApiKey = useCreateApiKey()
  const revokeApiKey = useRevokeApiKey()

  const [newKey, setNewKey] = useState<string | null>(null)
  const [cmdCopied, setCmdCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  const [projDialogOpen, setProjDialogOpen] = useState(false)
  const [projName, setProjName] = useState('')

  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyProjectId, setKeyProjectId] = useState('')

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

  const loading = projectsQuery.isLoading || apiKeysQuery.isLoading
  const projects = projectsQuery.data ?? []
  const apiKeys = apiKeysQuery.data ?? []

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Projects' }]}
        right={
          <GhostBtn
            onClick={() => setProjDialogOpen(true)}
            className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px]"
          >
            <Plus className="h-3.5 w-3.5" /> New project
          </GhostBtn>
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
                      <GhostBtn
                        className="flex items-center gap-1.5 text-[12px] px-3 py-[5px]"
                        onClick={() => {
                          setKeyProjectId(proj.id)
                          setKeyDialogOpen(true)
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" /> New API key
                      </GhostBtn>
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
                                  <button
                                    type="button"
                                    onClick={() => void revokeApiKey.mutateAsync(key.id)}
                                    disabled={revokeApiKey.isPending}
                                    className="p-1.5 rounded hover:bg-accent-bg text-text-faint hover:text-accent transition-colors disabled:opacity-40"
                                    aria-label="Revoke key"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {projects.length === 0 && (
                <div className="rounded-xl border border-border bg-bg-elev px-6 py-12 text-center">
                  <p className="text-[13px] text-text-faint mb-4">No projects yet.</p>
                  <GhostBtn
                    onClick={() => setProjDialogOpen(true)}
                    className="inline-flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" /> Create your first project
                  </GhostBtn>
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
    </div>
  )
}
