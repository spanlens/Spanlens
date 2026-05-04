'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FlaskConical, GitCommit, ArrowLeftRight, BarChart2, Phone } from 'lucide-react'
import { DEMO_PROMPTS, DEMO_REQUESTS } from '@/lib/demo-data'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

type Tab = 'versions' | 'calls' | 'traffic' | 'ab' | 'diff'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'versions', label: 'Versions',  icon: <GitCommit className="h-3.5 w-3.5" /> },
  { id: 'diff',     label: 'Diff',      icon: <ArrowLeftRight className="h-3.5 w-3.5" /> },
  { id: 'traffic',  label: 'Traffic',   icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { id: 'calls',    label: 'Calls',     icon: <Phone className="h-3.5 w-3.5" /> },
  { id: 'ab',       label: 'A/B',       icon: <FlaskConical className="h-3.5 w-3.5" /> },
]

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

// ── Versions Tab ──────────────────────────────────────────────────────────────

function VersionsTab({ prompt }: { prompt: (typeof DEMO_PROMPTS)[number] }) {
  return (
    <div className="p-[22px] space-y-6">
      {/* Current version card */}
      <div className="rounded-[8px] border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-[18px] py-[12px] bg-bg-muted border-b border-border">
          <span className="font-mono text-[11px] font-semibold text-text">v{prompt.version}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] px-[6px] py-[1px] rounded-[3px] bg-good/10 border border-good/20 text-good">
            current
          </span>
          <span className="font-mono text-[11px] text-text-faint ml-auto">
            {new Date(prompt.created_at).toLocaleDateString()} · by {prompt.created_by}
          </span>
        </div>

        {/* Content */}
        <div className="px-[18px] py-[14px] bg-bg">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Prompt content
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[12.5px] text-text leading-relaxed bg-bg-elev rounded-[6px] px-[14px] py-[12px] border border-border overflow-x-auto">
            {prompt.content}
          </pre>
        </div>

        {/* Variables */}
        {prompt.variables && prompt.variables.length > 0 && (
          <div className="px-[18px] py-[14px] border-t border-border">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
              Variables · {prompt.variables.length}
            </div>
            <div className="space-y-2">
              {prompt.variables.map((v) => (
                <div key={v.name} className="flex items-start gap-3">
                  <code className="font-mono text-[12px] text-accent bg-accent-bg border border-accent-border px-[8px] py-[2px] rounded-[4px] shrink-0">
                    {`{{${v.name}}}`}
                  </code>
                  <div>
                    <span className="text-[12px] text-text-muted">{v.description}</span>
                    {v.required && (
                      <span className="ml-2 font-mono text-[10px] text-bad">required</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        {prompt.metadata && Object.keys(prompt.metadata).length > 0 && (
          <div className="px-[18px] py-[14px] border-t border-border">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
              Metadata
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {Object.entries(prompt.metadata).map(([k, val]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-text-faint">{k}</span>
                  <span className="font-mono text-[11px] text-text">{String(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Version history */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
          Version history · {prompt.versionCount ?? prompt.version} versions
        </div>
        <div className="rounded-[6px] border border-border overflow-hidden">
          {Array.from({ length: prompt.versionCount ?? prompt.version }, (_, i) => {
            const v = (prompt.versionCount ?? prompt.version) - i
            const isCurrent = v === prompt.version
            return (
              <div
                key={v}
                className={cn(
                  'flex items-center gap-3 px-[14px] py-[10px] border-b border-border last:border-0',
                  isCurrent && 'bg-bg-muted',
                )}
              >
                <span className="font-mono text-[12px] text-text-muted w-8">v{v}</span>
                {isCurrent && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-[5px] py-[1px] rounded-[3px] bg-good/10 border border-good/20 text-good">
                    current
                  </span>
                )}
                <span className="font-mono text-[11px] text-text-faint ml-auto">
                  {v === prompt.version
                    ? new Date(prompt.created_at).toLocaleDateString()
                    : new Date(
                        new Date(prompt.created_at).getTime() - (prompt.version - v) * 86400000 * 3,
                      ).toLocaleDateString()}
                </span>
                <span className="font-mono text-[11px] text-text-faint">{prompt.created_by}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Calls Tab ─────────────────────────────────────────────────────────────────

function CallsTab() {
  const requests = DEMO_REQUESTS.slice(0, 8)
  return (
    <div className="p-[22px]">
      <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
        Recent calls linked to this prompt
      </div>
      <div className="rounded-[6px] border border-border overflow-hidden">
        {/* Header */}
        <div
          className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border-b border-border"
          style={{ gridTemplateColumns: '1fr 100px 80px 80px 80px 100px' }}
        >
          <span>Model</span>
          <span>Status</span>
          <span>Tokens</span>
          <span>Cost</span>
          <span>Latency</span>
          <span className="text-right">Time</span>
        </div>
        {requests.map((r) => (
          <div
            key={r.id}
            className={cn(
              'grid items-center px-[14px] py-[9px] border-b border-border last:border-0 font-mono text-[12px]',
            )}
            style={{ gridTemplateColumns: '1fr 100px 80px 80px 80px 100px' }}
          >
            <span className="text-text truncate">
              {r.provider} / {r.model}
            </span>
            <span>
              <span
                className={cn(
                  'px-[6px] py-[1px] rounded-[3px] text-[10px] uppercase tracking-[0.04em]',
                  r.status_code === 200
                    ? 'bg-good/10 text-good'
                    : 'bg-bad/10 text-bad',
                )}
              >
                {r.status_code}
              </span>
            </span>
            <span className="text-text-muted">{r.total_tokens.toLocaleString()}</span>
            <span className="text-text-muted">
              {r.cost_usd != null ? `$${r.cost_usd.toFixed(5)}` : '—'}
            </span>
            <span className="text-text-muted">{r.latency_ms}ms</span>
            <span className="text-text-faint text-right text-[11px]">
              {new Date(r.created_at).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Traffic Tab ───────────────────────────────────────────────────────────────

function TrafficTab({ prompt }: { prompt: (typeof DEMO_PROMPTS)[number] }) {
  const stats = prompt.stats
  if (!stats) return <div className="p-[22px] text-text-muted text-[13px]">No traffic data.</div>

  const statItems = [
    { label: 'Total calls',   value: stats.calls.toLocaleString() },
    { label: 'Total spend',   value: fmtUsd(stats.totalCostUsd) },
    { label: 'Avg cost/call', value: stats.avgCostUsd != null ? fmtUsd(stats.avgCostUsd) : '—' },
    { label: 'Avg latency',   value: stats.avgLatencyMs != null ? fmtMs(stats.avgLatencyMs) : '—' },
    { label: 'Error rate',    value: stats.errorRate != null ? `${(stats.errorRate * 100).toFixed(1)}%` : '—' },
  ]

  return (
    <div className="p-[22px]">
      <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-4">
        Traffic summary
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statItems.map((s) => (
          <div key={s.label} className="rounded-[6px] border border-border px-[14px] py-[12px] bg-bg-elev">
            <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-1">
              {s.label}
            </div>
            <div className="font-mono text-[18px] font-medium text-text">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[6px] border border-dashed border-border py-10 text-center text-text-muted">
        <p className="text-[13px]">Time-series chart available in full account</p>
        <p className="font-mono text-[11px] text-text-faint mt-1">Sign up to see hourly call volume</p>
      </div>
    </div>
  )
}

// ── A/B Tab ───────────────────────────────────────────────────────────────────

function AbTab({ prompt }: { prompt: (typeof DEMO_PROMPTS)[number] }) {
  const exp = prompt.activeExperiment

  if (!exp) {
    return (
      <div className="p-[22px]">
        <div className="rounded-[6px] border border-dashed border-border py-12 text-center">
          <FlaskConical className="h-6 w-6 text-text-faint mx-auto mb-3" />
          <p className="text-[13px] text-text-muted">No A/B experiment running</p>
          <p className="font-mono text-[11px] text-text-faint mt-1">
            Sign up to create an A/B experiment for this prompt
          </p>
          <button
            type="button"
            onClick={() => alert('Sign up to create A/B experiments')}
            className="mt-4 font-mono text-[11.5px] px-4 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity"
          >
            + New A/B test
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-[22px] space-y-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] px-[8px] py-[3px] rounded-[4px] bg-accent-bg border border-accent-border text-accent">
          <FlaskConical className="h-3 w-3" />
          Experiment running
        </span>
        <span className="font-mono text-[11px] text-text-faint">ID: {exp.id}</span>
      </div>

      <div className="rounded-[6px] border border-border overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-border">
          {/* Control */}
          <div className="px-[18px] py-[14px]">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
              Control · v{prompt.version - 1}
            </div>
            <div className="text-[24px] font-medium text-text">
              {100 - exp.trafficSplit}%
            </div>
            <div className="font-mono text-[11px] text-text-faint mt-0.5">traffic</div>
          </div>
          {/* Variant */}
          <div className="px-[18px] py-[14px]">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-accent mb-2">
              Variant · v{prompt.version} (current)
            </div>
            <div className="text-[24px] font-medium text-accent">{exp.trafficSplit}%</div>
            <div className="font-mono text-[11px] text-text-faint mt-0.5">traffic</div>
          </div>
        </div>
        <div className="px-[18px] py-[10px] bg-bg-muted border-t border-border">
          <div className="flex gap-0 rounded-[4px] overflow-hidden border border-border h-3">
            <div
              className="bg-border-strong"
              style={{ width: `${100 - exp.trafficSplit}%` }}
            />
            <div className="bg-accent flex-1" />
          </div>
        </div>
      </div>

      <div className="rounded-[6px] border border-dashed border-border py-8 text-center text-text-muted">
        <p className="text-[13px]">Live experiment results available in full account</p>
        <p className="font-mono text-[11px] text-text-faint mt-1">
          Sign up to see quality scores, latency, and cost per variant
        </p>
      </div>
    </div>
  )
}

// ── Diff Tab ──────────────────────────────────────────────────────────────────

function DiffTab({ prompt }: { prompt: (typeof DEMO_PROMPTS)[number] }) {
  if ((prompt.versionCount ?? prompt.version) < 2) {
    return (
      <div className="p-[22px]">
        <div className="rounded-[6px] border border-dashed border-border py-12 text-center">
          <p className="text-[13px] text-text-muted">No version history to compare</p>
          <p className="font-mono text-[11px] text-text-faint mt-1">
            At least 2 versions are needed to show a diff
          </p>
        </div>
      </div>
    )
  }

  // Simulate a simple diff between "previous" and "current"
  const prevLines = [
    `You are a helpful assistant for {{company_name}}.`,
    `Your goal is to resolve customer issues.`,
    ``,
    `Customer message: {{customer_message}}`,
  ]
  const currLines = prompt.content.split('\n').slice(0, 6)

  return (
    <div className="p-[22px] space-y-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-text-muted">
          v{prompt.version - 1} → v{prompt.version}
        </span>
        <span className="font-mono text-[10px] text-text-faint">Latest diff</span>
      </div>

      <div className="rounded-[6px] border border-border overflow-hidden font-mono text-[12px]">
        {/* removed lines */}
        {prevLines.map((line, i) => (
          <div key={`r-${i}`} className="flex px-[14px] py-[3px] bg-bad/5 border-b border-bad/10">
            <span className="w-6 text-bad/60 select-none shrink-0">-</span>
            <span className="text-bad/80">{line || ' '}</span>
          </div>
        ))}
        {/* added lines */}
        {currLines.slice(0, 6).map((line, i) => (
          <div key={`a-${i}`} className="flex px-[14px] py-[3px] bg-good/5 border-b border-good/10 last:border-0">
            <span className="w-6 text-good/60 select-none shrink-0">+</span>
            <span className="text-good/80">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface Props {
  params: { name: string }
}

export default function DemoPromptDetailPage({ params }: Props) {
  const name = decodeURIComponent(params.name)
  const [tab, setTab] = useState<Tab>('versions')

  const prompt = DEMO_PROMPTS.find((p) => p.name === name)

  if (!prompt) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
        <Topbar
          crumbs={[
            { label: 'Prompts', href: '/demo/prompts' },
            { label: name },
          ]}
        />
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-text-muted">
          <p className="text-[13px]">Prompt not found: {name}</p>
          <Link
            href="/demo/prompts"
            className="font-mono text-[11.5px] px-3 py-[5px] rounded-[4px] border border-border hover:text-text transition-colors"
          >
            ← Back to prompts
          </Link>
        </div>
      </div>
    )
  }

  const hasExperiment = Boolean(prompt.activeExperiment)

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[
          { label: 'Prompts', href: '/demo/prompts' },
          { label: prompt.name },
        ]}
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/demo/prompts"
              className="font-mono text-[11px] text-text-muted hover:text-text flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Link>
          </div>
        }
      />

      {/* Header row */}
      <div className="flex items-center gap-3 px-[22px] py-[14px] border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="font-mono text-[15px] font-semibold text-text truncate">{prompt.name}</h1>
          <p className="font-mono text-[11px] text-text-faint mt-0.5">
            {prompt.versionCount ?? prompt.version} version
            {(prompt.versionCount ?? prompt.version) !== 1 ? 's' : ''}
          </p>
        </div>
        {hasExperiment && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] px-[8px] py-[3px] rounded-[4px] bg-accent-bg border border-accent-border text-accent">
            <FlaskConical className="h-3 w-3" />
            A/B running
          </span>
        )}
        <button
          type="button"
          onClick={() => setTab('ab')}
          className="font-mono text-[11px] text-text px-[10px] py-[5px] border border-border-strong rounded-[5px] bg-bg-elev hover:bg-bg-muted flex items-center gap-1.5 transition-colors"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          {hasExperiment ? 'Manage A/B' : 'New A/B test'}
        </button>
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
            {t.id === 'ab' && hasExperiment && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent block" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === 'versions' && <VersionsTab prompt={prompt} />}
        {tab === 'calls'    && <CallsTab />}
        {tab === 'traffic'  && <TrafficTab prompt={prompt} />}
        {tab === 'ab'       && <AbTab prompt={prompt} />}
        {tab === 'diff'     && <DiffTab prompt={prompt} />}
      </div>
    </div>
  )
}
