'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Beaker, Plus, Search } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { useEvaluators, type Evaluator } from '@/lib/queries/use-evals'
import {
  useEvaluatorTemplatesByCategory,
  type EvaluatorTemplateCategory,
} from '@/lib/queries/use-evaluator-templates'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Board,
  FilterBar,
  StatCard,
  TableCard,
  TableHead,
  Th,
  tabClass,
  CONTROL,
  TOPBAR_BLEED,
} from '../_board/surfaces'
import { useMounted } from './_shared/use-mounted'
import { EVAL_GRID } from './_shared/table'
import {
  templateFromDb,
  CATEGORY_LABELS,
  CATEGORY_HELP,
  type EvaluatorTemplate,
} from './_shared/templates'
// Rendered in the evaluators list on first paint — static imports.
import { EvaluatorRow } from './_sections/evaluator-row'
import { CorrelationRow } from './_sections/correlation'

// Deferred surfaces. None of them are on screen when /evals opens on the
// default "Evaluators" tab, so their code (Paddle-free but query- and
// form-heavy) is pulled on first use instead of shipping in the page chunk:
//   · RunsView          — only when ?tab=results
//   · RunDetailPanel    — only when ?run=<id>
//   · RunEvaluatorDialog— only after "Run" is clicked
//   · NewEvaluatorDialog— always mounted but renders nothing until `open`;
//                         it is by far the largest component on the page, so
//                         deferring its chunk (and the prompts / models /
//                         datasets / score-config queries it owns) keeps them
//                         off the critical path. `loading: () => null` keeps
//                         the closed-dialog DOM identical to before.
const RunsView = dynamic(
  () => import('./_sections/runs-view').then((m) => m.RunsView),
  { ssr: false, loading: () => null },
)
const RunDetailPanel = dynamic(
  () => import('./_sections/run-detail-panel').then((m) => m.RunDetailPanel),
  { ssr: false, loading: () => null },
)
const NewEvaluatorDialog = dynamic(
  () => import('./_sections/new-evaluator/dialog').then((m) => m.NewEvaluatorDialog),
  { ssr: false, loading: () => null },
)
const RunEvaluatorDialog = dynamic(
  () => import('./_sections/run-evaluator-dialog').then((m) => m.RunEvaluatorDialog),
  { ssr: false, loading: () => null },
)

// ── Main page ────────────────────────────────────────────────────────────────

