'use client'
import Link from 'next/link'
import { useSecurityFlagged, useSecuritySummary } from '@/lib/queries/use-security'
import { Topbar } from '@/components/layout/topbar'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn } from '@/lib/utils'

function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
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
  { id: 'pii.ssn',      name: 'US SSN',              description: 'NNN-NN-NNNN',              type: 'pii',       summaryKey: 'ssn-us' },
  { id: 'pii.passport', name: 'Passport numbers',    description: 'Generic letter+digit',     type: 'pii',       summaryKey: 'passport' },
  { id: 'sec.injection', name: 'Prompt injection',   description: 'Override/reveal/role/jailbreak/smuggle', type: 'injection', summaryKey: '*' },
]

export default function SecurityPage() {
  const summary = useSecuritySummary(24)
  const flagged = useSecurityFlagged({ limit: 50 })

  const summaryData = summary.data ?? []
  const flaggedData = flagged.data ?? []

  // Merge detector catalog with real summary counts (by type + pattern name)
  const detectors = DETECTORS.map((d) => {
    const hits24h = d.summaryKey === '*'
      // injection aggregates across all injection sub-patterns
      ? summaryData.filter((s) => s.type === d.type).reduce((sum, r) => sum + r.count, 0)
      : summaryData
          .filter((s) => s.type === d.type && s.pattern === d.summaryKey)
          .reduce((sum, r) => sum + r.count, 0)
    return { ...d, hits24h }
  })

  const totalHits = summaryData.reduce((s, r) => s + r.count, 0)
  const piiHits = summaryData.filter((s) => s.type === 'pii').reduce((s, r) => s + r.count, 0)
  const injHits = summaryData.filter((s) => s.type === 'injection').reduce((s, r) => s + r.count, 0)

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Security' }]}
        right={
          <ExportDropdown
            filename="spanlens-security"
            buildUrl={(fmt) => `/api/v1/exports/security?format=${fmt}`}
          />
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {[
          { label: 'Events · 24h',      value: String(totalHits),           warn: totalHits > 0 },
          { label: 'PII hits',          value: String(piiHits),             warn: piiHits > 0 },
          { label: 'Injection attempts',value: String(injHits),             warn: injHits > 0 },
          { label: 'Flagged requests',  value: String(flaggedData.length),  warn: flaggedData.length > 0 },
          { label: 'Detectors',         value: String(detectors.length),    warn: false },
        ].map((s, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {/* Detector table */}
        <div className="px-[22px] pt-[18px] pb-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
            Detectors — {detectors.length} active · flag-only (no blocking)
          </div>

          {/* Column headers */}
          <div
            className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border border-border rounded-t-[6px] border-b-0"
            style={{ gridTemplateColumns: '1fr 1.6fr 100px 90px' }}
          >
            <span>Detector</span>
            <span>Description</span>
            <span>Type</span>
            <span className="text-right">Hits · 24h</span>
          </div>

          <div className="border border-border rounded-b-[6px] overflow-hidden">
            {detectors.map((d, i) => (
              <div
                key={d.id}
                className={cn(
                  'grid items-center px-[14px] py-[11px] font-mono text-[12px]',
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
                <span className={cn('text-right', d.hits24h > 0 ? 'text-accent font-medium' : 'text-text-faint')}>
                  {d.hits24h}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent flagged requests */}
        <div className="px-[22px] py-[18px]">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
            Recent flagged requests
          </div>

          {flagged.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />)}
            </div>
          ) : flaggedData.length === 0 ? (
            <div className="rounded-md border border-border bg-bg-elev px-[14px] py-[18px] text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-good mb-1.5">All clear</div>
              <p className="text-[12.5px] text-text-faint">No suspicious patterns detected in the last 24h.</p>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div
                className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border border-border rounded-t-[6px] border-b-0"
                style={{ gridTemplateColumns: '120px 1fr 1fr 80px' }}
              >
                <span>When</span>
                <span>Model</span>
                <span>Flags</span>
                <span className="text-right">→</span>
              </div>
              <div className="border border-border rounded-b-[6px] overflow-hidden">
                {flaggedData.map((r, i) => (
                  <div
                    key={r.id}
                    className={cn(
                      'grid items-center px-[14px] py-[10px]',
                      i < flaggedData.length - 1 && 'border-b border-border',
                      'hover:bg-bg-elev transition-colors',
                    )}
                    style={{ gridTemplateColumns: '120px 1fr 1fr 80px' }}
                  >
                    <span className="font-mono text-[11.5px] text-text-muted">{formatRelative(r.created_at)}</span>
                    <span className="font-mono text-[12px] text-text">{r.provider} / {r.model}</span>
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f, fi) => (
                        <span
                          key={fi}
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
                    </div>
                    <div className="text-right">
                      <Link href={`/requests/${r.id}`} className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity">
                        Details →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
