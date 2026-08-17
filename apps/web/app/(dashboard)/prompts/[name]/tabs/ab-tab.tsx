'use client'
import { useState } from 'react'
import { FlaskConical, StopCircle, Trophy } from 'lucide-react'
import {
  usePromptExperiment,
  useCreateExperiment,
  useUpdateExperiment,
  type PromptVersion,
  type PromptExperiment,
} from '@/lib/queries/use-prompts'
import { PermissionGate } from '@/components/permission-gate'
import { Card } from '@/components/ui/card'
import { cn, formatDate } from '@/lib/utils'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { StatusPill } from '@/components/ui/primitives'
import { TableCard, TableHead, Th, ROW } from '../../../_board/surfaces'

/* Experiment lifecycle to pill colour: an in-flight run reads as caution, a
   settled one as resolved, and a stopped one as inert. */
function statusTone(status: string): 'good' | 'warn' | 'neutral' {
  if (status === 'running') return 'warn'
  if (status === 'concluded') return 'good'
  return 'neutral'
}

interface Props {
  name: string
  versions: PromptVersion[]
  experiments: PromptExperiment[]
}

// D4's A-B card is a four-column ledger: metric name, challenger value,
// control value, delta. The challenger leads because the head reads
// "v4 against v3" — the version under test first, the incumbent behind it.
const AB_GRID: React.CSSProperties = {
  gridTemplateColumns: '120px minmax(0,1fr) minmax(0,1fr) 80px',
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}
function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}
function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}
function fmtLift(lift: number | null): string {
  if (lift == null) return '—'
  const sign = lift > 0 ? '+' : ''
  return `${sign}${(lift * 100).toFixed(1)}%`
}

/* Lower is better for every metric the experiment tracks, so a negative lift
   reads good and a positive one reads bad. */
function liftTone(lift: number | null | undefined): string {
  if (lift == null) return 'text-text-faint'
  if (lift < -0.01) return 'text-good'
  if (lift > 0.01) return 'text-bad'
  return 'text-text-faint'
}

/** One line of the A-B ledger. */
function MetricRow({
  label,
  challenger,
  control,
  delta,
  deltaClass,
}: {
  label: string
  challenger: string
  control: string
  delta?: string
  deltaClass?: string
}) {
  return (
    <div
      className="grid items-center gap-3 border-b border-border py-[9px] last:border-b-0"
      style={AB_GRID}
    >
      <span className="text-[12px] font-medium leading-[1.45] text-text-muted">{label}</span>
      <span className="font-mono text-[12.5px] leading-[1.45] tabular-nums text-text">{challenger}</span>
      <span className="font-mono text-[12.5px] leading-[1.45] tabular-nums text-text-muted">{control}</span>
      <span className={cn('text-right text-[12px] font-semibold leading-[1.45] tabular-nums', deltaClass ?? 'text-text-faint')}>
        {delta ?? ''}
      </span>
    </div>
  )
}

// ── Create experiment form ────────────────────────────────────────────────────

interface CreateFormProps {
  name: string
  versions: PromptVersion[]
  onDone: () => void
}

