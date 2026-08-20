'use client'
import { use, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FlaskConical, Play, CheckCircle2, Key } from 'lucide-react'
import { DEMO_PROMPTS, DEMO_REQUESTS } from '@/lib/demo-data'
import { Topbar } from '@/components/layout/topbar'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StatusPill } from '@/components/ui/primitives'
import { cn, formatDate, formatTime } from '@/lib/utils'
import {
  Board,
  TOPBAR_BLEED,
  CONTROL,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
  Well,
} from '../../../(dashboard)/_board/surfaces'

// D4's TRAFFIC lozenge: live share on the accent tint, everything else on the
// neutral chip. Neither is a health status, so they carry their own classes
// rather than borrowing a `StatusPill` colour.
const CHIP =
  'inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-semibold leading-[15px]'
const CHIP_ACCENT = 'bg-accent-bg text-accent'
const CHIP_NEUTRAL = 'bg-bg-chip text-text-muted'

type Tab = 'versions' | 'calls' | 'traffic' | 'ab' | 'diff' | 'playground'
type DemoPrompt = (typeof DEMO_PROMPTS)[number]

// D4 draws label-only pill tabs, so the icons the old underline bar carried
// are gone here too.
const TABS: { id: Tab; label: string }[] = [
  { id: 'versions',   label: 'Versions'   },
  { id: 'diff',       label: 'Diff'       },
  { id: 'traffic',    label: 'Traffic'    },
  { id: 'calls',      label: 'Calls'      },
  { id: 'ab',         label: 'A/B'        },
  { id: 'playground', label: 'Playground' },
]

// D4's versions ledger, column for column.
const VERSION_GRID: React.CSSProperties = {
  gridTemplateColumns: '170px 140px 190px 130px 130px 110px minmax(0,1fr)',
}

const CALLS_GRID: React.CSSProperties = {
  gridTemplateColumns: 'minmax(0,1fr) 100px 90px 100px 90px 100px',
}

// The A-B ledger: metric, challenger, control, delta.
const AB_GRID: React.CSSProperties = {
  gridTemplateColumns: '120px minmax(0,1fr) minmax(0,1fr) 80px',
}

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

/** One line of the A-B ledger, matching D4's 36px metric row. */
function MetricRow({
  label,
  challenger,
  control,
}: {
  label: string
  challenger: string
  control: string
}) {
  return (
    <div className="grid items-center gap-3 border-b border-border py-[9px] last:border-b-0" style={AB_GRID}>
      <span className="text-[12px] font-medium leading-[1.45] text-text-muted">{label}</span>
      <span className="font-mono text-[12.5px] leading-[1.45] tabular-nums text-text">{challenger}</span>
      <span className="font-mono text-[12.5px] leading-[1.45] tabular-nums text-text-muted">{control}</span>
      <span className="text-right text-[12px] font-semibold leading-[1.45] text-text-faint" />
    </div>
  )
}

// ── Versions Tab ──────────────────────────────────────────────────────────────

