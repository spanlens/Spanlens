'use client'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { downloadBlob, exportFilename, toCsv, type CsvColumn } from '@/lib/demo-export'

interface DemoExportButtonProps<T> {
  /** Rows currently shown (respects active filters/sort). */
  rows: readonly T[]
  /** Column spec for CSV. JSON export dumps rows as-is. */
  columns: readonly CsvColumn<T>[]
  /** Filename base, e.g. "users" -> spanlens-demo-users-YYYY-MM-DD.csv */
  base: string
  className?: string
}

/**
 * Client-side CSV/JSON export for demo pages. Mirrors the real <ExportDropdown>
 * look, but builds the file from in-memory rows instead of hitting the API.
 */
export function DemoExportButton<T>({ rows, columns, base, className }: DemoExportButtonProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside)
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function handleExport(format: 'csv' | 'json'): void {
    setOpen(false)
    const content =
      format === 'csv'
        ? toCsv(rows, columns)
        : JSON.stringify(rows, null, 2)
    const mime = format === 'csv' ? 'text/csv' : 'application/json'
    downloadBlob(exportFilename(base, format), content, mime)
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[11px] text-text-muted hover:text-text border border-border hover:border-border-strong transition-colors"
      >
        <Download className="h-3 w-3" />
        Export
        <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-[6px] shadow-lg py-1 min-w-[90px]">
          {(['csv', 'json'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => handleExport(fmt)}
              className="w-full text-left px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg-elev transition-colors"
            >
              {fmt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
