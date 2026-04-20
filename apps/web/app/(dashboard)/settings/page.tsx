'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { apiGet, apiPost, apiDelete, apiPatch } from '@/lib/api'

interface ProviderKey {
  id: string
  provider: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

interface Org {
  id: string
  name: string
  plan: string
}

export default function SettingsPage() {
  const [org, setOrg] = useState<Org | null>(null)
  const [keys, setKeys] = useState<ProviderKey[]>([])
  const [loading, setLoading] = useState(true)

  // Add key dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newProvider, setNewProvider] = useState('openai')
  const [newKey, setNewKey] = useState('')
  const [newKeyName, setNewKeyName] = useState('')

  // Rotate dialog
  const [rotateId, setRotateId] = useState<string | null>(null)
  const [rotateKeyValue, setRotateKeyValue] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [orgRes, keyRes] = await Promise.allSettled([
      apiGet<{ success: boolean; data: Org }>('/api/v1/organizations/me'),
      apiGet<{ success: boolean; data: ProviderKey[] }>('/api/v1/provider-keys'),
    ])
    if (orgRes.status === 'fulfilled' && orgRes.value.success) setOrg(orgRes.value.data)
    if (keyRes.status === 'fulfilled' && keyRes.value.success) setKeys(keyRes.value.data)
    setLoading(false)
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  async function addKey() {
    await apiPost('/api/v1/provider-keys', {
      provider: newProvider,
      key: newKey,
      name: newKeyName || `${newProvider} key`,
    })
    setNewKey('')
    setNewKeyName('')
    setAddDialogOpen(false)
    void fetchAll()
  }

  async function revokeKey(id: string) {
    await apiDelete(`/api/v1/provider-keys/${id}`)
    void fetchAll()
  }

  async function handleRotateKey() {
    if (!rotateId || !rotateKeyValue.trim()) return
    await apiPatch(`/api/v1/provider-keys/${rotateId}`, { key: rotateKeyValue })
    setRotateId(null)
    setRotateKeyValue('')
    void fetchAll()
  }

  if (loading) return <div className="text-muted-foreground">Loading…</div>

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account and provider keys</p>
      </div>

      {/* Org info */}
      {org && (
        <section className="mb-8">
          <h2 className="text-base font-semibold mb-4">Organization</h2>
          <div className="rounded-lg border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="font-medium">{org.name}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan</span>
              <Badge variant="secondary" className="capitalize">{org.plan}</Badge>
            </div>
          </div>
        </section>
      )}

      {/* Provider keys */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Provider keys</h2>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Add key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add provider key</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={newProvider} onValueChange={setNewProvider}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>API key</Label>
                  <Input
                    type="password"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Name (optional)</Label>
                  <Input
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder={`${newProvider} production key`}
                  />
                </div>
                <Button onClick={() => void addKey()} disabled={!newKey.trim()}>
                  Save key
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="rounded-lg border bg-white overflow-hidden">
          {keys.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No provider keys yet. Add one to start proxying.
            </p>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between px-6 py-4 border-b last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs capitalize">
                      {key.provider}
                    </Badge>
                    <span className="font-medium text-sm">{key.name}</span>
                    {!key.is_active && <Badge variant="secondary">Revoked</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Added {new Date(key.created_at).toLocaleDateString()}
                  </p>
                </div>
                {key.is_active && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setRotateId(key.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Rotate
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => void revokeKey(key.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Rotate dialog */}
        <Dialog open={rotateId !== null} onOpenChange={(o) => !o && setRotateId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rotate provider key</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">Enter the new API key to replace the current one.</p>
              <Input
                type="password"
                value={rotateKeyValue}
                onChange={(e) => setRotateKeyValue(e.target.value)}
                placeholder="New API key"
              />
              <Button onClick={() => void handleRotateKey()} disabled={!rotateKeyValue.trim()}>
                Rotate key
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  )
}
