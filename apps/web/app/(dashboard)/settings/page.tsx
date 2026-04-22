'use client'
import { useState } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useOrganization, useUpdateOverageSettings } from '@/lib/queries/use-organization'
import {
  useCreateProviderKey,
  useProviderKeys,
  useRevokeProviderKey,
  useRotateProviderKey,
} from '@/lib/queries/use-provider-keys'
import { DocsLink } from '@/components/layout/docs-link'

export default function SettingsPage() {
  const orgQuery = useOrganization()
  const keysQuery = useProviderKeys()
  const createProviderKey = useCreateProviderKey()
  const revokeProviderKey = useRevokeProviderKey()
  const rotateProviderKey = useRotateProviderKey()

  // Add key dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newProvider, setNewProvider] = useState('openai')
  const [newKey, setNewKey] = useState('')
  const [newKeyName, setNewKeyName] = useState('')

  // Rotate dialog
  const [rotateId, setRotateId] = useState<string | null>(null)
  const [rotateKeyValue, setRotateKeyValue] = useState('')

  async function handleAdd() {
    await createProviderKey.mutateAsync({
      provider: newProvider,
      key: newKey,
      name: newKeyName || `${newProvider} key`,
    })
    setNewKey('')
    setNewKeyName('')
    setAddDialogOpen(false)
  }

  async function handleRotate() {
    if (!rotateId || !rotateKeyValue.trim()) return
    await rotateProviderKey.mutateAsync({ id: rotateId, key: rotateKeyValue })
    setRotateId(null)
    setRotateKeyValue('')
  }

  const loading = orgQuery.isLoading || keysQuery.isLoading

  if (loading) {
    return (
      <div className="max-w-2xl">
        <div className="mb-8">
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-32 w-full mb-8" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const org = orgQuery.data
  const keys = keysQuery.data ?? []

  return (
    <div className="max-w-2xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your account and provider keys</p>
        </div>
        <DocsLink href="/docs/features/settings" />
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

      {org && <OverageSettingsSection org={org} />}

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
                <Button
                  onClick={() => void handleAdd()}
                  disabled={!newKey.trim() || createProviderKey.isPending}
                >
                  {createProviderKey.isPending ? 'Saving…' : 'Save key'}
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
                      onClick={() => void revokeProviderKey.mutateAsync(key.id)}
                      disabled={revokeProviderKey.isPending}
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
              <Button
                onClick={() => void handleRotate()}
                disabled={!rotateKeyValue.trim() || rotateProviderKey.isPending}
              >
                {rotateProviderKey.isPending ? 'Rotating…' : 'Rotate key'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  )
}

// ── Overage policy (Pattern C) ──────────────────────────────────────────

interface OverageOrg {
  id: string
  plan: string
  allow_overage: boolean
  overage_cap_multiplier: number
}

function OverageSettingsSection({ org }: { org: OverageOrg }) {
  const update = useUpdateOverageSettings()
  const [multiplierDraft, setMultiplierDraft] = useState(String(org.overage_cap_multiplier))
  const isFree = org.plan === 'free'
  const isEnterprise = org.plan === 'enterprise'

  if (isEnterprise) return null // unlimited — no overage concept

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-4">Overage billing</h2>
      <div className="rounded-lg border bg-white p-5 space-y-5">
        {isFree ? (
          <p className="text-sm text-muted-foreground">
            Overage billing is not available on the Free plan. Upgrade to Starter or Team to allow
            usage past your monthly quota to be billed instead of rejected.
          </p>
        ) : (
          <>
            {/* Toggle */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium" htmlFor="allow-overage">
                  Allow overage charges
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When your monthly quota is reached, continue serving requests and bill the
                  overage on your next invoice. Off = requests past the limit return{' '}
                  <code className="text-[11px]">429</code>.
                </p>
              </div>
              <button
                id="allow-overage"
                type="button"
                role="switch"
                aria-checked={org.allow_overage}
                disabled={update.isPending}
                onClick={() =>
                  void update.mutateAsync({ allow_overage: !org.allow_overage })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  org.allow_overage ? 'bg-blue-600' : 'bg-gray-300'
                } ${update.isPending ? 'opacity-60' : ''}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    org.allow_overage ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Multiplier */}
            <Separator />
            <div>
              <Label htmlFor="cap-multiplier" className="text-sm">
                Max overage multiplier
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                Hard cap = your monthly limit × this multiplier. Requests past the cap return
                <code className="text-[11px] ml-1">429</code> even with overage enabled — protects
                against runaway usage. Allowed: 1–100.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id="cap-multiplier"
                  type="number"
                  min={1}
                  max={100}
                  disabled={!org.allow_overage || update.isPending}
                  value={multiplierDraft}
                  onChange={(e) => setMultiplierDraft(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">x</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !org.allow_overage ||
                    update.isPending ||
                    Number(multiplierDraft) === org.overage_cap_multiplier ||
                    !Number.isInteger(Number(multiplierDraft)) ||
                    Number(multiplierDraft) < 1 ||
                    Number(multiplierDraft) > 100
                  }
                  onClick={() =>
                    void update.mutateAsync({
                      overage_cap_multiplier: Number(multiplierDraft),
                    })
                  }
                >
                  {update.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
