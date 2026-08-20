'use client'
import { useMemo, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEvalRun, useEvalResults } from '@/lib/queries/use-evals'
import { fmtUsd, fmtScore, ciMargin95, scoreColor } from '../_shared/format'
import { StatusBadge } from '../_shared/status-badge'

// ── Run detail panel ─────────────────────────────────────────────────────────

/**
 * One row in "Lowest-scoring samples". Click to expand → shows full
 * reasoning (no line clamp) + a link to the source request when this row
 * came from production traffic. Dataset-source rows don't have a
 * /requests/[id] target — they expand to reasoning only since the
 * dataset item input isn't fetched here (would need a separate query).
 */
function LowestScoreRow({
  res,
}: {
  res: {
    id: string
    score: number
    reasoning: string | null
    judge_cost_usd: number
    request_id: string | null
    dataset_item_id: string | null
    /** P3-15: judge's raw answer (NUMERIC path); null/undefined for non-numeric. */
    value_raw_number?: number | null
  }
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setOpen((v) => !v)
        }
      }}
      className="block p-2 rounded-[5px] border border-border hover:bg-bg-muted transition-colors cursor-pointer"
    >
      <div className="flex justify-between items-center mb-1">
        <span className="font-mono text-[12px] text-text font-medium">
          {fmtScore(res.score)}
          {/* P3-15: judge's raw answer ("4" out of 5, not just normalised 0.8). */}
          {res.value_raw_number != null && (
            <span className="ml-1.5 text-text-faint text-[10px] font-normal tabular-nums">
              (raw {res.value_raw_number})
            </span>
          )}
        </span>
        <span className="font-mono text-[10px] text-text-faint">
          {fmtUsd(res.judge_cost_usd)}
        </span>
      </div>
      {res.reasoning && (
        <p className={`font-mono text-[10.5px] text-text-muted ${open ? '' : 'line-clamp-2'}`}>
          {res.reasoning}
        </p>
      )}
      {open && res.request_id && (
        <div className="mt-2 pt-2 border-t border-border">
          <a
            href={`/requests/${res.request_id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[10.5px] text-accent hover:underline"
          >
            → View source request
          </a>
        </div>
      )}
      {open && !res.request_id && res.dataset_item_id && (
        <div className="mt-2 pt-2 border-t border-border">
          <span className="font-mono text-[10.5px] text-text-faint">
            Dataset item · {res.dataset_item_id.slice(0, 8)}
          </span>
        </div>
      )}
    </div>
  )
}

export function RunDetailPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = useEvalRun(runId, { pollWhilePending: true })
  const results = useEvalResults(
    run.data?.status === 'completed' ? runId : null,
  )

  // Hooks must be called unconditionally — compute histBuckets even when
  // run.data is null, then early-return below.
  const histBuckets = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0] // 0-0.2, 0.2-0.4, ...
    for (const result of results.data ?? []) {
      const idx = Math.min(4, Math.floor(result.score * 5))
      buckets[idx] = (buckets[idx] ?? 0) + 1
    }
    return buckets
  }, [results.data])
  const maxBucket = Math.max(1, ...histBuckets)

  /*
   * The panel is a full-screen sheet on mobile and a card in the right-hand
   * column from md up, where it sticks below the 61px topbar as the table
   * scrolls past it.
   */
  const PANEL =
    'fixed inset-0 z-30 overflow-y-auto bg-bg md:sticky md:inset-x-auto md:bottom-auto md:top-[77px] md:z-auto md:max-h-[calc(100vh-93px)] md:w-[420px] md:shrink-0 md:rounded-card md:border md:border-border md:bg-bg-elev md:shadow-card'

  if (!run.data) {
    return (
      <div className={cn(PANEL, 'flex items-center justify-center py-10 text-text-faint')}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  const r = run.data

  return (
    <div className={PANEL}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-elev px-5 py-3.5 md:rounded-t-card">
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status} />
          <span className="font-mono text-[11px] text-text-muted tabular-nums">
            {r.scored_count}/{r.sample_size} scored
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close run detail"
          className="text-xs text-text-faint transition-colors hover:text-text"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4 p-5">
        {/* P2-11: trajectory runs score traces, not a prompt version. */}
        {r.trace_name && (
          <p className="font-mono text-[11px] text-text-muted">
            Trajectory · trace <span className="text-text">{r.trace_name}</span>
          </p>
        )}
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">
              {r.mode === 'pairwise' ? 'B win-rate' : 'Avg score'}
            </p>
            <p className={cn('font-mono text-[16px] font-medium tabular-nums', scoreColor(r.avg_score))}>{fmtScore(r.avg_score)}</p>
            {/* P1-7: 95% CI half-width so a small-sample average reads as less
                certain. Hidden when there's no interval (single sample / typed
                config without a mean / pre-migration row). For pairwise this is
                the CI on the win-rate. */}
            {(() => {
              const m = ciMargin95(r.score_stddev, r.scored_count)
              return m != null && r.avg_score != null ? (
                <p className="font-mono text-[9px] text-text-faint tabular-nums mt-0.5" title="95% confidence interval (±1.96·σ/√n)">
                  ±{(m * 100).toFixed(1)} · 95% CI
                </p>
              ) : null
            })()}
          </div>
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">
              {r.mode === 'pairwise' ? 'Comparisons' : 'Samples'}
            </p>
            <p className="font-mono text-[16px] text-text font-medium">{r.scored_count}</p>
          </div>
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">Cost</p>
            <p className="font-mono text-[16px] text-text font-medium">{fmtUsd(r.total_cost_usd)}</p>
            {/* P3-18: when judge_cache returned outcomes for some samples,
                show the hit count under the cost cell. We don't know the
                exact saved dollar amount from this row (only the original
                per-call cost was on the cache entry server-side), but the
                hit count alone tells the user "this re-run was cheaper". */}
            {r.cache_hits != null && r.cache_hits > 0 && (
              <p className="font-mono text-[9px] text-text-faint tabular-nums mt-0.5" title="Judge calls served from cache instead of hitting the LLM">
                {r.cache_hits} cached
              </p>
            )}
          </div>
        </div>

        {/* P1-7 (3/3): pairwise win/loss/tie breakdown. */}
        {r.mode === 'pairwise' && (r.b_wins != null || r.a_wins != null || r.ties != null) && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="px-2 py-1 rounded-[4px] bg-good/10 text-good border border-good/30">B wins {r.b_wins ?? 0}</span>
            <span className="px-2 py-1 rounded-[4px] bg-bad/10 text-bad border border-bad/30">A wins {r.a_wins ?? 0}</span>
            <span className="px-2 py-1 rounded-[4px] bg-bg-elev text-text-faint border border-border">Ties {r.ties ?? 0}</span>
          </div>
        )}

        {/* Scoring-rate warning (P0-2): when some judge calls failed, the avg
            reflects only the scored samples — say so instead of passing a
            partial average off as the full picture. */}
        {r.status === 'completed' && r.failed_count > 0 && r.attempted_count > 0 && (
          <div className="flex items-start gap-2 p-3 bg-warn-bg border border-warn/30 rounded-[5px] font-mono text-[11.5px] text-warn">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Scored {r.scored_count} of {r.attempted_count} attempted
              {' '}({Math.round((r.scored_count / r.attempted_count) * 100)}%).
              {' '}{r.failed_count} judge {r.failed_count === 1 ? 'call' : 'calls'} failed
              {' '}— the average reflects only the scored samples.
            </span>
          </div>
        )}

        {/* Running spinner */}
        {(r.status === 'pending' || r.status === 'running') && (
          <div className="flex items-center gap-2 p-3 bg-accent-bg border border-accent-border rounded-[5px] font-mono text-[11.5px] text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Scoring samples… polling every 2s
          </div>
        )}

        {/* Error */}
        {r.status === 'failed' && r.error && (
          <div className="flex items-start gap-2 p-3 bg-bad/10 border border-bad/30 rounded-[5px] font-mono text-[11.5px] text-bad">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{r.error}</span>
          </div>
        )}

        {/* P3-16: typed-config distribution summary. For CATEGORICAL / BOOLEAN
            it shows the count bars; for TEXT it shows up to 10 sample answers.
            Renders ONLY when the server precomputed the summary (typed configs);
            NUMERIC / legacy runs still get the per-sample histogram below. */}
        {r.status === 'completed' && r.distribution && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">
              {r.distribution.type === 'text' ? 'Sample answers' : 'Distribution'}
            </p>
            {(r.distribution.type === 'categorical' || r.distribution.type === 'boolean') && (() => {
              const counts: Record<string, number> = r.distribution.type === 'boolean'
                ? { true: r.distribution.counts.true, false: r.distribution.counts.false }
                : r.distribution.counts
              const entries = Object.entries(counts)
              const max = Math.max(1, ...entries.map(([, n]) => n))
              return (
                <div className="space-y-1">
                  {entries.map(([k, n]) => (
                    <div key={k} className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="w-[100px] truncate text-text-muted" title={k}>{k}</span>
                      <div className="flex-1 h-4 bg-bg-elev rounded-[2px] overflow-hidden">
                        <div className="h-full bg-text/70" style={{ width: `${(n / max) * 100}%` }} />
                      </div>
                      <span className="w-[40px] text-right tabular-nums text-text-faint">{n}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
            {r.distribution.type === 'text' && (
              <div className="space-y-1.5">
                <p className="font-mono text-[10.5px] text-text-faint">
                  Showing {r.distribution.samples.length} of {r.distribution.count} scored.
                </p>
                {r.distribution.samples.map((s, i) => (
                  <div key={i} className="font-mono text-[11px] text-text-muted bg-bg-elev rounded-[3px] px-2 py-1.5 line-clamp-3">{s}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Histogram — NUMERIC / legacy path. distribution wins for typed configs. */}
        {r.status === 'completed' && !r.distribution && results.data && results.data.length > 0 && (
          <>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">
                Score distribution
              </p>
              <div className="flex items-end gap-1 h-20">
                {histBuckets.map((c, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-text/70 rounded-[2px]"
                      style={{ height: `${(c / maxBucket) * 60}px` }}
                    />
                    <span className="font-mono text-[9px] text-text-faint">{c}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-mono text-[9px] text-text-faint mt-1">
                <span>0</span><span>0.2</span><span>0.4</span><span>0.6</span><span>0.8</span><span>1</span>
              </div>
            </div>

            {/* Samples — bottom-5 by default, toggle to see all 12 */}
            <SampleList samples={results.data} />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Eval results sorted ascending by score (server enforces, see
 * apps/server/src/api/evals.ts). We show the worst 5 by default —
 * that's where prompt-engineering effort pays off — with a toggle to
 * reveal every scored sample for the curious. Avoids the confusion
 * users hit when the visible 5 don't reconcile with the panel's
 * average score (the hidden samples are higher and pull avg up).
 */
function SampleList({
  samples,
}: {
  samples: Array<{ id: string; score: number; reasoning: string | null; judge_cost_usd: number; request_id: string | null; dataset_item_id: string | null }>
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? samples : samples.slice(0, 5)
  const total = samples.length
  const moreCount = total - 5

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">
        {showAll
          ? `All samples · ${total}`
          : `Lowest-scoring · ${Math.min(5, total)} of ${total}`}
      </p>
      <div className="space-y-2">
        {visible.map((res) => (
          <LowestScoreRow key={res.id} res={res} />
        ))}
      </div>
      {moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full mt-2 py-2 font-mono text-[10.5px] text-accent hover:bg-bg-muted rounded-[5px] border border-dashed border-border transition-colors"
        >
          {showAll ? 'show less' : 'show all'}
        </button>
      )}
    </div>
  )
}
