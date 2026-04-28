'use client'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { apiDownload } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ExportDropdownProps {
  buildUrl: (format: 'csv' | 'json') => string
  filename: string
}

export function ExportDropdown({ buildUrl, filename }: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  async function download(format: 'csv' | 'json'): Promise<void> {
    if (busy) return
    setOpen(false)
    setBusy(true)
    try {
      const dateStr = new Date().toISOString().slice(0, 10)
      await apiDownload(buildUrl(format), `${filename}-${dateStr}.${format}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[11px] text-text-muted hover:text-text border border-border hover:border-border-strong transition-colors disabled:opacity-40"
      >
        <Download className="h-3 w-3" />
        {busy ? 'Exporting…' : 'Export'}
        <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-[6px] shadow-lg py-1 min-w-[90px]">
          {(['csv', 'json'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => void download(fmt)}
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
