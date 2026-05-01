'use client'
import { useState, useMemo } from 'react'
import { type PromptVersion } from '@/lib/queries/use-prompts'
import { cn } from '@/lib/utils'

interface Props {
  versions: PromptVersion[]
}

type DiffLine =
  | { type: 'same';    text: string }
  | { type: 'added';   text: string }
  | { type: 'removed'; text: string }

/**
 * Compute a simple line-level diff between two strings.
 * Uses a longest-common-subsequence approach via dynamic programming.
 */
function lineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n')
  const bLines = b.split('\n')

  // Build LCS table
  const m = aLines.length
  const n = bLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = aLines[i - 1] === bLines[j - 1]
        ? (dp[i - 1]![j - 1] ?? 0) + 1
        : Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0)
    }
  }

  // Trace back
  const result: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      result.unshift({ type: 'same', text: aLines[i - 1]! })
      i--
      j--
    } else if (j > 0 && (i === 0 || (dp[i]![j - 1] ?? 0) >= (dp[i - 1]![j] ?? 0))) {
      result.unshift({ type: 'added', text: bLines[j - 1]! })
      j--
    } else {
      result.unshift({ type: 'removed', text: aLines[i - 1]! })
      i--
    }
  }

  return result
}

export function DiffTab({ versions }: Props) {
  const sorted = [...versions].sort((a, b) => a.version - b.version)
  const [vA, setVA] = useState<string | null>(null)
  const [vB, setVB] = useState<string | null>(null)

  const selectedA = vA != null ? sorted.find((v) => String(v.version) === vA) : null
  const selectedB = vB != null ? sorted.find((v) => String(v.version) === vB) : null

  const diff = useMemo(() => {
    if (!selectedA || !selectedB) return null
    return lineDiff(selectedA.content, selectedB.content)
  }, [selectedA, selectedB])

  const addedCount = diff?.filter((l) => l.type === 'added').length ?? 0
  const removedCount = diff?.filter((l) => l.type === 'removed').length ?? 0

  if (sorted.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-muted">
        <p className="text-[13px]">At least 2 versions needed for a diff.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-[22px] py-[12px] border-b border-border shrink-0 bg-bg-muted">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-faint">From</span>
          <select
            value={vA ?? ''}
            onChange={(e) => setVA(e.target.value || null)}
            className="h-7 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
          >
            <option value="">Select version…</option>
            {sorted.map((v) => (
              <option key={v.id} value={String(v.version)}>
                v{v.version} — {new Date(v.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
        <span className="font-mono text-[11px] text-text-faint">→</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-faint">To</span>
          <select
            value={vB ?? ''}
            onChange={(e) => setVB(e.target.value || null)}
            className="h-7 px-2 rounded-[4px] border border-border bg-bg font-mono text-[12px] text-text focus:outline-none focus:border-border-strong"
          >
            <option value="">Select version…</option>
            {sorted.map((v) => (
              <option key={v.id} value={String(v.version)}>
                v{v.version} — {new Date(v.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        {diff && (
          <div className="flex items-center gap-3 ml-4">
            <span className="font-mono text-[11px] text-good">+{addedCount}</span>
            <span className="font-mono text-[11px] text-bad">−{removedCount}</span>
          </div>
        )}
      </div>

      {/* Diff output */}
      <div className="flex-1 overflow-auto">
        {!diff ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted">
            <p className="text-[13px]">Select two versions to compare.</p>
          </div>
        ) : (
          <div className="font-mono text-[12px] leading-relaxed">
            {diff.map((line, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex gap-4 px-[22px] py-[2px]',
                  line.type === 'added'   && 'bg-good/8 border-l-2 border-good',
                  line.type === 'removed' && 'bg-bad/8 border-l-2 border-bad',
                  line.type === 'same'    && 'text-text-faint',
                )}
              >
                <span className={cn(
                  'select-none w-4 text-right shrink-0',
                  line.type === 'added'   && 'text-good',
                  line.type === 'removed' && 'text-bad',
                  line.type === 'same'    && 'text-transparent',
                )}>
                  {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                </span>
                <span className={cn(
                  'whitespace-pre-wrap break-all',
                  line.type === 'added'   && 'text-good',
                  line.type === 'removed' && 'text-bad',
                )}>
                  {line.text || ' '}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
