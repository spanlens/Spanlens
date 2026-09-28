'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Download, X } from 'lucide-react'
import { ApiError, DownloadInterruptedError, apiDownload } from '@/lib/api'
import { cn } from '@/lib/utils'

type ExportFormat = 'csv' | 'json'

interface ExportDropdownProps {
  buildUrl: (format: ExportFormat) => string
  filename: string
}

interface ExportFailure {
  readonly format: ExportFormat
  readonly message: string
}

const FORMATS: readonly ExportFormat[] = ['csv', 'json']

/**
 * What the user reads when an export fails. Server messages are written for
 * people and pass through; transport failures are not, so they get a sentence.
 */
function describeExportError(err: unknown): string {
  if (err instanceof DownloadInterruptedError) {
    return `${err.message} Try again, or narrow the filters for a smaller file.`
  }
  if (err instanceof ApiError && !/^HTTP \d+$/.test(err.message)) return err.message
  if (err instanceof TypeError) return 'Could not reach the server. Check your connection and try again.'
  return 'The export failed on our side. Try again in a moment.'
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExportDropdown({ buildUrl, filename }: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receivedBytes, setReceivedBytes] = useState<number | null>(null)
  const [failure, setFailure] = useState<ExportFailure | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  async function download(format: ExportFormat): Promise<void> {
    if (busy) return
    setOpen(false)
    setFailure(null)
    setBusy(true)
    try {
      const dateStr = new Date().toISOString().slice(0, 10)
      await apiDownload(buildUrl(format), `${filename}-${dateStr}.${format}`, {
        onProgress: setReceivedBytes,
      })
    } catch (err) {
      setFailure({ format, message: describeExportError(err) })
    } finally {
      setBusy(false)
      setReceivedBytes(null)
    }
  }

  function toggleMenu(): void {
    setFailure(null)
    setOpen((v) => !v)
  }

  const label = !busy
    ? 'Export'
    : receivedBytes
      ? `Exporting… ${formatMegabytes(receivedBytes)}`
      : 'Exporting…'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggleMenu}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[11px] text-text-muted hover:text-text border border-border hover:border-border-strong transition-colors disabled:opacity-40"
      >
        <Download className="h-3 w-3" />
        {label}
        <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 w-64 max-w-[calc(100vw-32px)] bg-bg-elev border border-border rounded-chip shadow-card py-1"
        >
          {FORMATS.map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="menuitem"
              onClick={() => void download(fmt)}
              className="w-full text-left px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg-muted transition-colors"
            >
              {fmt.toUpperCase()}
            </button>
          ))}
          <p className="mt-1 border-t border-border px-3 pt-2 pb-1.5 text-[11px] leading-snug text-text-faint">
            JSON stops at 10,000 rows. Large CSV files are assembled in this tab before they save,
            so for very large pulls use the{' '}
            <Link href="/docs/features/export" className="underline hover:text-text">
              export API
            </Link>
            .
          </p>
        </div>
      )}

      {failure && !open && (
        <div
          role="alert"
          className="absolute right-0 top-full mt-1 z-50 w-72 max-w-[calc(100vw-32px)] rounded-chip border border-bad bg-bad-bg px-3 py-2 text-[12px] leading-snug text-bad shadow-card"
        >
          <div className="flex items-start gap-2">
            <p className="flex-1">{failure.message}</p>
            <button
              type="button"
              onClick={() => setFailure(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 hover:bg-bad/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => void download(failure.format)}
            className="mt-1.5 font-mono text-[11px] underline hover:no-underline"
          >
            Retry {failure.format.toUpperCase()}
          </button>
        </div>
      )}
    </div>
  )
}
