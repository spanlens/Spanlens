'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { apiGet, apiPost, apiDelete } from '@/lib/api'

interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
}

interface ApiKey {
  id: string
  project_id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // New project dialog
  const [projDialogOpen, setProjDialogOpen] = useState(false)
  const [projName, setProjName] = useState('')

  // New API key dialog
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyProjectId, setKeyProjectId] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [projRes, keyRes] = await Promise.allSettled([
      apiGet<{ success: boolean; data: Project[] }>('/api/v1/projects'),
      apiGet<{ success: boolean; data: ApiKey[] }>('/api/v1/api-keys'),
    ])
    if (projRes.status === 'fulfilled' && projRes.value.success)
      setProjects(projRes.value.data)
    if (keyRes.status === 'fulfilled' && keyRes.value.success)
      setApiKeys(keyRes.value.data)
    setLoading(false)
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  async function createProject() {
    await apiPost('/api/v1/projects', { name: projName })
    setProjName('')
    setProjDialogOpen(false)
    void fetchAll()
  }

  async function createApiKey() {
    const res = await apiPost<{ success: boolean; data: { key: string } }>('/api/v1/api-keys', {
      name: keyName,
      projectId: keyProjectId,
    })
    setNewKey(res.data.key)
    setKeyName('')
    setKeyDialogOpen(false)
    void fetchAll()
  }

  async function revokeKey(id: string) {
    await apiDelete(`/api/v1/api-keys/${id}`)
    void fetchAll()
  }

  if (loading) return <div className="text-muted-foreground">Loading…</div>

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
              <Button onClick={() => void createProject()} disabled={!projName.trim()}>
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* New key banner */}
      {newKey && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6">
          <p className="text-sm font-semibold text-amber-900 mb-2">New API key created — copy it now</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white border px-3 py-1.5 text-sm font-mono break-all">
              {newKey}
            </code>
            <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(newKey)}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setNewKey(null)}>
              ✕
            </Button>
          </div>
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
              <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
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
                    <Button onClick={() => void createApiKey()} disabled={!keyName.trim()}>
                      Create
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
                          onClick={() => void revokeKey(key.id)}
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
