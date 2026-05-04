'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { DEMO_SECURITY_SUMMARY, DEMO_FLAGGED_REQUESTS } from '@/lib/demo-data'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const diff = (Date.now() - ms) / 1000
  if (diff < 0) return 'just now'
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── Detector definitions (mirrors security/page.tsx) ─────────────────────────

interface DetectorDef {
  id: string
  name: string
  description: string
  type: 'pii' | 'injection'
  summaryKey: string
}

const DETECTORS: readonly DetectorDef[] = [
  {
    id: 'pii.email',
    name: 'Email addresses',
    description: 'user@example.com',
    type: 'pii',
    summaryKey: 'email',
  },
  {
    id: 'pii.phone',
    name: 'Phone numbers',
    description: 'E.164 + common formats',
    type: 'pii',
    summaryKey: 'phone',
  },
  {
    id: 'pii.card',
    name: 'Credit cards',
    description: '13–19 digit PANs',
    type: 'pii',
    summaryKey: 'credit-card',
  },
  {
    id: 'pii.ssn-us',
    name: 'US SSN',
    description: 'NNN-NN-NNNN',
    type: 'pii',
    summaryKey: 'ssn-us',
  },
  {
    id: 'pii.ssn-kr',
    name: 'Korean RRN',
    description: '주민등록번호 XXXXXX-XXXXXXX',
    type: 'pii',
    summaryKey: 'ssn-kr',
  },
  {
    id: 'pii.iban',
    name: 'IBAN',
    description: 'EU + UK + 30 countries',
    type: 'pii',
    summaryKey: 'iban',
  },
  {
    id: 'pii.passport',
    name: 'Passport numbers',
    description: 'Generic letter+digit',
    type: 'pii',
    summaryKey: 'passport',
  },
  {
    id: 'sec.injection',
    name: 'Prompt injection',
    description: 'Override/reveal/role/jailbreak/smuggle (EN + KO)',
    type: 'injection',
    summaryKey: '*',
  },
]

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title="Sign up to configure"
      className={cn(
        'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border transition-colors duration-150 focus-visible:outline-none',
        checked ? 'bg-accent border-accent' : 'bg-bg-elev border-border',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-[12px] w-[12px] rounded-full bg-white shadow-sm transition-transform duration-150 mt-[2px]',
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

// ── DemoSignupTooltip ─────────────────────────────────────────────────────────

function DemoConfigNotice({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[400px] bg-bg border border-border rounded-[8px] shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-mono text-[14px] font-medium text-text">Demo mode</h2>
        <p className="text-[13px] text-text-muted leading-relaxed">
          Sign up to configure alert emails and injection blocking for your projects.
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DemoSecurityPage() {
  const [showConfigNotice, setShowConfigNotice] = useState(false)

  // Demo state: alerts enabled, blocking disabled
  const [alertEnabled, setAlertEnabled] = useState(false)
  const [blockEnabled, setBlockEnabled] = useState(false)

  const summaryData = DEMO_SECURITY_SUMMARY
  const flaggedData = DEMO_FLAGGED_REQUESTS

  // Merge detector catalog with demo summary counts
  const detectors = DETECTORS.map((d) => {
    const hits24h =
      d.summaryKey === '*'
        ? summaryData.filter((s) => s.type === d.type).reduce((sum, r) => sum + r.count, 0)
        : summaryData
            .filter((s) => s.type === d.type && s.pattern === d.summaryKey)
            .reduce((sum, r) => sum + r.count, 0)
    return { ...d, hits24h }
  })

  const totalHits = summaryData.reduce((s, r) => s + r.count, 0)
  const piiHits = summaryData.filter((s) => s.type === 'pii').reduce((s, r) => s + r.count, 0)
  const injHits = summaryData
    .filter((s) => s.type === 'injection')
    .reduce((s, r) => s + r.count, 0)

  function handleToggle(type: 'alert' | 'block', value: boolean) {
    if (type === 'alert') setAlertEnabled(value)
    else setBlockEnabled(value)
    setShowConfigNotice(true)
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      {showConfigNotice && <DemoConfigNotice onClose={() => setShowConfigNotice(false)} />}

      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Security' }]}
      />

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            {
              label: 'Events · 24h',
              value: String(totalHits),
              warn: totalHits > 0,
            },
            {
              label: 'PII hits',
              value: String(piiHits),
              warn: piiHits > 0,
            },
            {
              label: 'Injection attempts',
              value: String(injHits),
              warn: injHits > 0,
            },
            {
              label: 'Recent flagged',
              value: String(flaggedData.length),
              warn: flaggedData.length > 0,
            },
            {
              label: 'Detectors',
              value: String(detectors.length),
              warn: false,
            },
          ].map((s) => (
            <div
              key={s.label}
              className={cn(
                'px-[18px] py-[14px]',
                s.label !== 'Detectors' && 'border-r border-border',
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
                {s.label}
              </div>
              <span
                className={cn(
                  'text-[24px] font-medium leading-none tracking-[-0.6px]',
                  s.warn ? 'text-accent' : 'text-text',
                )}
              >
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Alert + Blocking settings */}
        <div className="px-[22px] pt-[18px] pb-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Alert emails */}
            <div className="border border-border rounded-[6px] px-[16px] py-[14px]">
              <div className="flex items-center justify-between mb-[6px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Alert emails
                </span>
                <Toggle
                  checked={alertEnabled}
                  onChange={(v) => handleToggle('alert', v)}
                />
              </div>
              <p className="text-[11.5px] text-text-faint leading-relaxed">
                Email workspace owner when security flags are detected. Rate-limited to one
                email per 5 minutes.
              </p>
              <p className="text-[10.5px] text-text-faint mt-2 font-mono">
                Sign up to configure →
              </p>
            </div>

            {/* Injection blocking */}
            <div className="border border-border rounded-[6px] px-[16px] py-[14px]">
              <div className="mb-[8px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Injection blocking — per project
                </span>
              </div>
              <div className="space-y-[6px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11.5px] text-text truncate pr-3">
                    Demo Project
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Toggle
                      checked={blockEnabled}
                      onChange={(v) => handleToggle('block', v)}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-text-faint mt-[8px] leading-relaxed">
                When ON, injection attempts return 422 — request never reaches the LLM.
              </p>
              <p className="text-[10.5px] text-text-faint mt-2 font-mono">
                Sign up to configure →
              </p>
            </div>
          </div>
        </div>

        {/* Detector table */}
        <div className="px-[22px] pt-[14px] pb-0">
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Detectors — {detectors.length} active · flag-only (no blocking unless enabled
              above)
            </span>
          </div>

          <div className="overflow-x-auto">
            {/* Column headers */}
            <div
              className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border border-border rounded-t-[6px] border-b-0 min-w-[420px]"
              style={{ gridTemplateColumns: '1fr 1.6fr 100px 90px' }}
            >
              <span>Detector</span>
              <span>Description</span>
              <span>Type</span>
              <span className="text-right">Hits · 24h</span>
            </div>

            <div className="border border-border rounded-b-[6px] overflow-hidden min-w-[420px]">
              {detectors.map((d, i) => (
                <div
                  key={d.id}
                  className={cn(
                    'grid items-center px-[14px] py-[11px] font-mono text-[12px] min-w-[420px]',
                    i < detectors.length - 1 && 'border-b border-border',
                  )}
                  style={{ gridTemplateColumns: '1fr 1.6fr 100px 90px' }}
                >
                  <span className="text-text text-[12.5px]">{d.name}</span>
                  <span className="text-text-faint text-[11px] truncate pr-4">
                    {d.description}
                  </span>
                  <span>
                    <span
                      className={cn(
                        'font-mono text-[10px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
                        d.type === 'injection'
                          ? 'text-accent border-accent-border bg-accent-bg'
                          : 'text-text-muted border-border',
                      )}
                    >
                      {d.type}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'text-right',
                      d.hits24h > 0 ? 'text-accent font-medium' : 'text-text-faint',
                    )}
                  >
                    {d.hits24h}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent flagged requests */}
        <div className="px-[22px] py-[18px]">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
            Recent flagged requests
          </div>

          <div className="overflow-x-auto">
            <>
              {/* Header row */}
              <div
                className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border border-border rounded-t-[6px] border-b-0 min-w-[420px]"
                style={{ gridTemplateColumns: '110px 1fr 1fr 80px' }}
              >
                <span>When</span>
                <span>Model</span>
                <span>Flags</span>
                <span className="text-right">→</span>
              </div>

              <div className="border border-border rounded-b-[6px] overflow-hidden min-w-[420px]">
                {flaggedData.map((r, i) => {
                  const reqFlags = r.flags ?? []
                  const resFlags = r.response_flags ?? []
                  return (
                    <div
                      key={r.id}
                      className={cn(
                        'grid items-center px-[14px] py-[10px] min-w-[420px] hover:bg-bg-elev transition-colors',
                        i < flaggedData.length - 1 && 'border-b border-border',
                      )}
                      style={{ gridTemplateColumns: '110px 1fr 1fr 80px' }}
                    >
                      <span className="font-mono text-[11.5px] text-text-muted">
                        {formatRelative(r.created_at)}
                      </span>
                      <span className="font-mono text-[12px] text-text">
                        {r.provider} / {r.model}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {reqFlags.map((f, fi) => (
                          <span
                            key={`req:${f.type}:${f.pattern}:${fi}`}
                            title={f.sample}
                            className={cn(
                              'font-mono text-[10px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border',
                              f.type === 'injection'
                                ? 'border-accent-border bg-accent-bg text-accent'
                                : 'border-border text-text-muted',
                            )}
                          >
                            {f.pattern}
                          </span>
                        ))}
                        {resFlags.map((f, fi) => (
                          <span
                            key={`res:${f.type}:${f.pattern}:${fi}`}
                            title="Detected in LLM response"
                            className={cn(
                              'font-mono text-[10px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border opacity-70',
                              f.type === 'injection'
                                ? 'border-accent-border bg-accent-bg text-accent'
                                : 'border-border text-text-muted',
                            )}
                          >
                            ↩ {f.pattern}
                          </span>
                        ))}
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-[11.5px] text-text-muted">
                          {r.status_code >= 400 ? (
                            <span className="text-bad">{r.status_code}</span>
                          ) : (
                            <span className="text-good">{r.status_code}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          </div>
        </div>
      </div>
    </div>
  )
}
