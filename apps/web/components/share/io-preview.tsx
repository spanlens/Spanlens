'use client'

/**
 * IOPreview — input / output split panel for the public share viewer.
 *
 * R-26 + R-33 (Sprint 5) goal: make the `/share/:token` page render LLM
 * I/O the way a non-Spanlens reader expects to scan it — input on the
 * left, output on the right, side-by-side on desktop. The previous
 * `<JsonBlock>` rendering stacked them vertically inside a `<details>`,
 * which made comparison awkward on a marketing-grade share link.
 *
 * Layout:
 *   - Desktop (md+): `grid-cols-2` so input and output sit at equal
 *     widths and scroll independently.
 *   - Mobile (<md): single column, output below input. Tailwind's
 *     `md:grid-cols-2 grid-cols-1` defers to the smaller breakpoint
 *     by default — no JS to thrash on resize.
 *
 * JSON pretty rendering: we keep the simple `<pre>` rendering instead
 * of pulling in `react-json-view` (113 KB unpacked, requires `'use
 * client'` deep in the tree and ships React 18 peer dep that conflicts
 * with our React 19 install). The whitespace-pre-wrap + monospace gets
 * 95% of the visual benefit with no bundle cost. Depth-5+ nested
 * payloads render fine — JSON.stringify(value, null, 2) indents every
 * level uniformly and the container scrolls horizontally if needed.
 *
 * Empty values: when one side is null/undefined, we still render the
 * panel with a "—" placeholder so the grid keeps a stable 2-column
 * shape (otherwise the remaining panel snaps to full width and the
 * layout shifts when the user toggles span details).
 */

interface IOPreviewProps {
  input: unknown
  output: unknown
  /** Optional small label above each pane — defaults to "Input"/"Output". */
  inputLabel?: string
  outputLabel?: string
}

function formatValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    // Circular ref or non-serialisable — fall back to a reasonable string.
    return String(value)
  }
}

export function IOPreview({
  input,
  output,
  inputLabel = 'Input',
  outputLabel = 'Output',
}: IOPreviewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <IOPane label={inputLabel} value={input} />
      <IOPane label={outputLabel} value={output} />
    </div>
  )
}

function IOPane({ label, value }: { label: string; value: unknown }) {
  const text = formatValue(value)
  const isEmpty = value == null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
        {label}
      </div>
      <pre
        className={
          'bg-bg-elevated border border-border rounded-md p-3 font-mono text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words max-h-[480px] overflow-y-auto ' +
          (isEmpty ? 'text-text-muted italic' : '')
        }
      >
        {text}
      </pre>
    </div>
  )
}
