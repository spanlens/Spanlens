'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Key, Terminal, Code } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiPost } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type Step = 'org' | 'provider' | 'apikey'
type IntegrationMode = 'cli' | 'manual'

const STEP_ORDER: Step[] = ['org', 'provider', 'apikey']
const STEP_LABELS: Record<Step, string> = {
  org: 'Workspace',
  provider: 'Provider key',
  apikey: 'API key',
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('org')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [orgName, setOrgName] = useState('')
  const [provider, setProvider] = useState('openai')
  const [providerKey, setProviderKey] = useState('')
  const [providerKeyName, setProviderKeyName] = useState('Default key')
  const [projectId, setProjectId] = useState('')
  const [createdApiKey, setCreatedApiKey] = useState('')
  const [integrationMode, setIntegrationMode] = useState<IntegrationMode>('cli')
  const [copied, setCopied] = useState(false)

  const currentStepIdx = STEP_ORDER.indexOf(step)

  async function handleOrg(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiPost('/api/v1/organizations', { name: orgName })
      const supabase = createClient()
      await supabase.auth.refreshSession()
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

  function copyKey() {
    void navigator.clipboard.writeText(createdApiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const proxyUrls: Record<string, string> = {
    openai: 'https://spanlens-server.vercel.app/proxy/openai',
    anthropic: 'https://spanlens-server.vercel.app/proxy/anthropic',
    gemini: 'https://spanlens-server.vercel.app/proxy/gemini',
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[480px]">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <Zap className="h-5 w-5 text-accent" strokeWidth={2.5} />
          <span className="font-semibold text-[17px] text-text tracking-[-0.3px]">Spanlens</span>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {STEP_ORDER.map((s, i) => {
            const isDone = i < currentStepIdx
            const isActive = i === currentStepIdx
            return (
              <div key={s} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold border transition-colors',
                      isDone
                        ? 'bg-good border-good/30 text-bg'
                        : isActive
                          ? 'bg-accent border-accent text-bg'
                          : 'bg-bg-elev border-border text-text-faint',
                    )}
                  >
                    {isDone ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-[10.5px] font-mono mt-1',
                      isActive ? 'text-text' : 'text-text-faint',
                    )}
                  >
                    {STEP_LABELS[s]}
                  </span>
                </div>
                {i < STEP_ORDER.length - 1 && (
                  <div
                    className={cn(
                      'h-px w-12 mx-2 mb-4',
                      isDone ? 'bg-good/40' : 'bg-border',
                    )}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-bg-elev px-8 py-8">
          {/* Step: Org */}
          {step === 'org' && (
            <div>
              <h1 className="text-[20px] font-semibold text-text mb-1 tracking-[-0.3px]">
                Name your workspace
              </h1>
              <p className="text-[13px] text-text-muted mb-6">
                Usually your company or project name.
              </p>
              <form onSubmit={(e) => void handleOrg(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium" htmlFor="orgName">
                    Workspace name
                  </label>
                  <input
                    id="orgName"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Acme Inc."
                    required
                    className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                </div>
                {error && <p className="text-[12.5px] text-bad">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !orgName.trim()}
                  className="w-full h-9 rounded-[6px] bg-text text-bg text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating…' : 'Continue'}
                </button>
              </form>
            </div>
          )}

          {/* Step: Provider key */}
          {step === 'provider' && (
            <div>
              <h1 className="text-[20px] font-semibold text-text mb-1 tracking-[-0.3px]">
                Add your provider key
              </h1>
              <p className="text-[13px] text-text-muted mb-6">
                Encrypted at rest with AES-256-GCM. Never logged.
              </p>
              <form onSubmit={(e) => void handleProvider(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium">Provider</label>
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
                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium" htmlFor="pkey">
                    API key
                  </label>
                  <input
                    id="pkey"
                    type="password"
                    value={providerKey}
                    onChange={(e) => setProviderKey(e.target.value)}
                    placeholder={
                      provider === 'openai'
                        ? 'sk-proj-…'
                        : provider === 'anthropic'
                          ? 'sk-ant-…'
                          : 'AIza…'
                    }
                    required
                    className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium" htmlFor="pkeyName">
                    Key name
                  </label>
                  <input
                    id="pkeyName"
                    value={providerKeyName}
                    onChange={(e) => setProviderKeyName(e.target.value)}
                    className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                </div>
                {error && <p className="text-[12.5px] text-bad">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !providerKey.trim()}
                  className="w-full h-9 rounded-[6px] bg-text text-bg text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? 'Saving…' : 'Continue'}
                </button>
              </form>
            </div>
          )}

          {/* Step: API key + snippet */}
          {step === 'apikey' && (
            <div>
              <h1 className="text-[20px] font-semibold text-text mb-1 tracking-[-0.3px]">
                Your Spanlens API key
              </h1>
              <p className="text-[13px] text-text-muted mb-5">
                Copy this now — it won&apos;t be shown again.
              </p>

              {/* Key display */}
              <div className="rounded-lg border border-border bg-[#1a1816] px-4 py-3 mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-[#7c7770]">
                    SPANLENS_API_KEY
                  </span>
                  <button
                    type="button"
                    onClick={copyKey}
                    className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="font-mono text-[12.5px] text-good break-all leading-relaxed">
                  {createdApiKey}
                </code>
              </div>

              {/* Integration mode tabs */}
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setIntegrationMode('cli')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                    integrationMode === 'cli'
                      ? 'bg-accent text-bg'
                      : 'bg-bg border border-border text-text-muted hover:text-text',
                  )}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  1-command setup
                  <span className="rounded bg-good/20 px-1 text-[10px] font-semibold text-good">
                    recommended
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIntegrationMode('manual')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                    integrationMode === 'manual'
                      ? 'bg-accent text-bg'
                      : 'bg-bg border border-border text-text-muted hover:text-text',
                  )}
                >
                  <Code className="h-3.5 w-3.5" />
                  Manual
                </button>
              </div>

              {/* Code block */}
              <div className="rounded-lg border border-border bg-[#1a1816] px-4 py-4 mb-5 space-y-3">
                {integrationMode === 'cli' ? (
                  <>
                    <p className="font-mono text-[10.5px] text-[#7c7770]">
                      Run in your Next.js project — auto-installs SDK + rewrites OpenAI client
                    </p>
                    <pre className="font-mono text-[13px] text-good">npx @spanlens/cli init</pre>
                    <p className="font-mono text-[10.5px] text-[#5c5752]">
                      Paste your API key when asked. ~30 seconds.
                    </p>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="font-mono text-[10.5px] text-[#7c7770] mb-1.5">
                        1. Install the SDK
                      </p>
                      <pre className="font-mono text-[12.5px] text-[#d4cfc8]">
                        npm install @spanlens/sdk
                      </pre>
                    </div>
                    <div>
                      <p className="font-mono text-[10.5px] text-[#7c7770] mb-1.5">
                        2. Add to your env
                      </p>
                      <pre className="font-mono text-[12.5px] text-[#d4cfc8]">
                        {`SPANLENS_API_KEY=${createdApiKey}`}
                      </pre>
                    </div>
                    <div>
                      <p className="font-mono text-[10.5px] text-[#7c7770] mb-1.5">
                        3. Replace your{' '}
                        {provider === 'openai'
                          ? 'OpenAI'
                          : provider === 'anthropic'
                            ? 'Anthropic'
                            : 'Gemini'}{' '}
                        client
                      </p>
                      <pre className="font-mono text-[12.5px] text-[#d4cfc8] whitespace-pre-wrap">
                        {provider === 'openai'
                          ? `import { createOpenAI } from '@spanlens/sdk/openai'\nconst openai = createOpenAI()`
                          : provider === 'anthropic'
                            ? `import { createAnthropic } from '@spanlens/sdk/anthropic'\nconst anthropic = createAnthropic()`
                            : `import { createGemini } from '@spanlens/sdk/gemini'\nconst genAI = createGemini()`}
                      </pre>
                    </div>
                    <div>
                      <p className="font-mono text-[10.5px] text-[#7c7770] mb-1.5">
                        Or route directly (any language):
                      </p>
                      <pre className="font-mono text-[12.5px] text-[#d4cfc8] whitespace-pre-wrap">
                        {`Base URL: ${proxyUrls[provider] ?? ''}\nAuth:     Authorization: Bearer ${createdApiKey}`}
                      </pre>
                    </div>
                  </>
                )}
              </div>

              {/* Warning */}
              <div className="flex items-start gap-3 rounded-lg border border-accent-border bg-accent-bg px-4 py-3 mb-5">
                <Key className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                <p className="text-[12.5px] text-accent">
                  Store your API key securely. It cannot be retrieved after this page.
                </p>
              </div>

              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="w-full h-9 rounded-[6px] bg-text text-bg text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                Go to dashboard →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
