'use client'
import Link from 'next/link'
import { Plus, Terminal, ExternalLink, Pencil, Trash2, Key as KeyIcon } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

type DemoProvKey = {
  id: string
  name: string
  provider: 'openai' | 'anthropic' | 'gemini' | 'azure'
  is_active: boolean
}

type DemoApiKey = {
  id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_used_days_ago: number | null
  provider_keys: DemoProvKey[]
}

type DemoProject = {
  id: string
  name: string
  api_keys: DemoApiKey[]
}

const DEMO_PROJECTS: DemoProject[] = [
  {
    id: 'prj_01HZX9N8K3F2T7V6Q5R4S3D2W1',
    name: 'Production',
    api_keys: [
      {
        id: 'apk_01HZX9N8K3F2T7V6Q5R4S3D2W1',
        name: 'web-frontend',
        key_prefix: 'sl_live_8a3f',
        is_active: true,
        last_used_days_ago: 0,
        provider_keys: [
          { id: 'pk-1', name: 'OpenAI prod', provider: 'openai', is_active: true },
          { id: 'pk-2', name: 'Anthropic prod', provider: 'anthropic', is_active: true },
        ],
      },
      {
        id: 'apk_01HZX9P2L4G3U8W7R6S5T4E3X2',
        name: 'support-bot',
        key_prefix: 'sl_live_b4d1',
        is_active: true,
        last_used_days_ago: 2,
        provider_keys: [
          { id: 'pk-3', name: 'OpenAI prod', provider: 'openai', is_active: true },
        ],
      },
    ],
  },
  {
    id: 'prj_01HZXA1Z9M5H4V8X7S6T5F4G3Y2',
    name: 'Staging',
    api_keys: [
      {
        id: 'apk_01HZXA1Z9M5H4V8X7S6T5F4G3Y3',
        name: 'staging-key',
        key_prefix: 'sl_live_c5e2',
        is_active: true,
        last_used_days_ago: 5,
        provider_keys: [
          { id: 'pk-4', name: 'OpenAI staging', provider: 'openai', is_active: true },
          { id: 'pk-5', name: 'Gemini staging', provider: 'gemini', is_active: false },
        ],
      },
    ],
  },
  {
    id: 'prj_01HZXB4N7P6J5W9Y8T7U6G5H4I3',
    name: 'Internal Tools',
    api_keys: [],
  },
]

export default function DemoProjectsPage() {
  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Projects' }]}
        right={
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px] rounded-[5px] border border-border bg-bg-elev text-text-muted opacity-60 cursor-not-allowed"
            title="Disabled in demo"
          >
            <Plus className="h-3.5 w-3.5" /> New project
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-7 py-6 max-w-4xl">
          <div className="mb-6">
            <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px] mb-1">Projects & Keys</h1>
            <p className="text-[13px] text-text-muted">
              Each Spanlens key holds its own AI provider keys. Expand a key to see and add OpenAI / Anthropic / Gemini keys it can call.
            </p>
          </div>

          {/* Integration hint */}
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

          <div className="space-y-6">
            {DEMO_PROJECTS.map((proj) => (
              <div key={proj.id} className="rounded-xl border border-border bg-bg-elev overflow-hidden">
                {/* Project header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg">
                  <div>
                    <h2 className="text-[14px] font-semibold text-text">{proj.name}</h2>
                    <p className="font-mono text-[10.5px] text-text-faint mt-0.5">{proj.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled
                      className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] rounded-[5px] bg-text text-bg font-medium opacity-60 cursor-not-allowed"
                      title="Disabled in demo"
                    >
                      <Plus className="h-3.5 w-3.5" /> New Spanlens key
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Disabled in demo"
                      className="p-1.5 rounded text-text-faint opacity-60 cursor-not-allowed"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Spanlens keys */}
                {proj.api_keys.length === 0 ? (
                  <p className="px-6 py-5 text-[13px] text-text-faint">No Spanlens keys yet. Create one to start.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {proj.api_keys.map((key) => (
                      <div key={key.id}>
                        <div className="flex items-center gap-3 px-6 py-3 bg-bg/30">
                          <KeyIcon className="h-3.5 w-3.5 text-text-faint shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className={cn('text-[13.5px] font-semibold truncate', !key.is_active && 'line-through text-text-faint')}>
                              {key.name}
                            </div>
                            <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                              {key.key_prefix}…
                              <span className="ml-2">
                                {key.last_used_days_ago == null
                                  ? '· never used'
                                  : key.last_used_days_ago === 0
                                    ? '· last used today'
                                    : `· last used ${key.last_used_days_ago}d ago`}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-1.5 text-[12px] px-3 py-[5px] h-[28px] shrink-0 rounded-[5px] border border-border bg-bg-elev text-text-muted opacity-60 cursor-not-allowed"
                            title="Disabled in demo"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add provider key
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={key.is_active}
                              disabled
                              title="Disabled in demo"
                              className={cn(
                                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors opacity-70 cursor-not-allowed',
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
                            <button
                              type="button"
                              disabled
                              title="Disabled in demo"
                              className="p-1.5 rounded text-text-faint opacity-60 cursor-not-allowed"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Provider keys */}
                        {key.provider_keys.length === 0 ? (
                          <p className="px-12 py-2.5 text-[12px] text-text-faint">
                            No provider keys yet. Add OpenAI / Anthropic / Gemini to enable calls through this Spanlens key.
                          </p>
                        ) : (
                          <div>
                            {key.provider_keys.map((pk) => (
                              <div key={pk.id} className="grid grid-cols-[1fr_100px_60px] gap-4 px-12 py-2 items-center">
                                <span className={cn('text-[12.5px] truncate', !pk.is_active && 'line-through text-text-faint')}>
                                  {pk.name}
                                </span>
                                <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-border text-text-muted w-fit">
                                  {pk.provider}
                                </span>
                                <div className="flex items-center gap-1 justify-end">
                                  <button
                                    type="button"
                                    disabled
                                    title="Disabled in demo"
                                    className="p-1 rounded text-text-faint opacity-60 cursor-not-allowed"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled
                                    title="Disabled in demo"
                                    className="p-1 rounded text-text-faint opacity-60 cursor-not-allowed"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
