'use client'
import Link from 'next/link'
import {
  useSecurityFlagged,
  useSecuritySummary,
  useSecuritySettings,
  useToggleSecurityAlert,
  useToggleProjectBlock,
} from '@/lib/queries/use-security'
import { Topbar } from '@/components/layout/topbar'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn } from '@/lib/utils'

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

/**
 * Detector catalog mirrors what `apps/server/src/lib/security-scan.ts` actually
 * detects and flags on `requests.flags`. Every detector here is always-on (no
 * toggle backend yet) and its mode is "flag" (no masking or blocking — flags
 * are observability only).
 *
 * `summaryKey` matches the `pattern` string that `security_summary` groups by.
 */
interface DetectorDef {
  id: string
  name: string
  description: string
  type: 'pii' | 'injection'
  summaryKey: string
}

const DETECTORS: readonly DetectorDef[] = [
  { id: 'pii.email',    name: 'Email addresses',     description: 'user@example.com',         type: 'pii',       summaryKey: 'email' },
  { id: 'pii.phone',    name: 'Phone numbers',       description: 'E.164 + common formats',   type: 'pii',       summaryKey: 'phone' },
  { id: 'pii.card',     name: 'Credit cards',        description: '13–19 digit PANs',         type: 'pii',       summaryKey: 'credit-card' },
  { id: 'pii.ssn-us',   name: 'US SSN',              description: 'NNN-NN-NNNN',              type: 'pii',       summaryKey: 'ssn-us' },
  { id: 'pii.ssn-kr',   name: 'Korean RRN',          description: '주민등록번호 XXXXXX-XXXXXXX', type: 'pii',    summaryKey: 'ssn-kr' },
  { id: 'pii.iban',     name: 'IBAN',                description: 'EU + UK + 30 countries',   type: 'pii',       summaryKey: 'iban' },
  { id: 'pii.passport', name: 'Passport numbers',    description: 'Generic letter+digit',     type: 'pii',       summaryKey: 'passport' },
  { id: 'sec.injection', name: 'Prompt injection',   description: 'Override/reveal/role/jailbreak/smuggle (EN + KO)', type: 'injection', summaryKey: '*' },
]

/** Simple toggle switch component */
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

