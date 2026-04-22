'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Plus, Trash2, Copy, Terminal, Check, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useCreateProject, useProjects } from '@/lib/queries/use-projects'
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/queries/use-api-keys'

export default function ProjectsPage() {
  const projectsQuery = useProjects()
  const apiKeysQuery = useApiKeys()
  const createProject = useCreateProject()
  const createApiKey = useCreateApiKey()
  const revokeApiKey = useRevokeApiKey()

  const [newKey, setNewKey] = useState<string | null>(null)
  const [cmdCopied, setCmdCopied] = useState(false)

  function copyWizardCmd() {
    navigator.clipboard.writeText('npx @spanlens/cli init')
    setCmdCopied(true)
    setTimeout(() => setCmdCopied(false), 1500)
  }

  // New project dialog
  const [projDialogOpen, setProjDialogOpen] = useState(false)
  const [projName, setProjName] = useState('')

  // New API key dialog
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyProjectId, setKeyProjectId] = useState('')

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

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-56 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-white mb-4 p-6">
            <Skeleton className="h-5 w-40 mb-2" />
            <Skeleton className="h-3 w-64" />
          </div>
        ))}
      </div>
    )
  }

  const projects = projectsQuery.data ?? []
  const apiKeys = apiKeysQuery.data ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects & API Keys</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your projects and access keys</p>
        </div>
        <Dialog open={projDialogOpen} onOpenChange={setProjDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" /> New project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Project name</Label>
                <Input value={projName} onChange={(e) => setProjName(e.target.value)} />
              </div>
              <Button
                onClick={() => void handleCreateProject()}
                disabled={!projName.trim() || createProject.isPending}
              >
                {createProject.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* New key banner — key + integration guide */}
      {newKey && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-emerald-900">
              🎉 API key created — copy now (won&apos;t be shown again)
            </p>
            <button
              onClick={() => setNewKey(null)}
              className="text-emerald-700 hover:text-emerald-900 text-sm"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>

          {/* The key itself */}
          <div className="flex items-center gap-2 mb-5">
            <code className="flex-1 rounded bg-white border border-emerald-200 px-3 py-2 text-sm font-mono break-all">
              {newKey}
            </code>
            <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(newKey)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          {/* Integration guide */}
          <div className="rounded-md bg-white border border-emerald-200 p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <Terminal className="h-4 w-4 text-emerald-700" />
              <p className="text-sm font-semibold text-gray-900">
                Integrate in 30 seconds
              </p>
              <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">
                recommended
              </Badge>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              In your Next.js project root, run the wizard. Paste the key above when prompted.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-gray-950 px-3 py-2 text-sm font-mono text-green-400">
                npx @spanlens/cli init
              </code>
              <Button size="sm" variant="outline" onClick={copyWizardCmd}>
                {cmdCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Using a different framework (Python, Ruby, raw HTTP)?{' '}
              <Link href="/docs/quick-start" className="text-blue-600 underline inline-flex items-center gap-0.5">
                Manual setup guide
                <ExternalLink className="h-3 w-3" />
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* Standing integration hint (no key in flight) */}
      {!newKey && projects.length > 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Terminal className="h-4 w-4 shrink-0 text-gray-500" />
            <span>
              Quick integrate in a Next.js project:{' '}
              <code className="font-mono bg-white border px-1.5 py-0.5 rounded text-xs">
                npx @spanlens/cli init
              </code>
            </span>
          </div>
          <Link href="/docs/quick-start" className="text-xs text-blue-600 hover:underline shrink-0 inline-flex items-center gap-0.5">
            Full guide
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* Projects */}
      {projects.map((proj) => {
        const keys = apiKeys.filter((k) => k.project_id === proj.id)
        return (
          <div key={proj.id} className="rounded-lg border bg-white mb-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
              <div>
                <h2 className="font-semibold">{proj.name}</h2>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{proj.id}</p>
              </div>
              <Dialog
                open={keyDialogOpen && keyProjectId === proj.id}
                onOpenChange={(open) => {
                  setKeyDialogOpen(open)
                  if (!open) setKeyProjectId('')
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setKeyProjectId(proj.id)}
                  >
                    <Plus className="h-3.5 w-3.5" /> New API key
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create API key</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>Key name</Label>
                      <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Production key" />
                    </div>
                    <Button
                      onClick={() => void handleCreateApiKey()}
                      disabled={!keyName.trim() || createApiKey.isPending}
                    >
                      {createApiKey.isPending ? 'Creating…' : 'Create'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div>
              {keys.length === 0 ? (
                <p className="px-6 py-4 text-sm text-muted-foreground">No API keys yet.</p>
              ) : (
                keys.map((key) => (
                  <div key={key.id} className="flex items-center justify-between px-6 py-3 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <code className="text-sm font-mono text-muted-foreground">
                        {key.key_prefix}••••••••
                      </code>
                      <span className="text-sm font-medium">{key.name}</span>
                      {!key.is_active && <Badge variant="secondary">Revoked</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {key.last_used_at
                          ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                          : 'Never used'}
                      </span>
                      {key.is_active && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => void revokeApiKey.mutateAsync(key.id)}
                          disabled={revokeApiKey.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}

      {projects.length === 0 && (
        <div className="rounded-lg border bg-white px-6 py-12 text-center">
          <p className="text-muted-foreground mb-4">No projects yet.</p>
          <Button onClick={() => setProjDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create your first project
          </Button>
        </div>
      )}
    </div>
  )
}
