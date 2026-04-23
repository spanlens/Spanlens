'use client'
import Link from 'next/link'
import { useSecurityFlagged, useSecuritySummary } from '@/lib/queries/use-security'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const STATIC_DETECTORS = [
  { id: 'pii.email',     name: 'Email addresses',    pattern: '/[\\w.+-]+@[\\w.-]+/',     on: true,  action: 'mask',  hits24h: 0, leaks: 0 },
  { id: 'pii.phone',     name: 'Phone numbers',      pattern: '/\\+?\\d{3}[- ]?\\d{3,4}/', on: true,  action: 'mask',  hits24h: 0, leaks: 0 },
  { id: 'pii.card',      name: 'Credit cards (PAN)', pattern: 'Luhn · 13–19 digits',      on: true,  action: 'block', hits24h: 0, leaks: 0 },
  { id: 'pii.ssn',       name: 'SSN / RRN',          pattern: '\\d{3}-\\d{2}-\\d{4}',     on: true,  action: 'block', hits24h: 0, leaks: 0 },
  { id: 'sec.secret',    name: 'API keys / tokens',  pattern: 'AWS · GCP · GH · Bearer',  on: true,  action: 'block', hits24h: 0, leaks: 0 },
  { id: 'sec.injection', name: 'Prompt injection',   pattern: 'classifier · ≥0.8',        on: true,  action: 'flag',  hits24h: 0, leaks: 0 },
  { id: 'sec.jailbreak', name: 'Jailbreak intent',   pattern: 'classifier · ≥0.8',        on: false, action: 'flag',  hits24h: 0, leaks: 0 },
  { id: 'sec.toxicity',  name: 'Toxic output',       pattern: 'classifier · ≥0.7',        on: true,  action: 'flag',  hits24h: 0, leaks: 0 },
]

function ActionBadge({ action }: { action: string }) {
  const accent = action === 'block'
  return (
    <span
      className={cn(
        'font-mono text-[10px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
        accent
          ? 'text-accent border-accent-border bg-accent-bg'
          : 'text-text-faint border-border',
      )}
    >
      {action}
    </span>
  )
}

export default function SecurityPage() {
  const summary = useSecuritySummary(24)
  const flagged = useSecurityFlagged({ limit: 50 })

  const summaryData = summary.data ?? []
  const flaggedData = flagged.data ?? []

  // Merge static detectors with real summary counts
  const detectors = STATIC_DETECTORS.map((d) => {
    const real = summaryData.filter(
      (s) =>
        (d.id.startsWith('pii') && s.type === 'pii') ||
        (d.id.startsWith('sec.injection') && s.type === 'injection'),
    )
    const hits = real.reduce((sum, r) => sum + r.count, 0)
    return { ...d, hits24h: d.id === 'pii.email' || d.id === 'sec.injection' ? hits : d.hits24h }
  })

  const totalHits = summaryData.reduce((s, r) => s + r.count, 0)
  const piiHits = summaryData.filter((s) => s.type === 'pii').reduce((s, r) => s + r.count, 0)
  const injHits = summaryData.filter((s) => s.type === 'injection').reduce((s, r) => s + r.count, 0)
  const leaks = flaggedData.filter((r) => r.flags.some((f) => f.type === 'pii')).length

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Security' }]}
        right={
          <span className="font-mono text-[11px] text-text-muted px-[9px] py-[4px] border border-border rounded-[5px] cursor-pointer hover:text-text transition-colors">
            Detector settings
          </span>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {[
          { label: 'Events · 24h',      value: String(totalHits),            warn: totalHits > 0 },
          { label: 'PII hits',          value: String(piiHits),              warn: piiHits > 0 },
          { label: 'Injection attempts',value: String(injHits),              warn: injHits > 0 },
          { label: 'Leaks detected',    value: String(leaks),                warn: leaks > 0 },
          { label: 'Detectors active',  value: String(detectors.filter((d) => d.on).length), warn: false },
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
        {/* Detector configuration table */}
        <div className="px-[22px] pt-[18px] pb-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
            Detectors — {detectors.filter((d) => d.on).length} active
          </div>

          {/* Column headers */}
          <div
            className="grid font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[14px] py-[8px] bg-bg-muted border border-border rounded-t-[6px] border-b-0"
            style={{ gridTemplateColumns: '1fr 1.4fr 80px 80px 80px 80px' }}
          >
            <span>Detector</span>
            <span>Pattern</span>
            <span>Status</span>
            <span>Action</span>
            <span className="text-right">Hits 24h</span>
            <span className="text-right">Leaks</span>
          </div>

          <div className="border border-border rounded-b-[6px] overflow-hidden">
            {detectors.map((d, i) => (
              <div
                key={d.id}
                className={cn(
                  'grid items-center px-[14px] py-[11px] font-mono text-[12px]',
                  i < detectors.length - 1 && 'border-b border-border',
                  !d.on && 'opacity-50',
                )}
                style={{ gridTemplateColumns: '1fr 1.4fr 80px 80px 80px 80px' }}
              >
                <span className="text-text text-[12.5px]">{d.name}</span>
                <span className="text-text-faint text-[11px] truncate pr-4">{d.pattern}</span>
                <span>
                  <span
                    className={cn(
                      'font-mono text-[10px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
                      d.on ? 'text-good border-good/30 bg-good-bg' : 'text-text-faint border-border',
                    )}
                  >
                    {d.on ? 'ON' : 'OFF'}
                  </span>
                </span>
                <ActionBadge action={d.action} />
                <span className={cn('text-right', d.hits24h > 0 ? 'text-accent font-medium' : 'text-text-faint')}>
                  {d.hits24h}
                </span>
                <span className={cn('text-right', d.leaks > 0 ? 'text-bad font-medium' : 'text-text-faint')}>
                  {d.leaks}
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
