/**
 * Parses a user-uploaded file (JSON or CSV) into the dataset-item shape the
 * server accepts. Used by the "+ Upload" button on the Eval Run dialog.
 *
 * Accepted shapes:
 *
 *   JSON: an array of objects. Each object must have `input` and an optional
 *         `expected_output` (or `expectedOutput`). `input` can be:
 *           - a plain string         → wrapped as { messages: [{role,user,content}] }
 *           - an object with messages → passed through
 *           - an object with variables → passed through
 *
 *   CSV:  first row = header, columns `input` and optional `expected_output`.
 *         Values may be wrapped in double quotes; commas inside quotes are
 *         preserved. Each row becomes one item with `input` as a string,
 *         which the server then wraps into a single-message conversation.
 *
 * No external deps — keeps the web bundle small.
 */

export interface UploadedItem {
  input: unknown
  expected_output?: string | null
}

export interface ParseResult {
  items: UploadedItem[]
  warnings: string[]
}

/** Top-level entry — sniffs by file extension, falls back by content. */
export async function parseUploadedFile(file: File): Promise<ParseResult> {
  const text = await file.text()
  const ext = file.name.toLowerCase().split('.').pop()

  if (ext === 'json' || (ext !== 'csv' && text.trim().startsWith('['))) {
    return parseJson(text)
  }
  return parseCsv(text)
}

function parseJson(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : 'parse failed'}`)
  }
  if (!Array.isArray(raw)) {
    throw new Error('JSON must be an array of objects, each with an `input` field.')
  }
  const items: UploadedItem[] = []
  const warnings: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as Record<string, unknown> | undefined
    if (!row || typeof row !== 'object') {
      warnings.push(`Row ${i + 1}: not an object — skipped`)
      continue
    }
    if (!('input' in row)) {
      warnings.push(`Row ${i + 1}: missing "input" — skipped`)
      continue
    }
    const expected = row['expected_output'] ?? row['expectedOutput']
    items.push({
      input: row['input'],
      expected_output: typeof expected === 'string' ? expected : null,
    })
  }
  return { items, warnings }
}

/** Minimal CSV parser — handles quoted fields with embedded commas/newlines. */
function parseCsv(text: string): ParseResult {
  const rows = parseCsvRows(text)
  if (rows.length === 0) throw new Error('CSV is empty.')

  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const inputIdx = header.indexOf('input')
  if (inputIdx === -1) {
    throw new Error('CSV header must include "input" (and optionally "expected_output").')
  }
  const expectedIdx = header.findIndex((h) => h === 'expected_output' || h === 'expectedoutput')

  const items: UploadedItem[] = []
  const warnings: string[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!
    const input = row[inputIdx]?.trim() ?? ''
    if (!input) {
      warnings.push(`Row ${i + 1}: empty input — skipped`)
      continue
    }
    items.push({
      input,
      expected_output: expectedIdx >= 0 ? (row[expectedIdx]?.trim() || null) : null,
    })
  }
  return { items, warnings }
}

/**
 * Tokenize CSV. We only support the basics — RFC 4180 quoted fields, comma
 * delimiter, CRLF or LF rows. No escaped quotes (just doubled "" within
 * quoted fields).
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { cur.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') {
      cur.push(field)
      // Skip empty trailing lines from final newline
      if (!(cur.length === 1 && cur[0] === '')) rows.push(cur)
      cur = []
      field = ''
      continue
    }
    field += ch
  }
  // Final field if file doesn't end with newline
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    if (!(cur.length === 1 && cur[0] === '')) rows.push(cur)
  }
  return rows
}

/** Auto-generated name format for uploads. Keeps /datasets list tidy. */
export function generateUploadName(now: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return [
    'upload',
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    `${pad(now.getHours())}${pad(now.getMinutes())}`,
  ].join('-')
}