export function EvalsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  const evaluators = useEvaluators()
  const templatesByCategory = useEvaluatorTemplatesByCategory()
  const [newOpen, setNewOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<EvaluatorTemplate | undefined>(undefined)
  // Incremented on every open call so the dialog remounts with fresh useState
  // initializers — avoids prop-to-state syncing via useEffect.
  const [dialogSession, setDialogSession] = useState(0)
  const [runDialog, setRunDialog] = useState<Evaluator | null>(null)
  const [activeCategory, setActiveCategory] = useState<EvaluatorTemplateCategory>('quality')

  function openNewEvaluator(template?: EvaluatorTemplate) {
    setPendingTemplate(template)
    setNewOpen(true)
    setDialogSession((v) => v + 1)
  }
  function closeNewEvaluator() {
    setNewOpen(false)
    setPendingTemplate(undefined)
  }

  // URL-backed state — run pane survives reload, search is shareable.
  const selectedRunId = sp.get('run')
  const search = sp.get('q') ?? ''
  const tabParam = sp.get('tab')
  const tab: 'evaluators' | 'results' = tabParam === 'results' ? 'results' : 'evaluators'
  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/evals?${next.toString()}`)
  }
  function setSelectedRunId(id: string | null) { updateQuery({ run: id }) }
  function clearRun() { updateQuery({ run: null }) }
  function setTab(t: 'evaluators' | 'results') {
    updateQuery({ tab: t === 'evaluators' ? null : t, run: null })
  }

  const evaluatorsById = useMemo(() => {
    const m = new Map<string, Evaluator>()
    for (const ev of evaluators.data ?? []) m.set(ev.id, ev)
    return m
  }, [evaluators.data])

  // Search input — debounced 300ms to URL so each keystroke doesn't push.
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const list = useMemo(() => evaluators.data ?? [], [evaluators.data])
  const filtered = useMemo(() => {
    if (!search) return list
    const needle = search.toLowerCase()
    return list.filter((ev) =>
      ev.name.toLowerCase().includes(needle) ||
      ev.prompt_name.toLowerCase().includes(needle),
    )
  }, [list, search])

  // Stat-strip values — only metadata that's derivable from the evaluator
  // list itself. Per-evaluator runs / cost / score live in the row's own
  // useEvalRuns query; pulling them up here would require an n+1 round
  // trip just for the strip, so we skip.
  const distinctPrompts = new Set(list.map((ev) => ev.prompt_name)).size
  const judgeModels     = [...new Set(list.map((ev) => ev.config.judge_model))]
  const distinctJudges  = judgeModels.length
  const archivedCount   = list.filter((ev) => ev.archived_at != null).length
  // Foot line for the judges tile: name the first two, then count the rest.
  const judgeSummary = judgeModels.length === 0
    ? 'none configured'
    : judgeModels.slice(0, 2).join(', ') +
      (judgeModels.length > 2 ? ` +${judgeModels.length - 2} more` : '')

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[{ label: 'Evals' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={evaluators.isFetching} />
              <button
                type="button"
                onClick={() => void evaluators.refetch()}
                disabled={evaluators.isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', evaluators.isFetching && 'animate-spin')}>↻</span>
              </button>
              <button
                type="button"
                onClick={() => openNewEvaluator()}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
              >
                <Plus className="h-3.5 w-3.5" />
                New evaluator
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Evals</h1>
      </div>

      <div className="flex flex-col items-start gap-4 md:flex-row">
        <div className="min-w-0 flex-1">
          <Board>
          {/* Tab strip: Evaluators (definitions) vs Results (runs) */}
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as 'evaluators' | 'results')}
            className="flex flex-col gap-4"
          >
            <TabsList>
              <TabsTrigger value="evaluators">Evaluators</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
            </TabsList>

            <TabsContent value="results" className="mt-0">
              <RunsView
                evaluatorsById={evaluatorsById}
                onSelectRun={setSelectedRunId}
                selectedRunId={selectedRunId}
              />
            </TabsContent>

            <TabsContent value="evaluators" className="mt-0 flex flex-col gap-4">
          {/* Filter bar — search field runs the width of the row, with the
              result count parked at the end the way the boards show it. */}
          <FilterBar>
            <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
              <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchInput('')
                    updateQuery({ q: null })
                  }
                }}
                placeholder="Search evaluator or prompt name"
                aria-label="Search evaluator or prompt name"
                className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                  className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
                >
                  Clear
                </button>
              )}
            </div>
            <span className="font-mono text-[11px] text-text-faint">
              {mounted ? (filtered.length === list.length ? `${list.length} evaluators` : `${filtered.length} of ${list.length}`) : ' '}
            </span>
          </FilterBar>

          {/* Stat strip — counts that are derivable from the evaluator list
              itself. Per-evaluator run / cost / score totals stay inside each
              row to avoid an n+1 fetch just to populate the strip. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Evaluators"
              value={mounted ? list.length : ' '}
              foot={`${list.length - archivedCount} active`}
            />
            <StatCard
              label="Distinct prompts"
              value={mounted ? distinctPrompts : ' '}
              foot="covered by an eval"
            />
            <StatCard
              label="Distinct judges"
              value={mounted ? distinctJudges : ' '}
              foot={mounted ? judgeSummary : ' '}
            />
            <StatCard
              label="Archived"
              value={mounted ? archivedCount : ' '}
              foot="hidden from the list"
            />
          </div>

          {/* Explainer with docs link */}
          <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
            <Beaker className="h-3.5 w-3.5 shrink-0" />
            <span>
              LLM-as-judge scores production responses against a criterion you define.
              Cost is billed to your provider key.
            </span>
            <Link
              href="/docs/features/evals"
              className="ml-auto text-text transition-opacity hover:opacity-80"
            >
              How evals work →
            </Link>
          </div>

          {/* Correlation card, appears only if Annotation has paired samples */}
          {list.length > 0 && <CorrelationRow evaluators={list} />}

          {evaluators.isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-14 bg-bg-chip rounded-card animate-pulse" />)}
            </div>
          ) : list.length === 0 ? (
            <div className="card-surface rounded-card flex flex-col items-center gap-6 px-5 py-12 text-text-muted">
              <div className="flex flex-col items-center gap-2 text-center">
                <Beaker className="h-9 w-9 text-text-faint" />
                <p className="text-[13.5px] font-semibold leading-[1.45] text-text">
                  Start with a template
                </p>
                <p className="max-w-[440px] text-[12.5px] leading-[1.6] text-text-muted">
                  Pre-filled criteria you can tune. Pick a prompt, edit the scoring rule, and run.
                </p>
              </div>

              <div className="w-full max-w-[820px] space-y-4">
                {/* Category tabs — every tab is always visible so the user
                    knows the catalogue spans more than the default bucket
                    they're staring at. */}
                <div className="flex items-center justify-center gap-1">
                  {(['quality', 'safety', 'cost'] as const).map((cat) => {
                    const count = templatesByCategory[cat].length
                    const isActive = activeCategory === cat
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setActiveCategory(cat)}
                        aria-pressed={isActive}
                        className={tabClass(isActive)}
                      >
                        {CATEGORY_LABELS[cat]}
                        <span
                          className={cn(
                            'ml-1.5 font-mono text-[10.5px]',
                            isActive ? 'text-primary-foreground/70' : 'text-text-faint',
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="text-center font-mono text-[11px] text-text-faint">
                  {CATEGORY_HELP[activeCategory]}
                </p>

                {templatesByCategory.isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-[120px] bg-bg-chip rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : templatesByCategory[activeCategory].length === 0 ? (
                  <div className="font-mono text-[11.5px] text-text-faint py-6 text-center">
                    No templates in this category yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {templatesByCategory[activeCategory].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openNewEvaluator(templateFromDb(t))}
                        className="group rounded-lg border border-border bg-bg-sunk p-4 text-left transition-colors hover:border-border-strong hover:bg-bg-muted"
                      >
                        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">
                          Template · {t.recommended_judge_model}
                        </div>
                        <div className="mb-1.5 text-[13.5px] font-semibold leading-[1.45] text-text">
                          {t.name}
                        </div>
                        <p className="text-[12.5px] leading-[1.6] text-text-muted">{t.description}</p>
                        <div className="mt-3 flex items-center gap-1 font-mono text-[10.5px] text-text-faint transition-colors group-hover:text-text">
                          <Plus className="h-3 w-3" />
                          Use template
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 font-mono text-[11px] text-text-faint">
                <button
                  type="button"
                  onClick={() => openNewEvaluator()}
                  className="text-text-muted hover:text-text underline underline-offset-2"
                >
                  Or start blank
                </button>
                <span>·</span>
                <Link
                  href="/docs/features/evals"
                  className="text-text-muted hover:text-text underline underline-offset-2"
                >
                  How evals work
                </Link>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-surface rounded-card flex h-40 flex-col items-center justify-center gap-3 text-text-muted">
              <p className="text-[12.5px]">No evaluators match the current search.</p>
              <button
                type="button"
                onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            /* The row grid is wider than a narrow viewport, so the card scrolls
               its own table sideways rather than the page. */
            <TableCard>
              <div className="overflow-x-auto">
                <div className="min-w-[1000px]">
                  <TableHead>
                    <div className="grid items-center gap-3" style={EVAL_GRID}>
                      <Th>Evaluator</Th>
                      <Th>Prompt</Th>
                      <Th>Judge</Th>
                      <Th>Runs</Th>
                      <Th>Avg score</Th>
                      <Th>Last run</Th>
                      <Th>Status</Th>
                      <Th><span className="sr-only">Actions</span></Th>
                    </div>
                  </TableHead>
                  {filtered.map((ev) => (
                    <EvaluatorRow
                      key={ev.id}
                      evaluator={ev}
                      onRun={(e) => setRunDialog(e)}
                      onSelectRun={(rid) => setSelectedRunId(rid)}
                    />
                  ))}
                </div>
              </div>
            </TableCard>
          )}
            </TabsContent>
          </Tabs>
          </Board>
        </div>

        {selectedRunId && (
          <RunDetailPanel runId={selectedRunId} onClose={clearRun} />
        )}
      </div>

      <NewEvaluatorDialog
        key={dialogSession}
        open={newOpen}
        onClose={closeNewEvaluator}
        {...(pendingTemplate ? { initialTemplate: pendingTemplate } : {})}
      />

      {runDialog && (
        <RunEvaluatorDialog
          evaluator={runDialog}
          onClose={() => setRunDialog(null)}
          onRunCreated={(rid) => {
            setRunDialog(null)
            setSelectedRunId(rid)
          }}
        />
      )}
    </div>
  )
}
