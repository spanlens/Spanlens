/**
 * Client-side export helpers for the demo pages.
 *
 * The real dashboard uses <ExportDropdown> which calls `apiDownload` against
 * the server. Demo pages have no API, so they build CSV/JSON in the browser
 * from the in-memory DEMO_* arrays and trigger a download via a Blob URL.
 *
 * Keep this dependency-free and framework-agnostic so any demo page can reuse it.
 */

/** RFC 4180 field escaping: wrap in quotes if the value contains comma, quote, or newline. */
export function csvField(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`
  }
  return s
}

export interface CsvColumn<T> {
  /** Header cell text. */
  header: string
  /** Pull the cell value out of a row. */
  value: (row: T) => unknown
}

/** Build an RFC 4180 CSV string from rows + a column spec. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => csvField(c.header)).join(',')
  const body = rows
    .map((r) => columns.map((c) => csvField(c.value(r))).join(','))
    .join('\r\n')
  return body ? `${head}\r\n${body}` : head
}

/** Trigger a browser download for the given text content. */
export function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Date-stamped filename, e.g. "spanlens-demo-users-2026-05-29.csv". */
export function exportFilename(base: string, format: 'csv' | 'json'): string {
  const dateStr = new Date().toISOString().slice(0, 10)
  return `spanlens-demo-${base}-${dateStr}.${format}`
}
