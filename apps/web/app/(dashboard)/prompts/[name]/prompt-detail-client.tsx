'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import {
  usePromptVersions,
  usePromptExperiments,
} from '@/lib/queries/use-prompts'
import { Topbar } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StatusPill } from '@/components/ui/primitives'
import { Board, TOPBAR_BLEED } from '../../_board/surfaces'
import { VersionsTab } from './tabs/versions-tab'
import { DiffTab } from './tabs/diff-tab'
import { TrafficTab } from './tabs/traffic-tab'
import { CallsTab } from './tabs/calls-tab'
import { AbTab } from './tabs/ab-tab'
import { PlaygroundTab } from './tabs/playground-tab'

type Tab = 'versions' | 'diff' | 'traffic' | 'calls' | 'ab' | 'playground'

const VALID_TABS: readonly Tab[] = ['versions', 'diff', 'traffic', 'calls', 'ab', 'playground']

// D4 draws the tab row as label-only pills, so the icons the old underline bar
// carried are gone; the labels are what the design leans on.
const TABS: { id: Tab; label: string }[] = [
  { id: 'versions',   label: 'Versions'   },
  { id: 'diff',       label: 'Diff'       },
  { id: 'traffic',    label: 'Traffic'    },
  { id: 'calls',      label: 'Calls'      },
  { id: 'ab',         label: 'A/B'        },
  { id: 'playground', label: 'Playground' },
]

interface Props {
  params: { name: string }
}

export function PromptDetailClient({ params }: Props) {
  const name = decodeURIComponent(params.name)
  const router = useRouter()
  const sp = useSearchParams()

  // URL-backed tab — refresh keeps the active tab, deep-links from the list
  // (?tab=versions) land on the right pane.
  const tabParam = sp.get('tab') as Tab | null
  const tab: Tab = tabParam != null && VALID_TABS.includes(tabParam) ? tabParam : 'versions'
  function setTab(next: Tab) {
    const params = new URLSearchParams(sp.toString())
    if (next === 'versions') params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    router.replace(`/prompts/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`)
  }

  const { data: versions, isLoading } = usePromptVersions(name)
  const { data: experiments } = usePromptExperiments(name)

  const hasRunning = experiments?.some((e) => e.status === 'running') ?? false

  return (
    <div>
      {/* The topbar is the one full-bleed row: it cancels the shell inset so
          its hairline spans the whole main column. */}
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[
            { label: 'Prompts', href: '/prompts' },
            { label: name },
          ]}
          right={
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex items-center gap-1 font-mono text-[11px] text-text-muted transition-colors hover:text-text"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <PermissionGate need="edit">
                <button
                  type="button"
                  onClick={() => setTab('ab')}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold leading-[18px] text-accent-fg transition-colors hover:bg-accent-strong"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  {hasRunning ? 'Manage A/B' : 'New A/B test'}
                </button>
              </PermissionGate>
            </div>
          }
        />
        {/* The breadcrumb already names the prompt, which is why D4 has no
            second header row; the accessible heading stays for readers. */}
        <h1 className="sr-only">{name}</h1>
      </div>

      <Board>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="flex flex-col gap-4"
        >
          {/* Tab row with the version count and A/B state pushed right, the
              way D4 parks card meta at the end of a head row. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <TabsList className="flex-wrap">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                  {t.id === 'ab' && hasRunning && (
                    <span className="ml-1.5 block h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <span className="ml-auto font-mono text-[11px] leading-[1.45] text-text-faint">
              {isLoading
                ? 'Loading…'
                : `${versions?.length ?? 0} version${versions?.length === 1 ? '' : 's'}`}
            </span>
            {hasRunning && (
              <StatusPill variant="warn" className="animate-pulse">A/B running</StatusPill>
            )}
          </div>

          <TabsContent value="versions" className="mt-0">
            <VersionsTab name={name} versions={versions} isLoading={isLoading} />
          </TabsContent>
          <TabsContent value="diff" className="mt-0">
            <DiffTab versions={versions ?? []} />
          </TabsContent>
          <TabsContent value="traffic" className="mt-0">
            <TrafficTab name={name} />
          </TabsContent>
          <TabsContent value="calls" className="mt-0">
            <CallsTab name={name} />
          </TabsContent>
          <TabsContent value="ab" className="mt-0">
            <AbTab name={name} versions={versions ?? []} experiments={experiments ?? []} />
          </TabsContent>
          <TabsContent value="playground" className="mt-0">
            <PlaygroundTab versions={versions ?? []} />
          </TabsContent>
        </Tabs>
      </Board>
    </div>
  )
}