function VersionsTab({ prompt }: { prompt: DemoPrompt }) {
  const versionCount = prompt.versionCount ?? prompt.version
  const exp = prompt.activeExperiment
  const model = typeof prompt.metadata?.model === 'string' ? prompt.metadata.model : '—'
  const stats = prompt.stats

  // Version rows run newest first. Only the live version carries rolled-up
  // numbers in the sample set, so the history rows show a dash rather than a
  // fabricated figure.
  const rows = Array.from({ length: versionCount }, (_, i) => {
    const v = versionCount - i
    const isCurrent = v === prompt.version
    const isControl = exp != null && v === prompt.version - 1
    return {
      v,
      isCurrent,
      traffic: isCurrent
        ? { label: exp ? `live · ${exp.trafficSplit}%` : 'live · 100%', tone: CHIP_ACCENT }
        : isControl
          ? { label: `${100 - exp.trafficSplit}%`, tone: CHIP_NEUTRAL }
          : { label: 'retired', tone: CHIP_NEUTRAL },
      model: isCurrent || isControl ? model : '—',
      requests: isCurrent && stats ? stats.calls.toLocaleString('en-US') : '—',
      avgCost: isCurrent && stats?.avgCostUsd != null ? fmtUsd(stats.avgCostUsd) : '—',
      score: isCurrent && prompt.qualityScore != null ? (prompt.qualityScore / 100).toFixed(2) : '—',
      updated: isCurrent
        ? formatDate(prompt.created_at)
        : formatDate(
            new Date(
              new Date(prompt.created_at).getTime() - (prompt.version - v) * 86400000 * 3,
            ).toISOString(),
          ),
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <TableCard>
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            <TableHead>
              <div className="grid items-center gap-3" style={VERSION_GRID}>
                <Th>Version</Th>
                <Th>Traffic</Th>
                <Th>Model</Th>
                <Th>Requests</Th>
                <Th>Avg cost</Th>
                <Th>Score</Th>
                <Th>Updated</Th>
              </div>
            </TableHead>
            {rows.map((r) => (
              <div key={r.v} className={cn(ROW, 'grid items-center gap-3 font-mono text-[12px]')} style={VERSION_GRID}>
                <span className="truncate text-text">{prompt.name}@v{r.v}</span>
                <span>
                  <span className={cn(CHIP, r.traffic.tone)}>{r.traffic.label}</span>
                </span>
                <span className="truncate text-text-muted">{r.model}</span>
                <span className="tabular-nums text-text-muted">{r.requests}</span>
                <span className="tabular-nums text-text-muted">{r.avgCost}</span>
                <span className="tabular-nums text-text-muted">{r.score}</span>
                <span className="text-text-muted">{r.updated}</span>
              </div>
            ))}
          </div>
        </div>
      </TableCard>

      {/* Split row: the version comparison on the left, the prompt body on the
          right, exactly as D4 pairs them. */}
      <div className={cn('grid gap-4', exp && 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]')}>
        {exp && (
          <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13.5px] font-semibold leading-[1.45] text-text">
                v{prompt.version} against v{prompt.version - 1}
              </span>
              <span className="ml-auto font-mono text-[11px] leading-[1.45] text-text-faint">
                last 24 hours · {(stats?.calls ?? 0).toLocaleString('en-US')} requests
              </span>
            </div>

            <div className="grid items-center gap-3 border-b border-border pb-2" style={AB_GRID}>
              <Th />
              <Th>v{prompt.version} · challenger</Th>
              <Th>v{prompt.version - 1} · control</Th>
              <Th className="block text-right">Delta</Th>
            </div>

            <div className="flex flex-col">
              <MetricRow
                label="traffic"
                challenger={`${exp.trafficSplit}%`}
                control={`${100 - exp.trafficSplit}%`}
              />
              <MetricRow
                label="score"
                challenger={prompt.qualityScore != null ? (prompt.qualityScore / 100).toFixed(2) : '—'}
                control="—"
              />
              <MetricRow
                label="avg cost"
                challenger={stats?.avgCostUsd != null ? fmtUsd(stats.avgCostUsd) : '—'}
                control="—"
              />
              <MetricRow
                label="avg latency"
                challenger={stats?.avgLatencyMs != null ? fmtMs(stats.avgLatencyMs) : '—'}
                control="—"
              />
              <MetricRow
                label="error rate"
                challenger={stats?.errorRate != null ? `${(stats.errorRate * 100).toFixed(2)}%` : '—'}
                control="—"
              />
            </div>

            <p className="font-mono text-[11px] leading-[1.65] text-text-faint">
              Control-arm figures and significance testing come from live traffic.{' '}
              <Link href="/signup" className="text-accent hover:opacity-80">Sign up free</Link>{' '}
              to see both arms side by side.
            </p>
          </Card>
        )}

        <Card className="flex flex-col gap-3 px-5 py-[18px]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[13px] leading-[1.45] text-text">
              {prompt.name}@v{prompt.version}
            </span>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(prompt.content) }}
              className="font-mono text-[10.5px] text-text-faint transition-colors hover:text-text"
            >
              copy
            </button>
          </div>

          <Well>
            <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.65] text-text-muted">
              {prompt.content}
            </pre>
          </Well>

          {prompt.variables && prompt.variables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {prompt.variables.map((v) => (
                <span
                  key={v.name}
                  title={v.description}
                  className="inline-flex items-center rounded-full bg-accent-bg px-[9px] py-1 font-mono text-[11px] leading-[1.45] text-accent"
                >
                  {v.name}
                </span>
              ))}
            </div>
          )}

          {prompt.metadata && Object.keys(prompt.metadata).length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-text-faint">
              {Object.entries(prompt.metadata).map(([k, val]) => (
                <span key={k}>
                  {k} <span className="text-text-muted">{String(val)}</span>
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Calls Tab ─────────────────────────────────────────────────────────────────

function CallsTab() {
  const requests = DEMO_REQUESTS.slice(0, 8)
  return (
    <TableCard>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <TableHead>
            <div className="grid items-center gap-3" style={CALLS_GRID}>
              <Th>Model</Th>
              <Th>Status</Th>
              <Th className="block text-right">Tokens</Th>
              <Th className="block text-right">Cost</Th>
              <Th className="block text-right">Latency</Th>
              <Th className="block text-right">Time</Th>
            </div>
          </TableHead>
          {requests.map((r) => (
            <div key={r.id} className={cn(ROW, 'grid items-center gap-3 font-mono text-[12px]')} style={CALLS_GRID}>
              <span className="truncate text-text">{r.provider} / {r.model}</span>
              <span>
                <StatusPill variant={r.status_code === 200 ? 'good' : 'bad'}>{r.status_code}</StatusPill>
              </span>
              <span className="text-right tabular-nums text-text-muted">
                {r.total_tokens.toLocaleString('en-US')}
              </span>
              <span className="text-right tabular-nums text-text-muted">
                {r.cost_usd != null ? `$${r.cost_usd.toFixed(5)}` : '—'}
              </span>
              <span className="text-right tabular-nums text-text-muted">{r.latency_ms}ms</span>
              <span className="text-right tabular-nums text-text-faint">{formatTime(r.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </TableCard>
  )
}

// ── Traffic Tab ───────────────────────────────────────────────────────────────

function TrafficTab({ prompt }: { prompt: DemoPrompt }) {
  const stats = prompt.stats
  if (!stats) {
    return (
      <div className="card-surface rounded-card flex h-48 items-center justify-center text-[12.5px] text-text-muted">
        No traffic data.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total calls" value={stats.calls.toLocaleString('en-US')} foot="last 24 hours" />
        <StatCard label="Total spend" value={fmtUsd(stats.totalCostUsd)} foot="last 24 hours" />
        <StatCard
          label="Avg cost / call"
          value={stats.avgCostUsd != null ? fmtUsd(stats.avgCostUsd) : '—'}
          foot="across every version"
        />
        <StatCard
          label="Avg latency"
          value={stats.avgLatencyMs != null ? fmtMs(stats.avgLatencyMs) : '—'}
          foot="end to end"
        />
        <StatCard
          label="Error rate"
          value={stats.errorRate != null ? `${(stats.errorRate * 100).toFixed(1)}%` : '—'}
          foot="non-200 responses"
        />
      </div>

      <div className="card-surface rounded-card flex flex-col items-center gap-1 px-5 py-10 text-center">
        <p className="text-[12.5px] text-text-muted">Hourly call volume needs a live workspace.</p>
        <p className="font-mono text-[11px] text-text-faint">
          <Link href="/signup" className="text-accent hover:opacity-80">Sign up free</Link> to chart your own traffic.
        </p>
      </div>
    </div>
  )
}

// ── A/B Tab ───────────────────────────────────────────────────────────────────

function AbTab({ prompt }: { prompt: DemoPrompt }) {
  const exp = prompt.activeExperiment

  if (!exp) {
    return (
      <div className="card-surface rounded-card flex flex-col items-center gap-3 px-5 py-12 text-center">
        <FlaskConical className="h-6 w-6 text-text-faint" />
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-text-muted">No A/B experiment running</p>
          <p className="font-mono text-[11px] text-text-faint">
            Sign up to create an A/B experiment for this prompt
          </p>
        </div>
        <button
          type="button"
          onClick={() => alert('Sign up to create A/B experiments')}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          New A/B test
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[13.5px] font-semibold leading-[1.45] text-text">
            v{prompt.version} against v{prompt.version - 1}
          </span>
          <StatusPill variant="warn">running</StatusPill>
          <span className="ml-auto font-mono text-[11px] text-text-faint">experiment {exp.id}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-bg-sunk px-3.5 py-3">
            <p className="micro-label mb-1.5 tracking-[0.1em]">Control · v{prompt.version - 1}</p>
            <p className="font-display text-[24px] leading-[1.05]! tracking-[-0.02em] tabular-nums text-text">
              {100 - exp.trafficSplit}%
            </p>
            <p className="mt-1 font-mono text-[11px] text-text-faint">of routed traffic</p>
          </div>
          <div className="rounded-lg border border-accent-border bg-accent-bg px-3.5 py-3">
            <p className="micro-label mb-1.5 tracking-[0.1em] text-accent">Variant · v{prompt.version}</p>
            <p className="font-display text-[24px] leading-[1.05]! tracking-[-0.02em] tabular-nums text-accent">
              {exp.trafficSplit}%
            </p>
            <p className="mt-1 font-mono text-[11px] text-text-faint">of routed traffic</p>
          </div>
        </div>

        <span className="flex h-1.5 overflow-hidden rounded-full bg-track">
          <span className="block h-full bg-border-strong" style={{ width: `${100 - exp.trafficSplit}%` }} />
          <span className="block h-full flex-1 bg-accent" />
        </span>
      </Card>

      <div className="card-surface rounded-card flex flex-col items-center gap-1 px-5 py-10 text-center">
        <p className="text-[12.5px] text-text-muted">Live experiment results need a workspace of your own.</p>
        <p className="font-mono text-[11px] text-text-faint">
          <Link href="/signup" className="text-accent hover:opacity-80">Sign up free</Link> to see quality,
          latency and cost per arm.
        </p>
      </div>
    </div>
  )
}

// ── Diff Tab ──────────────────────────────────────────────────────────────────

function DiffTab({ prompt }: { prompt: DemoPrompt }) {
  if ((prompt.versionCount ?? prompt.version) < 2) {
    return (
      <div className="card-surface rounded-card flex flex-col items-center gap-1 px-5 py-12 text-center">
        <p className="text-[12.5px] text-text-muted">No version history to compare</p>
        <p className="font-mono text-[11px] text-text-faint">
          Two versions are needed before a diff can be drawn
        </p>
      </div>
    )
  }

  // A stand-in previous revision so the demo can show the diff shape.
  const prevLines = [
    `You are a helpful assistant for {{company_name}}.`,
    `Your goal is to resolve customer issues.`,
    ``,
    `Customer message: {{customer_message}}`,
  ]
  const currLines = prompt.content.split('\n').slice(0, 6)

  return (
    <TableCard>
      <TableHead>
        <Th>v{prompt.version - 1} → v{prompt.version}</Th>
      </TableHead>
      <div className="overflow-x-auto py-1.5 font-mono text-[12px] leading-[1.65]">
        {prevLines.map((line, i) => (
          <div key={`r-${i}`} className="flex gap-4 border-l-2 border-bad bg-bad-bg px-[18px] py-[1px]">
            <span className="w-4 shrink-0 select-none text-right text-bad">−</span>
            <span className="whitespace-pre-wrap break-all text-bad">{line || ' '}</span>
          </div>
        ))}
        {currLines.map((line, i) => (
          <div key={`a-${i}`} className="flex gap-4 border-l-2 border-good bg-good-bg px-[18px] py-[1px]">
            <span className="w-4 shrink-0 select-none text-right text-good">+</span>
            <span className="whitespace-pre-wrap break-all text-good">{line || ' '}</span>
          </div>
        ))}
      </div>
    </TableCard>
  )
}

// ── Playground Tab ────────────────────────────────────────────────────────────

const DEMO_PROVIDER_KEYS = [
  { id: 'pk-1', name: 'OpenAI prod',    provider: 'openai',    label: 'OpenAI' },
  { id: 'pk-2', name: 'Anthropic prod', provider: 'anthropic', label: 'Anthropic' },
  { id: 'pk-4', name: 'OpenAI staging', provider: 'openai',    label: 'OpenAI' },
]

const DEMO_MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-5', 'claude-3-5-haiku-20241022'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
}

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function extractVars(content: string): string[] {
  const names = new Set<string>()
  for (const match of content.matchAll(VAR_RE)) {
    names.add(match[1]!)
  }
  return [...names]
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-sunk px-3 py-2.5">
      <p className="micro-label mb-1 tracking-[0.1em]">{label}</p>
      <p className="truncate font-mono text-[12px] text-text" title={value}>{value}</p>
    </div>
  )
}

function PlaygroundTab({ prompt }: { prompt: DemoPrompt }) {
  const [selectedKeyId, setSelectedKeyId] = useState(DEMO_PROVIDER_KEYS[0]?.id ?? '')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [showResult, setShowResult] = useState(true)

  const selectedKey = DEMO_PROVIDER_KEYS.find((k) => k.id === selectedKeyId) ?? null
  const availableModels = selectedKey ? (DEMO_MODELS_BY_PROVIDER[selectedKey.provider] ?? []) : []
  const detectedVars = extractVars(prompt.content)

  // Static "demo" result — wired up to look like a real run completed.
  const demoResult = {
    model: model || 'claude-sonnet-4-6',
    promptTokens: 142,
    completionTokens: 187,
    totalTokens: 329,
    costUsd: 0.00428,
    latencyMs: 1248,
    responseText:
      "Thanks for reaching out! I understand you're experiencing an issue with your account.\n\nLet me take a look. Based on what you described, I'd recommend the following steps:\n\n1. Verify your email address on file\n2. Reset your password from the login page\n3. Clear your browser cache and try again\n\nIf the problem persists, I can escalate to our technical team. Just let me know!",
  }

  const selectClass = cn(
    CONTROL,
    'w-full px-3 font-mono text-[12.5px] text-text focus:border-border-strong focus:outline-none',
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="flex flex-col gap-5 px-5 py-[18px]">
        <div className="flex flex-col gap-1.5">
          <label className="micro-label tracking-[0.1em]" htmlFor="demo-pg-version">Version</label>
          <select
            id="demo-pg-version"
            value={`v${prompt.version}`}
            disabled
            className={cn(selectClass, 'cursor-not-allowed text-text-muted opacity-80')}
          >
            <option>v{prompt.version} (latest)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="micro-label flex items-center gap-1.5 tracking-[0.1em]" htmlFor="demo-pg-key">
            <Key className="h-3 w-3" /> Provider key
          </label>
          <select
            id="demo-pg-key"
            value={selectedKeyId}
            onChange={(e) => setSelectedKeyId(e.target.value)}
            className={selectClass}
          >
            {DEMO_PROVIDER_KEYS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} · {k.label}
              </option>
            ))}
          </select>
        </div>

        {selectedKey && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <label className="micro-label tracking-[0.1em]" htmlFor="demo-pg-model">Model</label>
              <StatusPill>{selectedKey.label}</StatusPill>
            </span>
            <select
              id="demo-pg-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={selectClass}
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="micro-label tracking-[0.1em]" htmlFor="demo-pg-temp">Temperature</label>
            <span className="font-mono text-[11px] tabular-nums text-text-muted">{temperature.toFixed(1)}</span>
          </div>
          <input
            id="demo-pg-temp"
            type="range"
            min="0" max="2" step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between font-mono text-[10px] text-text-faint">
            <span>0 precise</span>
            <span>2 creative</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="micro-label tracking-[0.1em]" htmlFor="demo-pg-max">Max tokens</label>
          <input
            id="demo-pg-max"
            type="number"
            min="1" max="8192"
            value={maxTokens}
            onChange={(e) =>
              setMaxTokens(Math.min(8192, Math.max(1, parseInt(e.target.value, 10) || 1)))
            }
            className={cn(CONTROL, 'w-full px-3 font-mono text-[12.5px] tabular-nums text-text focus:border-border-strong focus:outline-none')}
          />
        </div>

        {detectedVars.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className="micro-label tracking-[0.1em]">Variables</span>
            {detectedVars.map((varName) => (
              <div key={varName} className="flex flex-col gap-1">
                <label className="font-mono text-[11px] text-accent" htmlFor={`demo-pg-var-${varName}`}>
                  {`{{${varName}}}`}
                </label>
                <input
                  id={`demo-pg-var-${varName}`}
                  type="text"
                  placeholder={`Value for ${varName}…`}
                  value={variables[varName] ?? ''}
                  onChange={(e) => setVariables((prev) => ({ ...prev, [varName]: e.target.value }))}
                  className={cn(CONTROL, 'w-full px-3 font-mono text-[12.5px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
                />
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowResult(true)}
          className="inline-flex h-[34px] w-full items-center justify-center gap-2 rounded-full bg-accent text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
        >
          <Play className="h-3.5 w-3.5" />
          Run (demo)
        </button>

        <p className="text-center font-mono text-[10.5px] leading-[1.65] text-text-faint">
          The playground is fully interactive in the live app.{' '}
          <Link href="/signup" className="text-accent hover:opacity-80">Sign up free</Link>{' '}
          to run against your own keys.
        </p>
      </Card>

      <Card className="flex min-w-0 flex-col gap-3.5 px-5 py-[18px]">
        <span className="font-mono text-[13px] leading-[1.45] text-text">
          v{prompt.version} preview
        </span>
        <Well className="max-h-52 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.65] text-text-muted">
            {prompt.content}
          </pre>
        </Well>

        {showResult && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ResultStat label="Model" value={demoResult.model} />
              <ResultStat label="Tokens" value={demoResult.totalTokens.toLocaleString('en-US')} />
              <ResultStat label="Cost" value={`$${demoResult.costUsd.toFixed(5)}`} />
              <ResultStat label="Latency" value={`${(demoResult.latencyMs / 1000).toFixed(2)}s`} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-text-faint">
              <span><span className="text-text-muted">{demoResult.promptTokens}</span> prompt</span>
              <span>+</span>
              <span><span className="text-text-muted">{demoResult.completionTokens}</span> completion</span>
              <span>=</span>
              <span><span className="text-text-muted">{demoResult.totalTokens}</span> total</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="micro-label tracking-[0.1em]">Response</span>
                <CheckCircle2 className="h-3 w-3 text-good" />
                <span className={cn(CHIP, CHIP_ACCENT, 'ml-auto')}>demo response</span>
              </div>
              <Well>
                <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-[1.65] text-text">
                  {demoResult.responseText}
                </pre>
              </Well>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ name: string }>
}

export default function DemoPromptDetailPage({ params }: Props) {
  const { name: rawName } = use(params)
  const name = decodeURIComponent(rawName)
  const [tab, setTab] = useState<Tab>('versions')

  const prompt = DEMO_PROMPTS.find((p) => p.name === name)

  if (!prompt) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar
            crumbs={[
              { label: 'Prompts', href: '/demo/prompts' },
              { label: name },
            ]}
          />
          <h1 className="sr-only">{name}</h1>
        </div>
        <Board>
          <div className="card-surface rounded-card flex flex-col items-center gap-3 px-5 py-20 text-text-muted">
            <p className="text-[12.5px]">Prompt not found: {name}</p>
            <Link
              href="/demo/prompts"
              className="rounded-full border border-border px-3 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors hover:text-text"
            >
              ← Back to prompts
            </Link>
          </div>
        </Board>
      </div>
    )
  }

  const hasExperiment = Boolean(prompt.activeExperiment)
  const versionCount = prompt.versionCount ?? prompt.version

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[
            { label: 'Prompts', href: '/demo/prompts' },
            { label: prompt.name },
          ]}
          right={
            <div className="flex items-center gap-3">
              <Link
                href="/demo/prompts"
                className="flex items-center gap-1 font-mono text-[11px] text-text-muted transition-colors hover:text-text"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Link>
              <StatusPill>sample data</StatusPill>
              <button
                type="button"
                onClick={() => setTab('ab')}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold leading-[18px] text-accent-fg transition-colors hover:bg-accent-strong"
              >
                <FlaskConical className="h-3.5 w-3.5" />
                {hasExperiment ? 'Manage A/B' : 'New A/B test'}
              </button>
            </div>
          }
        />
        {/* The breadcrumb names the prompt, so D4 carries no second header row. */}
        <h1 className="sr-only">{prompt.name}</h1>
      </div>

      <Board>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <TabsList className="flex-wrap">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                  {t.id === 'ab' && hasExperiment && (
                    <span className="ml-1.5 block h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <span className="ml-auto font-mono text-[11px] leading-[1.45] text-text-faint">
              {versionCount} version{versionCount === 1 ? '' : 's'}
            </span>
            {hasExperiment && <StatusPill variant="warn">A/B running</StatusPill>}
          </div>

          <TabsContent value="versions" className="mt-0"><VersionsTab prompt={prompt} /></TabsContent>
          <TabsContent value="diff" className="mt-0"><DiffTab prompt={prompt} /></TabsContent>
          <TabsContent value="traffic" className="mt-0"><TrafficTab prompt={prompt} /></TabsContent>
          <TabsContent value="calls" className="mt-0"><CallsTab /></TabsContent>
          <TabsContent value="ab" className="mt-0"><AbTab prompt={prompt} /></TabsContent>
          <TabsContent value="playground" className="mt-0"><PlaygroundTab prompt={prompt} /></TabsContent>
        </Tabs>
      </Board>
    </div>
  )
}
