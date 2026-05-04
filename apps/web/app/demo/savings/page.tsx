'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { DEMO_RECOMMENDATIONS } from '@/lib/demo-data'
import type { ModelRecommendation } from '@/lib/queries/use-recommendations'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(5)}`
}

// ── Confidence helpers ─────────────────────────────────────────────────────────

function getConfidence(r: ModelRecommendation): 'high' | 'medium' | 'low' {
  if (r.estimatedMonthlySavingsUsd >= 40 && r.sampleCount >= 100) return 'high'
  if (r.estimatedMonthlySavingsUsd >= 10 && r.sampleCount >= 30) return 'medium'
  return 'low'
}

function ConfidenceBar({ level }: { level: 'high' | 'medium' | 'low' }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  const color =
    level === 'high' ? 'bg-good' : level === 'medium' ? 'bg-text' : 'bg-text-faint'
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('w-4 h-1 rounded-[1px]', i < filled ? color : 'bg-border')}
          />
        ))}
      </div>
      <span
        className={cn(
          'font-mono text-[11px] capitalize',
          level === 'high'
            ? 'text-good'
            : level === 'medium'
              ? 'text-text'
              : 'text-text-faint',
        )}
      >
        {level}
      </span>
    </div>
  )
}

// ── DemoNotice ────────────────────────────────────────────────────────────────

function DemoNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[420px] bg-bg border border-border rounded-[8px] shadow-xl p-6 space-y-4">
        <h2 className="font-mono text-[14px] font-medium text-text">Demo mode</h2>
        <p className="text-[13px] text-text-muted leading-relaxed">
          Sign up to apply recommendations. Spanlens helps you swap model configs directly
          from the dashboard.
        </p>
        <div className="flex gap-2">
          <a
            href="/signup"
            className="flex-1 text-center font-mono text-[12px] py-2 rounded-[5px] bg-text text-bg hover:opacity-90 transition-opacity"
          >
            Start free →
          </a>
          <button
            onClick={onClose}
            className="font-mono text-[12px] px-4 py-2 border border-border rounded-[5px] text-text-muted hover:border-border-strong hover:text-text transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RecRow ────────────────────────────────────────────────────────────────────

function RecRow({
  r,
  windowLabel,
  onApply,
}: {
  r: ModelRecommendation
  windowLabel: string
  onApply: () => void
}) {
  const conf = getConfidence(r)

  return (
    <div
      className="border-b border-border hover:bg-bg-elev transition-colors"
      style={{
        display: 'grid',
        gridTemplateColumns: '1.7fr 170px 130px 150px 180px',
        gap: 16,
        alignItems: 'center',
        padding: '14px 22px',
        minWidth: '700px',
      }}
    >
      {/* Title + from/to */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em] border-accent-border bg-accent-bg text-accent">
            SWAP
          </span>
          <span className="text-[13.5px] font-medium truncate text-text">
            {r.currentProvider} / {r.currentModel} → {r.suggestedProvider} / {r.suggestedModel}
          </span>
        </div>
        <div className="font-mono text-[11.5px] text-text-muted flex items-center gap-2 flex-wrap">
          <span className="text-text-faint line-through">
            {r.currentProvider} / {r.currentModel}
          </span>
          <span className="text-text-faint">→</span>
          <span className="text-text">
            {r.suggestedProvider} / {r.suggestedModel}
          </span>
        </div>
        <p className="text-[12px] text-text-faint mt-1 leading-relaxed">{r.reason}</p>
      </div>

      {/* Savings */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">
          SAVE / MO
        </div>
        <div className="font-mono text-[18px] font-medium tracking-[-0.3px] text-accent">
          {fmtUsd(r.estimatedMonthlySavingsUsd)}
        </div>
        <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
          was {fmtUsd(r.totalCostUsdLastNDays)} /{windowLabel}
        </div>
      </div>

      {/* Samples */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">
          SAMPLES
        </div>
        <div className="text-[12.5px] text-text">{r.sampleCount.toLocaleString()}</div>
        <div className="font-mono text-[10.5px] text-good mt-0.5">−cost latency</div>
      </div>

      {/* Confidence */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[5px]">
          CONFIDENCE
        </div>
        <ConfidenceBar level={conf} />
        <div className="font-mono text-[10.5px] text-text-faint mt-1">
          ~{Math.round(r.avgPromptTokens)} prompt tk
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={onApply}
          className="font-mono text-[10.5px] text-bg px-[10px] py-[4px] rounded-[5px] bg-text font-medium hover:opacity-90 transition-opacity"
        >
          Apply →
        </button>
      </div>
    </div>
  )
}

// ── Window options ────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { hours: 24 * 7, label: '7d' },
  { hours: 24 * 14, label: '14d' },
  { hours: 24 * 30, label: '30d' },
] as const

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DemoSavingsPage() {
  const [hours, setHours] = useState<number>(24 * 7)
  const [showDemoNotice, setShowDemoNotice] = useState(false)

  const recs = DEMO_RECOMMENDATIONS

  const totalSavings = recs.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)
  const totalSpend = recs.reduce((s, r) => s + r.totalCostUsdLastNDays, 0)
  const totalSamples = recs.reduce((s, r) => s + r.sampleCount, 0)
  const modelCount = new Set(recs.map((r) => r.currentModel)).size

  const highConf = recs.filter((r) => getConfidence(r) === 'high')
  const bestConfLevel =
    highConf.length > 0
      ? 'high'
      : recs.filter((r) => getConfidence(r) === 'medium').length > 0
        ? 'medium'
        : recs.length > 0
          ? 'low'
          : null
  const bestConfCount =
    highConf.length > 0
      ? highConf.length
      : recs.filter((r) => getConfidence(r) === 'medium').length

  const windowLabel = WINDOW_OPTIONS.find((o) => o.hours === hours)?.label ?? '7d'

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      {showDemoNotice && <DemoNotice onClose={() => setShowDemoNotice(false)} />}

      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Savings' }]}
        right={
          <div className="flex items-center gap-1">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                onClick={() => setHours(opt.hours)}
                className={cn(
                  'font-mono text-[11px] px-[8px] py-[3px] rounded-[4px] transition-colors',
                  hours === opt.hours
                    ? 'bg-bg-elev text-text border border-border-strong'
                    : 'text-text-faint hover:text-text',
                )}
              >
                {opt.label}
              </button>
            ))}
            <span className="hidden sm:inline font-mono text-[11px] text-text-muted ml-1.5">
              Analysis window
            </span>
          </div>
        }
      />

      {/* Hero strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div
          className="grid min-w-[700px]"
          style={{ gridTemplateColumns: '1.25fr 1fr 1fr 1fr' }}
        >
          {/* Hero tile */}
          <div className="px-[16px] py-[16px] bg-bg-elev border-r border-border">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
              Potential savings · next 30d
            </div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-medium leading-none tracking-[-1.6px] text-[40px] text-accent">
                {fmtUsd(totalSavings)}
              </span>
              <span className="font-mono text-[10px] text-text-muted">/ mo</span>
            </div>
            <div className="font-mono text-[10px] text-text-muted mb-2">
              across <span className="text-text">{recs.length}</span> recommendations
              {bestConfLevel !== null && (
                <>
                  {' '}·{' '}
                  <span
                    className={cn(
                      bestConfLevel === 'high'
                        ? 'text-good'
                        : bestConfLevel === 'medium'
                          ? 'text-text'
                          : 'text-text-faint',
                    )}
                  >
                    {bestConfCount}
                  </span>{' '}
                  <span className="text-text-faint">{bestConfLevel}-confidence</span>
                </>
              )}
            </div>
            {highConf.length > 0 && (
              <div className="font-mono text-[10px] text-good">
                {fmtUsd(highConf.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0))} / mo
                high-conf
              </div>
            )}
          </div>

          {[
            {
              label: `Spend · ${windowLabel}`,
              value: fmtUsd(totalSpend),
              delta: 'analyzed models',
              good: false,
            },
            {
              label: 'Recommendations',
              value: String(recs.length),
              delta: 'model swaps',
              good: false,
            },
            {
              label: 'Total samples',
              value: totalSamples.toLocaleString(),
              delta: `${modelCount} models analyzed`,
              good: false,
            },
          ].map((s, i) => (
            <div
              key={i}
              className={cn('px-[16px] py-[16px]', i < 2 && 'border-r border-border')}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
                {s.label}
              </div>
              <div
                className={cn(
                  'text-[28px] font-medium leading-none tracking-[-0.8px]',
                  s.good ? 'text-good' : 'text-text',
                )}
              >
                {s.value}
              </div>
              <div className="font-mono text-[10px] text-text-muted mt-1.5 whitespace-nowrap">
                {s.delta}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0">
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">
          Type
        </span>
        <span className="font-mono text-[11px] text-text px-[9px] py-[3px] border border-border-strong bg-bg-elev rounded-[4px]">
          model swap · {recs.length}
        </span>
        <span className="flex-1" />
        <span className="hidden sm:inline font-mono text-[10px] text-text-faint whitespace-nowrap shrink-0">
          Sorted by estimated monthly savings · desc
        </span>
      </div>

      {/* Recommendations list */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
            Open · {recs.length} · {fmtUsd(totalSavings)} / mo
          </span>
        </div>

        {recs.map((r, i) => (
          <RecRow
            key={`${r.currentProvider}-${r.currentModel}-${i}`}
            r={r}
            windowLabel={windowLabel}
            onApply={() => setShowDemoNotice(true)}
          />
        ))}
      </div>
    </div>
  )
}
