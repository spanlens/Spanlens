'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Key } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiPost } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'

type Step = 'org' | 'provider' | 'apikey' | 'done'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('org')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Org step
  const [orgName, setOrgName] = useState('')

  // Provider step
  const [provider, setProvider] = useState('openai')
  const [providerKey, setProviderKey] = useState('')
  const [providerKeyName, setProviderKeyName] = useState('Default key')
  const [projectId, setProjectId] = useState('')

  // API key step
  const [createdApiKey, setCreatedApiKey] = useState('')

  async function handleOrg(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Create org. The server also injects org_id into the user's JWT
      // app_metadata so the dashboard layout can skip the API round-trip.
      await apiPost('/api/v1/organizations', { name: orgName })

      // Refresh the session so the browser cookie carries the new claims.
      // Without this, the dashboard layout would still see the old JWT
      // (no org_id) and bounce the user back to /onboarding — infinite loop.
      const supabase = createClient()
      await supabase.auth.refreshSession()

      // Create default project (uses the freshly refreshed JWT).
      const proj = await apiPost<{ data: { id: string } }>('/api/v1/projects', {
        name: 'Default Project',
        description: 'Auto-created during onboarding',
      })
      setProjectId(proj.data.id)
      setStep('provider')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleProvider(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiPost('/api/v1/provider-keys', {
        provider,
        key: providerKey,
        name: providerKeyName,
      })
      // Create first API key
      const res = await apiPost<{ data: { key: string } }>('/api/v1/api-keys', {
        name: 'Default API Key',
        projectId,
      })
      setCreatedApiKey(res.data.key)
      setStep('apikey')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const proxyUrls: Record<string, string> = {
    openai: 'https://spanlens-server.vercel.app/proxy/openai',
    anthropic: 'https://spanlens-server.vercel.app/proxy/anthropic',
    gemini: 'https://spanlens-server.vercel.app/proxy/gemini',
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-white rounded-xl border shadow-sm p-8">
        {/* Header */}
        <div className="flex items-center gap-2 mb-8">
          <Zap className="h-6 w-6 text-blue-600" />
          <span className="font-bold text-xl">Spanlens</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {(['org', 'provider', 'apikey', 'done'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  step === s
                    ? 'bg-blue-600 text-white'
                    : ['org', 'provider', 'apikey'].indexOf(step) > i
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {i + 1}
              </div>
              {i < 3 && <div className="h-px w-8 bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* Step: Org */}
        {step === 'org' && (
          <div>
            <h1 className="text-2xl font-bold mb-2">Name your organization</h1>
            <p className="text-muted-foreground mb-6">This is usually your company or project name.</p>
            <form onSubmit={handleOrg} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="orgName">Organization name</Label>
                <Input
                  id="orgName"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Inc."
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating…' : 'Continue'}
              </Button>
            </form>
          </div>
        )}

        {/* Step: Provider key */}
        {step === 'provider' && (
          <div>
            <h1 className="text-2xl font-bold mb-2">Add your provider key</h1>
            <p className="text-muted-foreground mb-6">
              Your key is encrypted at rest with AES-256-GCM. We never log it.
            </p>
            <form onSubmit={handleProvider} className="space-y-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
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
                <Label htmlFor="pkey">API key</Label>
                <Input
                  id="pkey"
                  type="password"
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  placeholder={provider === 'openai' ? 'sk-proj-...' : provider === 'anthropic' ? 'sk-ant-...' : 'AIza...'}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pkeyName">Key name</Label>
                <Input
                  id="pkeyName"
                  value={providerKeyName}
                  onChange={(e) => setProviderKeyName(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving…' : 'Continue'}
              </Button>
            </form>
          </div>
        )}

        {/* Step: API key + code snippet */}
        {step === 'apikey' && (
          <div>
            <h1 className="text-2xl font-bold mb-2">Your Spanlens API key</h1>
            <p className="text-muted-foreground mb-6">
              Copy this now — we won&apos;t show it again.
            </p>
            <div className="rounded-lg border bg-gray-950 p-4 mb-6">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400 font-mono">SPANLENS_API_KEY</span>
                <button
                  className="text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => navigator.clipboard.writeText(createdApiKey)}
                >
                  Copy
                </button>
              </div>
              <code className="text-sm font-mono text-green-400 break-all">{createdApiKey}</code>
            </div>

            <div className="rounded-lg border bg-gray-950 p-4 mb-6">
              <p className="text-xs text-gray-400 font-mono mb-3">Integration snippet</p>
              <pre className="text-sm font-mono text-gray-200 whitespace-pre-wrap">{`from openai import OpenAI

client = OpenAI(
    api_key="${createdApiKey}",
    base_url="${proxyUrls[provider]}",
)`}</pre>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6">
              <Key className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">
                Store your API key securely. It cannot be retrieved after this page.
              </p>
            </div>

            <Button onClick={() => router.push('/dashboard')}>
              Go to dashboard →
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
