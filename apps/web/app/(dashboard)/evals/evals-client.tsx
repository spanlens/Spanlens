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
import { useMounted } from './_shared/use-mounted'
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
  const distinctJudges  = new Set(list.map((ev) => ev.config.judge_model)).size
  const archivedCount   = list.filter((ev) => ev.archived_at != null).length

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
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
                className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                New evaluator
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Evals</h1>
      </div>

      {/* Stat strip — counts that are derivable from the evaluator list
          itself. Per-evaluator run / cost / score totals stay inside each
          row to avoid an n+1 fetch just to populate the strip. */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-4 min-w-[480px]">
          {[
            { label: 'Evaluators',       value: String(list.length) },
            { label: 'Distinct prompts', value: String(distinctPrompts) },
            { label: 'Distinct judges',  value: String(distinctJudges) },
            { label: 'Archived',         value: String(archivedCount) },
          ].map((s, i) => (
            <div key={s.label} className={cn('px-[18px] py-[14px]', i < 3 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className="text-[24px] font-medium leading-none tracking-[-0.6px] tabular-nums text-text">
                {mounted ? s.value : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tab strip: Evaluators (definitions) vs Results (runs) */}
      <div className="shrink-0 border-b border-border bg-bg flex items-center gap-1 px-[22px]">
        {(['evaluators', 'results'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.06em] px-3 py-2.5 transition-colors relative',
              tab === t ? 'text-text' : 'text-text-faint hover:text-text-muted',
            )}
          >
            {t === 'evaluators' ? 'Evaluators' : 'Results'}
            {tab === t && (
              <span className="absolute bottom-[-1px] left-3 right-3 h-[2px] bg-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-w-0">
          {tab === 'results' ? (
            <RunsView
              evaluatorsById={evaluatorsById}
              onSelectRun={setSelectedRunId}
              selectedRunId={selectedRunId}
            />
          ) : (
          <>
          {/* Info banner with docs link */}
          <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted flex-wrap">
            <Beaker className="h-3.5 w-3.5 shrink-0" />
            <span>
              LLM-as-judge scores production responses against a criterion you define.
              Cost is billed to your provider key.
            </span>
            <Link
              href="/docs/features/evals"
              className="text-text hover:opacity-80 transition-opacity ml-auto"
            >
              How evals work →
            </Link>
          </div>

          {/* Search bar */}
          <div className="px-[22px] py-[10px] border-b border-border flex items-center gap-2">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchInput('')
                    updateQuery({ q: null })
                  }
                }}
                placeholder="Search evaluator or prompt name…"
                className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
              />
            </div>
            {search && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                className="font-mono text-[11px] text-text-faint hover:text-text transition-colors"
              >
                Clear
              </button>
            )}
            <span className="flex-1" />
            <span className="font-mono text-[11px] text-text-faint">
              {mounted ? (filtered.length === list.length ? `${list.length} evaluators` : `${filtered.length} of ${list.length}`) : ' '}
            </span>
          </div>

          {/* Correlation card, appears only if Annotation has paired samples */}
          {list.length > 0 && <CorrelationRow evaluators={list} />}

          {evaluators.isLoading ? (
            <div className="p-[22px] space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-6 text-text-muted px-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Beaker className="h-9 w-9 text-text-faint" />
                <p className="text-[13px] text-text">Start with a template</p>
                <p className="font-mono text-[11.5px] text-text-faint max-w-[400px]">
                  Pre-filled criteria you can tune. Pick a prompt, edit the scoring rule, and run.
                </p>
              </div>

              <div className="w-full max-w-[820px] space-y-4">
                {/* Category tabs — every tab is always visible so the user
                    knows the catalogue spans more than the default bucket
                    they're staring at. */}
                <div className="flex items-center gap-1 border-b border-border">
                  {(['quality', 'safety', 'cost'] as const).map((cat) => {
                    const count = templatesByCategory[cat].length
                    const isActive = activeCategory === cat
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setActiveCategory(cat)}
                        className={cn(
                          'relative px-3 py-2 text-[12.5px] font-medium transition-colors -mb-px border-b-2',
                          isActive
                            ? 'border-accent text-text'
                            : 'border-transparent text-text-faint hover:text-text-muted',
                        )}
                      >
                        {CATEGORY_LABELS[cat]}
                        <span className="ml-1.5 font-mono text-[10.5px] text-text-faint">
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="font-mono text-[11px] text-text-faint">
                  {CATEGORY_HELP[activeCategory]}
                </p>

                {templatesByCategory.isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-[120px] bg-bg-elev rounded-[6px] animate-pulse" />
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
                        className="text-left p-4 rounded-[6px] border border-border bg-bg hover:bg-bg-elev hover:border-border-strong transition-colors group"
                      >
                        <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-2">
                          Template · {t.recommended_judge_model}
                        </div>
                        <div className="text-[13px] font-medium text-text mb-1.5">{t.name}</div>
                        <p className="text-[11.5px] text-text-muted leading-relaxed">{t.description}</p>
                        <div className="font-mono text-[10.5px] text-text-faint mt-3 flex items-center gap-1 group-hover:text-text transition-colors">
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
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-text-muted">
              <p className="font-mono text-[12.5px]">No evaluators match the current search.</p>
              <button
                type="button"
                onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                <span className="flex-1">Evaluator</span>
                <span className="w-[100px] text-right">Avg score</span>
                <span className="w-[80px] text-right">Runs</span>
                <span className="w-[150px]" />
              </div>
              {filtered.map((ev) => (
                <EvaluatorRow
                  key={ev.id}
                  evaluator={ev}
                  onRun={(e) => setRunDialog(e)}
                  onSelectRun={(rid) => setSelectedRunId(rid)}
                />
              ))}
            </>
          )}
          </>
          )}
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