export default function SecurityPage() {
  const summary = useSecuritySummary(24)
  const flagged = useSecurityFlagged({ limit: 50 })
  const settings = useSecuritySettings()
  const toggleAlert = useToggleSecurityAlert()
  const toggleBlock = useToggleProjectBlock()

  const summaryData = summary.data ?? []
  const flaggedData = flagged.data?.data ?? []
  const flaggedTotal = flagged.data?.total ?? 0
  const settingsData = settings.data

  // Merge detector catalog with real summary counts (by type + pattern name)
  const detectors = DETECTORS.map((d) => {
    const hits24h = d.summaryKey === '*'
      ? summaryData.filter((s) => s.type === d.type).reduce((sum, r) => sum + r.count, 0)
      : summaryData
          .filter((s) => s.type === d.type && s.pattern === d.summaryKey)
          .reduce((sum, r) => sum + r.count, 0)
    return { ...d, hits24h }
  })

  const statsReady = !summary.isLoading && !summary.isError
  const flaggedReady = !flagged.isLoading && !flagged.isError
  const settingsReady = !settings.isLoading && !settings.isError
  const totalHits = summaryData.reduce((s, r) => s + r.count, 0)
  const piiHits = summaryData.filter((s) => s.type === 'pii').reduce((s, r) => s + r.count, 0)
  const injHits = summaryData.filter((s) => s.type === 'injection').reduce((s, r) => s + r.count, 0)

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Security' }]}
      />

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            { label: 'Events · 24h',      value: statsReady ? String(totalHits) : '—',  warn: statsReady && totalHits > 0 },
            { label: 'PII hits',          value: statsReady ? String(piiHits)  : '—',  warn: statsReady && piiHits > 0 },
            { label: 'Injection attempts',value: statsReady ? String(injHits)  : '—',  warn: statsReady && injHits > 0 },
            { label: 'Recent flagged',    value: flaggedReady ? String(flaggedTotal) : '—', warn: flaggedReady && flaggedTotal > 0 },
            { label: 'Detectors',         value: String(detectors.length),              warn: false },
          ].map((s) => (
            <div key={s.label} className={cn('px-[18px] py-[14px]', s.label !== 'Detectors' && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">

        {/* ── Alert + Blocking settings ───────────────────────────────────── */}
        <div className="px-[22px] pt-[18px] pb-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Alert emails */}
            <div className="border border-border rounded-[6px] px-[16px] py-[14px]">
              <div className="flex items-center justify-between mb-[6px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Alert emails
                </span>
                <Toggle
                  checked={settingsData?.alertEnabled ?? false}
                  disabled={!settingsReady || toggleAlert.isPending}
                  onChange={(enabled) => toggleAlert.mutate(enabled)}
                />
              </div>
              <p className="text-[11.5px] text-text-faint leading-relaxed">
                Email workspace owner when security flags are detected.
                Rate-limited to one email per 5 minutes.
              </p>
            </div>

            {/* Injection blocking — per-project */}
            <div className="border border-border rounded-[6px] px-[16px] py-[14px]">
              <div className="mb-[8px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Injection blocking — per project
                </span>
              </div>
              {settings.isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="h-6 bg-bg-elev rounded animate-pulse" />)}
                </div>
              ) : settings.isError ? (
                <p className="text-[11.5px] text-accent">Failed to load projects.</p>
              ) : (settingsData?.projects ?? []).length === 0 ? (
                <p className="text-[11.5px] text-text-faint">No projects found.</p>
              ) : (
                <div className="space-y-[6px]">
                  {(settingsData?.projects ?? []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <span className="font-mono text-[11.5px] text-text truncate pr-3">{p.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.blockEnabled && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border border-accent-border bg-accent-bg text-accent">
                            blocking
                          </span>
                        )}
                        <Toggle
                          checked={p.blockEnabled}
                          disabled={toggleBlock.isPending}
                          onChange={(enabled) =>
                            toggleBlock.mutate({ projectId: p.id, enabled })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-text-faint mt-[8px] leading-relaxed">
                When ON, injection attempts return 422 — request never reaches the LLM.
              </p>
            </div>
          </div>
        </div>

        {/* ── Detector table ─────────────────────────────────────────────── */}
        <div className="px-[22px] pt-[14px] pb-0">
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Detectors — {detectors.length} active · flag-only (no blocking unless enabled above)
            </span>
            <ExportDropdown
              filename="spanlens-security"
              buildUrl={(fmt) => `/api/v1/exports/security?format=${fmt}`}
            />
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
                <span className="text-text-faint text-[11px] truncate pr-4">{d.description}</span>
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
                <span className={cn('text-right', statsReady && d.hits24h > 0 ? 'text-accent font-medium' : 'text-text-faint')}>
                  {statsReady ? d.hits24h : '—'}
                </span>
              </div>
            ))}
          </div>
          </div>
        </div>

        {/* ── Recent flagged requests ─────────────────────────────────────── */}
        <div className="px-[22px] py-[18px]">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
            Recent flagged requests
          </div>

          {flagged.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />)}
            </div>
          ) : flagged.isError ? (
            <div className="rounded-md border border-accent-border bg-accent-bg px-[14px] py-[18px] text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-accent mb-1.5">Error</div>
              <p className="text-[12.5px] text-text-faint">Failed to load flagged requests.</p>
            </div>
          ) : flaggedData.length === 0 ? (
            <div className="rounded-md border border-border bg-bg-elev px-[14px] py-[18px] text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-good mb-1.5">All clear</div>
              <p className="text-[12.5px] text-text-faint">No flagged requests found.</p>
            </div>
          ) : (
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
                        'grid items-center px-[14px] py-[10px] min-w-[420px]',
                        i < flaggedData.length - 1 && 'border-b border-border',
                        'hover:bg-bg-elev transition-colors',
                      )}
                      style={{ gridTemplateColumns: '110px 1fr 1fr 80px' }}
                    >
                      <span className="font-mono text-[11.5px] text-text-muted">{formatRelative(r.created_at)}</span>
                      <span className="font-mono text-[12px] text-text">{r.provider} / {r.model}</span>
                      <div className="flex flex-wrap gap-1">
                        {reqFlags.map((f, fi) => (
                          <span
                            key={`req:${f.type}:${f.pattern}:${fi}`}
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
                              'font-mono text-[10px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border',
                              f.type === 'injection'
                                ? 'border-accent-border bg-accent-bg text-accent'
                                : 'border-border text-text-muted',
                              'opacity-70',
                            )}
                          >
                            ↩ {f.pattern}
                          </span>
                        ))}
                      </div>
                      <div className="text-right">
                        <Link href={`/requests/${r.id}`} className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity">
                          Details →
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
