'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FlaskConical, GitCommit, ArrowLeftRight, BarChart2, Phone, Terminal } from 'lucide-react'
import {
  usePromptVersions,
  usePromptExperiments,
} from '@/lib/queries/use-prompts'
import { Topbar } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { cn } from '@/lib/utils'
import { VersionsTab } from './tabs/versions-tab'
import { DiffTab } from './tabs/diff-tab'
import { TrafficTab } from './tabs/traffic-tab'
import { CallsTab } from './tabs/calls-tab'
import { AbTab } from './tabs/ab-tab'
import { PlaygroundTab } from './tabs/playground-tab'

type Tab = 'versions' | 'diff' | 'traffic' | 'calls' | 'ab' | 'playground'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'versions',   label: 'Versions',   icon: <GitCommit className="h-3.5 w-3.5" /> },
  { id: 'diff',       label: 'Diff',       icon: <ArrowLeftRight className="h-3.5 w-3.5" /> },
  { id: 'traffic',    label: 'Traffic',    icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { id: 'calls',      label: 'Calls',      icon: <Phone className="h-3.5 w-3.5" /> },
  { id: 'ab',         label: 'A/B',        icon: <FlaskConical className="h-3.5 w-3.5" /> },
  { id: 'playground', label: 'Playground', icon: <Terminal className="h-3.5 w-3.5" /> },
]

interface Props {
  params: { name: string }
}

export default function PromptDetailPage({ params }: Props) {
  const name = decodeURIComponent(params.name)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('versions')

  const { data: versions, isLoading } = usePromptVersions(name)
  const { data: experiments } = usePromptExperiments(name)

  const hasRunning = experiments?.some((e) => e.status === 'running') ?? false

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[
          { label: 'Workspace', href: '/dashboard' },
          { label: 'Prompts', href: '/prompts' },
          { label: name },
        ]}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="font-mono text-[11px] text-text-muted hover:text-text flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          </div>
        }
      />

      {/* Header row */}
      <div className="flex items-center gap-3 px-[22px] py-[14px] border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="font-mono text-[15px] font-semibold text-text truncate">{name}</h1>
          <p className="font-mono text-[11px] text-text-faint mt-0.5">
            {isLoading
              ? 'Loading…'
              : `${versions?.length ?? 0} version${versions?.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {hasRunning && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] px-[8px] py-[3px] rounded-[4px] bg-accent-bg border border-accent-border text-accent">
            <FlaskConical className="h-3 w-3" />
            A/B running
          </span>
        )}
        <PermissionGate need="edit">
          <button
            type="button"
            onClick={() => setTab('ab')}
            className="font-mono text-[11px] text-text px-[10px] py-[5px] border border-border-strong rounded-[5px] bg-bg-elev hover:bg-bg-muted flex items-center gap-1.5 transition-colors"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {hasRunning ? 'Manage A/B' : 'New A/B test'}
          </button>
        </PermissionGate>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 px-[22px] border-b border-border shrink-0 bg-bg-muted overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-[14px] py-[10px] font-mono text-[11.5px] tracking-[0.02em] border-b-2 transition-colors',
              tab === t.id
                ? 'border-text text-text'
                : 'border-transparent text-text-faint hover:text-text-muted',
            )}
          >
            {t.icon}
            {t.label}
            {t.id === 'ab' && hasRunning && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent block" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === 'versions' && <VersionsTab name={name} versions={versions} isLoading={isLoading} />}
        {tab === 'diff'     && <DiffTab versions={versions ?? []} />}
        {tab === 'traffic'  && <TrafficTab name={name} />}
        {tab === 'calls'    && <CallsTab name={name} />}
        {tab === 'ab'         && <AbTab name={name} versions={versions ?? []} experiments={experiments ?? []} />}
        {tab === 'playground' && <PlaygroundTab versions={versions ?? []} />}
      </div>
    </div>
  )
}