function CreateExperimentForm({ name, versions, onDone }: CreateFormProps) {
  const createMutation = useCreateExperiment()
  const sorted = [...versions].sort((a, b) => b.version - a.version)

  const [vA, setVA] = useState(sorted[1]?.id ?? '')
  const [vB, setVB] = useState(sorted[0]?.id ?? '')
  const [split, setSplit] = useState(50)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    if (!vA || !vB) { setError('Select both versions'); return }
    if (vA === vB) { setError('Version A and B must differ'); return }
    try {
      await createMutation.mutateAsync({
        promptName: name,
        versionAId: vA,
        versionBId: vB,
        trafficSplit: split,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create experiment')
    }
  }

  const versionLabel = (v: PromptVersion) =>
    `v${v.version}, ${formatDate(v.created_at)}`

  return (
    <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-accent" />
        <span className="text-[13.5px] font-semibold leading-[1.4] text-text">New A/B experiment</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="micro-label tracking-[0.1em]">Version A (control)</label>
          <Select {...(vA ? { value: vA } : {})} onValueChange={setVA}>
            <SelectTrigger className="h-[34px] rounded-md"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sorted.map((v) => <SelectItem key={v.id} value={v.id}>{versionLabel(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="micro-label tracking-[0.1em]">Version B (challenger)</label>
          <Select {...(vB ? { value: vB } : {})} onValueChange={setVB}>
            <SelectTrigger className="h-[34px] rounded-md"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sorted.map((v) => <SelectItem key={v.id} value={v.id}>{versionLabel(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="micro-label tracking-[0.1em]" htmlFor="ab-split">Traffic split (A / B)</label>
          <span className="font-mono text-[11px] tabular-nums text-text">{split}% / {100 - split}%</span>
        </div>
        <input
          id="ab-split"
          type="range"
          min={10}
          max={90}
          step={5}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <div className="flex justify-between font-mono text-[10px] text-text-faint">
          <span>10% A</span>
          <span>50/50</span>
          <span>90% A</span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-bg-sunk px-3.5 py-3 font-mono text-[11px] leading-[1.65] text-text-muted">
        <span className="text-accent">@latest</span> requests are routed deterministically:{' '}
        <span className="text-text">{split}%</span> to version A and{' '}
        <span className="text-text">{100 - split}%</span> to version B.
        Explicit version pins bypass the experiment.
      </div>

      {error && <p className="font-mono text-[11.5px] text-bad">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-full border border-border px-3 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={createMutation.isPending}
          className="rounded-full bg-accent px-3.5 py-1.5 text-[11.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:opacity-40"
        >
          {createMutation.isPending ? 'Starting…' : 'Start experiment'}
        </button>
      </div>
    </Card>
  )
}

// ── Running experiment results ─────────────────────────────────────────────────

interface ResultsProps {
  experimentId: string
  versions: PromptVersion[]
}

function ExperimentResults({ experimentId, versions }: ResultsProps) {
  const { data, isLoading } = usePromptExperiment(experimentId)
  const updateMutation = useUpdateExperiment()
  const [concluding, setConcluding] = useState(false)

  const versionMap = new Map(versions.map((v) => [v.id, v]))

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-card bg-bg-chip" />)}
      </div>
    )
  }

  const { experiment: exp, stats } = data
  const vA = versionMap.get(exp.version_a_id)
  const vB = versionMap.get(exp.version_b_id)
  const labelA = vA ? `v${vA.version}` : 'A'
  const labelB = vB ? `v${vB.version}` : 'B'
  const totalSamples = stats.armA.samples + stats.armB.samples

  async function handleStop() {
    if (!confirm('Stop this experiment?')) return
    await updateMutation.mutateAsync({ id: exp.id, status: 'stopped' })
  }

  async function handleConclude(winnerId: string) {
    setConcluding(true)
    try {
      await updateMutation.mutateAsync({ id: exp.id, status: 'concluded', winnerVersionId: winnerId })
    } finally {
      setConcluding(false)
    }
  }

  const canConclude = exp.status === 'running'
  const sig = stats.significance

  return (
    <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
      {/* Head: title on the left, run meta pushed right, per D4. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13.5px] font-semibold leading-[1.45] text-text">
          {labelB} against {labelA}
        </span>
        <StatusPill variant={statusTone(exp.status)}>{exp.status}</StatusPill>
        <span className="ml-auto font-mono text-[11px] leading-[1.45] text-text-faint">
          started {formatDate(exp.started_at)} · {totalSamples.toLocaleString()} requests
          {exp.concluded_at ? ` · concluded ${formatDate(exp.concluded_at)}` : ''}
        </span>
        {exp.status === 'running' && (
          <PermissionGate need="edit">
            <button
              type="button"
              onClick={() => void handleStop()}
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:text-text disabled:opacity-40"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Stop
            </button>
          </PermissionGate>
        )}
      </div>

      {exp.winner_version_id && (
        <div className="flex items-center gap-2 rounded-lg bg-good-bg px-3.5 py-2.5">
          <Trophy className="h-4 w-4 text-good" />
          <span className="font-mono text-[12px] text-good">
            Winner: v{versionMap.get(exp.winner_version_id)?.version ?? '?'}
          </span>
        </div>
      )}

      {/* Column key. D4 leaves the two value columns unlabelled because its
          head names them; two bare number columns need naming here since the
          control and challenger versions are not otherwise distinguishable. */}
      <div className="grid items-center gap-3 border-b border-border pb-2" style={AB_GRID}>
        <Th />
        <Th>{labelB} · challenger</Th>
        <Th>{labelA} · control</Th>
        <Th className="block text-right">Delta</Th>
      </div>

      <div className="flex flex-col">
        <MetricRow
          label="samples"
          challenger={stats.armB.samples.toLocaleString()}
          control={stats.armA.samples.toLocaleString()}
        />
        <MetricRow
          label="error rate"
          challenger={fmtPct(stats.armB.errorRate)}
          control={fmtPct(stats.armA.errorRate)}
          delta={fmtLift(sig.errorRate.relativeLift)}
          deltaClass={liftTone(sig.errorRate.relativeLift)}
        />
        <MetricRow
          label="avg latency"
          challenger={fmtMs(stats.armB.avgLatencyMs)}
          control={fmtMs(stats.armA.avgLatencyMs)}
          delta={fmtLift(sig.latency.relativeLift)}
          deltaClass={liftTone(sig.latency.relativeLift)}
        />
        <MetricRow
          label="avg cost"
          challenger={stats.armB.avgCostUsd > 0 ? fmtUsd(stats.armB.avgCostUsd) : '—'}
          control={stats.armA.avgCostUsd > 0 ? fmtUsd(stats.armA.avgCostUsd) : '—'}
          delta={fmtLift(sig.cost.relativeLift)}
          deltaClass={liftTone(sig.cost.relativeLift)}
        />
      </div>

      {/* Statistical significance */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-bg-sunk px-3.5 py-3">
        <p className="micro-label tracking-[0.1em]">Statistical significance</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {[
            { label: 'Error rate', stat: sig.errorRate },
            { label: 'Latency',    stat: sig.latency   },
            { label: 'Cost',       stat: sig.cost      },
          ].map(({ label, stat }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-text-muted">{label}</span>
              <StatusPill variant={stat.significant ? 'good' : 'neutral'}>
                p={stat.pValue.toFixed(3)}{stat.significant ? ' ✓' : ''}
              </StatusPill>
            </div>
          ))}
        </div>
        {(stats.armA.samples < 30 || stats.armB.samples < 30) && (
          <p className="font-mono text-[10.5px] text-text-faint">
            Significance testing needs at least 30 samples per arm. Currently A={stats.armA.samples},
            B={stats.armB.samples}.
          </p>
        )}
      </div>

      {canConclude && !exp.winner_version_id && (
        <PermissionGate need="edit">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {[
              { vid: exp.version_b_id, label: labelB },
              { vid: exp.version_a_id, label: labelA },
            ].map(({ vid, label }) => (
              <button
                key={vid}
                type="button"
                onClick={() => void handleConclude(vid)}
                disabled={concluding}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
              >
                <Trophy className="h-3 w-3" />
                Declare {label} winner
              </button>
            ))}
          </div>
        </PermissionGate>
      )}
    </Card>
  )
}

// ── Main A/B tab ──────────────────────────────────────────────────────────────

const PAST_GRID: React.CSSProperties = {
  gridTemplateColumns: '110px minmax(0,1fr) 140px',
}

export function AbTab({ name, versions, experiments }: Props) {
  const [showCreate, setShowCreate] = useState(false)

  const runningExp = experiments.find((e) => e.status === 'running')
  const pastExps = experiments.filter((e) => e.status !== 'running')

  if (versions.length < 2 && !runningExp) {
    return (
      <div className="card-surface rounded-card flex h-48 flex-col items-center justify-center gap-3 text-text-muted">
        <FlaskConical className="h-8 w-8 text-text-faint" />
        <p className="text-[12.5px]">Two versions are needed before an A/B experiment can run.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Running experiment */}
      {runningExp ? (
        <ExperimentResults experimentId={runningExp.id} versions={versions} />
      ) : !showCreate ? (
        <PermissionGate
          need="edit"
          fallback={
            <div className="card-surface rounded-card flex h-32 flex-col items-center justify-center gap-2 text-text-muted">
              <p className="text-[12.5px]">No active experiment. Ask an editor to start one.</p>
            </div>
          }
        >
          <div className="card-surface rounded-card flex h-32 flex-col items-center justify-center gap-3">
            <p className="text-[12.5px] text-text-muted">No active experiment for this prompt.</p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Start A/B experiment
            </button>
          </div>
        </PermissionGate>
      ) : (
        <CreateExperimentForm
          name={name}
          versions={versions}
          onDone={() => setShowCreate(false)}
        />
      )}

      {/* Past experiments */}
      {pastExps.length > 0 && (
        <TableCard>
          <TableHead>
            <div className="grid items-center gap-3" style={PAST_GRID}>
              <Th>Status</Th>
              <Th>Run</Th>
              <Th className="block text-right">Outcome</Th>
            </div>
          </TableHead>
          {pastExps.map((exp) => (
            <div key={exp.id} className={cn(ROW, 'grid items-center gap-3')} style={PAST_GRID}>
              <span>
                <StatusPill variant={statusTone(exp.status)}>{exp.status}</StatusPill>
              </span>
              <span className="font-mono text-[12px] text-text-muted">
                started {formatDate(exp.started_at)}
                {exp.concluded_at && ` · concluded ${formatDate(exp.concluded_at)}`}
              </span>
              <span className="flex items-center justify-end gap-1 font-mono text-[12px]">
                {exp.winner_version_id ? (
                  <>
                    <Trophy className="h-3 w-3 text-good" />
                    <span className="text-good">winner decided</span>
                  </>
                ) : (
                  <span className="text-text-faint">no winner</span>
                )}
              </span>
            </div>
          ))}
        </TableCard>
      )}
    </div>
  )
}
