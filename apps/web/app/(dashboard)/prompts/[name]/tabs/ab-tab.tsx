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
import { cn } from '@/lib/utils'

interface Props {
  name: string
  versions: PromptVersion[]
  experiments: PromptExperiment[]
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

function PValueBadge({ p, significant }: { p: number; significant: boolean }) {
  return (
    <span className={cn(
      'font-mono text-[10px] px-[5px] py-[1px] rounded-[3px]',
      significant
        ? 'bg-good/10 border border-good/30 text-good'
        : 'bg-bg-muted border border-border text-text-faint',
    )}>
      p={p.toFixed(3)} {significant ? '✓' : ''}
    </span>
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
    `v${v.version} — ${new Date(v.created_at).toLocaleDateString()}`

  return (
    <div className="bg-bg-elev border border-border rounded-[8px] p-[18px] space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-accent" />
        <span className="font-mono text-[12.5px] font-medium text-text">New A/B experiment</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Version A (control)</label>
          <select
            value={vA}
            onChange={(e) => setVA(e.target.value)}
            className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
          >
            {sorted.map((v) => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Version B (challenger)</label>
          <select
            value={vB}
            onChange={(e) => setVB(e.target.value)}
            className="w-full h-8 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
          >
            {sorted.map((v) => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Traffic split (A / B)</label>
          <span className="font-mono text-[11px] text-text">{split}% / {100 - split}%</span>
        </div>
        <input
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

      <div className="bg-bg rounded-[5px] border border-border p-3 font-mono text-[11px] text-text-muted">
        <span className="text-accent">@latest</span> requests will be routed deterministically:{' '}
        <span className="text-text">{split}%</span> → version A,{' '}
        <span className="text-text">{100 - split}%</span> → version B.
        Explicit version pins bypass the experiment.
      </div>

      {error && <p className="font-mono text-[11px] text-bad">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="font-mono text-[11.5px] px-[12px] py-[5px] border border-border rounded-[4px] text-text-muted hover:text-text transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={createMutation.isPending}
          className="font-mono text-[11.5px] px-[12px] py-[5px] rounded-[4px] bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {createMutation.isPending ? 'Starting…' : 'Start experiment'}
        </button>
      </div>
    </div>
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
      <div className="space-y-2 p-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />)}
      </div>
    )
  }

  const { experiment: exp, stats } = data
  const vA = versionMap.get(exp.version_a_id)
  const vB = versionMap.get(exp.version_b_id)

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

  return (
    <div className="space-y-4">
      {/* Experiment header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            'inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.05em] px-[7px] py-[2px] rounded-[3px]',
            exp.status === 'running'   && 'bg-good/10 border border-good/30 text-good',
            exp.status === 'concluded' && 'bg-accent-bg border border-accent-border text-accent',
            exp.status === 'stopped'   && 'bg-bg-muted border border-border text-text-faint',
          )}>
            {exp.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-good animate-pulse" />}
            {exp.status}
          </span>
          <span className="font-mono text-[11px] text-text-faint">
            Started {new Date(exp.started_at).toLocaleDateString()}
          </span>
          {exp.concluded_at && (
            <span className="font-mono text-[11px] text-text-faint">
              · Concluded {new Date(exp.concluded_at).toLocaleDateString()}
            </span>
          )}
        </div>
        {exp.status === 'running' && (
          <PermissionGate need="edit">
            <button
              type="button"
              onClick={() => void handleStop()}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 font-mono text-[11px] px-[9px] py-[4px] rounded-[4px] border border-border text-text-muted hover:text-text transition-colors"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Stop experiment
            </button>
          </PermissionGate>
        )}
      </div>

      {/* Winner banner */}
      {exp.winner_version_id && (
        <div className="flex items-center gap-2 bg-good/8 border border-good/30 rounded-[6px] px-[14px] py-[10px]">
          <Trophy className="h-4 w-4 text-good" />
          <span className="font-mono text-[12px] text-good">
            Winner: <strong>v{versionMap.get(exp.winner_version_id)?.version ?? '?'}</strong>
          </span>
        </div>
      )}

      {/* Arm comparison */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Version A (control)',    arm: stats.armA, vid: exp.version_a_id,  version: vA },
          { label: 'Version B (challenger)', arm: stats.armB, vid: exp.version_b_id, version: vB },
        ].map(({ label, arm, vid, version }) => {
          const isWinner = exp.winner_version_id === vid
          return (
            <div
              key={vid}
              className={cn(
                'bg-bg-elev border rounded-[8px] p-[16px] space-y-3',
                isWinner ? 'border-good/40' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">{label}</span>
                {version && (
                  <span className="font-mono text-[10px] px-[5px] py-[1px] rounded-[3px] bg-bg border border-border text-text-muted">
                    v{version.version}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Samples',    value: arm.samples.toLocaleString() },
                  { label: 'Error rate', value: fmtPct(arm.errorRate),
                    color: arm.errorRate === 0 ? 'text-good' : arm.errorRate < 0.05 ? 'text-warn' : 'text-bad' },
                  { label: 'Avg latency', value: fmtMs(arm.avgLatencyMs) },
                  { label: 'Avg cost',    value: arm.avgCostUsd > 0 ? fmtUsd(arm.avgCostUsd) : '—' },
                ].map((m, i) => (
                  <div key={i}>
                    <div className="font-mono text-[10px] text-text-faint mb-0.5">{m.label}</div>
                    <div className={cn('font-mono text-[14px] font-medium', m.color ?? 'text-text')}>
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>

              {canConclude && !exp.winner_version_id && (
                <PermissionGate need="edit">
                  <button
                    type="button"
                    onClick={() => void handleConclude(vid)}
                    disabled={concluding}
                    className="w-full flex items-center justify-center gap-1.5 font-mono text-[10.5px] px-[8px] py-[5px] rounded-[4px] border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors disabled:opacity-40"
                  >
                    <Trophy className="h-3 w-3" />
                    Declare winner
                  </button>
                </PermissionGate>
              )}
            </div>
          )
        })}
      </div>

      {/* Statistical significance */}
      <div className="bg-bg-elev border border-border rounded-[8px] p-[16px]">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-3">Statistical significance</p>
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: 'Error rate',
              stat: stats.significance.errorRate,
            },
            {
              label: 'Latency',
              stat: stats.significance.latency,
            },
            {
              label: 'Cost',
              stat: stats.significance.cost,
            },
          ].map(({ label, stat }) => (
            <div key={label} className="space-y-1.5">
              <div className="font-mono text-[11px] text-text-muted">{label}</div>
              <PValueBadge p={stat.pValue} significant={stat.significant} />
              {stat.relativeLift != null && (
                <div className={cn(
                  'font-mono text-[11px]',
                  stat.relativeLift < -0.01 ? 'text-good' :
                  stat.relativeLift > 0.01 ? 'text-bad' :
                  'text-text-faint',
                )}>
                  {fmtLift(stat.relativeLift)} lift
                </div>
              )}
            </div>
          ))}
        </div>
        {(stats.armA.samples < 30 || stats.armB.samples < 30) && (
          <p className="font-mono text-[10.5px] text-text-faint mt-3">
            ⚠ Need ≥30 samples per arm for significance testing. Currently A={stats.armA.samples}, B={stats.armB.samples}.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main A/B tab ──────────────────────────────────────────────────────────────

export function AbTab({ name, versions, experiments }: Props) {
  const [showCreate, setShowCreate] = useState(false)

  const runningExp = experiments.find((e) => e.status === 'running')
  const pastExps = experiments.filter((e) => e.status !== 'running')

  if (versions.length < 2 && !runningExp) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-text-muted">
        <FlaskConical className="h-8 w-8 text-text-faint" />
        <p className="text-[13px]">Need at least 2 versions to run an A/B experiment.</p>
      </div>
    )
  }

  return (
    <div className="p-[22px] space-y-6 max-w-3xl">
      {/* Running experiment */}
      {runningExp ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11.5px] font-medium text-text">Running experiment</p>
          </div>
          <ExperimentResults experimentId={runningExp.id} versions={versions} />
        </div>
      ) : !showCreate ? (
        <PermissionGate
          need="edit"
          fallback={
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-muted">
              <p className="text-[13px]">No active experiment. Ask an editor to start one.</p>
            </div>
          }
        >
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="font-mono text-[12px] text-text-muted">No active experiment for this prompt.</p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 font-mono text-[11.5px] px-[12px] py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity"
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
        <div className="space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">Past experiments</p>
          <div className="space-y-2">
            {pastExps.map((exp) => (
              <div
                key={exp.id}
                className="flex items-center gap-3 px-[14px] py-[10px] bg-bg-elev border border-border rounded-[6px]"
              >
                <span className={cn(
                  'font-mono text-[9px] uppercase tracking-[0.05em] px-[5px] py-[1px] rounded-[3px]',
                  exp.status === 'concluded' ? 'bg-accent-bg border border-accent-border text-accent' :
                  'bg-bg-muted border border-border text-text-faint',
                )}>
                  {exp.status}
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  Started {new Date(exp.started_at).toLocaleDateString()}
                  {exp.concluded_at && ` · Concluded ${new Date(exp.concluded_at).toLocaleDateString()}`}
                </span>
                {exp.winner_version_id && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-good ml-auto">
                    <Trophy className="h-3 w-3" />
                    Winner decided
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
