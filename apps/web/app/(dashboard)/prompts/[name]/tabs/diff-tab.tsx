'use client'
import { useState } from 'react'
import { type PromptVersion } from '@/lib/queries/use-prompts'
import { cn, formatDate } from '@/lib/utils'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { FilterBar, TableCard, TableHead, Th } from '../../../_board/surfaces'

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

  // React Compiler auto-memoizes — manual useMemo here can't preserve the
  // dependency list because `find()` returns a fresh reference each render.
  const diff = !selectedA || !selectedB
    ? null
    : lineDiff(selectedA.content, selectedB.content)

  const addedCount = diff?.filter((l) => l.type === 'added').length ?? 0
  const removedCount = diff?.filter((l) => l.type === 'removed').length ?? 0

  if (sorted.length < 2) {
    return (
      <div className="card-surface rounded-card flex h-56 flex-col items-center justify-center gap-2 text-text-muted">
        <p className="text-[12.5px]">Two versions are needed before a diff can be drawn.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Version pickers sit on the filter row rather than inside the card, so
          the diff card holds nothing but the diff itself. */}
      <FilterBar>
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-text-faint">From</span>
          <div className="min-w-0 flex-1">
            <Select {...(vA ? { value: vA } : {})} onValueChange={(v) => setVA(v || null)}>
              <SelectTrigger className="h-[34px] rounded-md" aria-label="Diff from version">
                <SelectValue placeholder="Select version…" />
              </SelectTrigger>
              <SelectContent>
                {sorted.map((v) => (
                  <SelectItem key={v.id} value={String(v.version)}>
                    v{v.version}, {formatDate(v.created_at)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-text-faint">→</span>
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-text-faint">To</span>
          <div className="min-w-0 flex-1">
            <Select {...(vB ? { value: vB } : {})} onValueChange={(v) => setVB(v || null)}>
              <SelectTrigger className="h-[34px] rounded-md" aria-label="Diff to version">
                <SelectValue placeholder="Select version…" />
              </SelectTrigger>
              <SelectContent>
                {sorted.map((v) => (
                  <SelectItem key={v.id} value={String(v.version)}>
                    v{v.version}, {formatDate(v.created_at)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {diff && (
          <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
            <span className="text-good">+{addedCount}</span>
            <span className="text-bad">−{removedCount}</span>
          </div>
        )}
      </FilterBar>

      {!diff ? (
        <div className="card-surface rounded-card flex h-56 flex-col items-center justify-center gap-2 text-text-muted">
          <p className="text-[12.5px]">Select two versions to compare.</p>
        </div>
      ) : (
        <TableCard>
          <TableHead>
            <Th>
              v{selectedA?.version} → v{selectedB?.version}
            </Th>
          </TableHead>
          <div className="overflow-x-auto py-1.5 font-mono text-[12px] leading-[1.65]">
            {diff.map((line, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex gap-4 border-l-2 px-[18px] py-[1px]',
                  line.type === 'added'   && 'border-good bg-good-bg',
                  line.type === 'removed' && 'border-bad bg-bad-bg',
                  line.type === 'same'    && 'border-transparent text-text-faint',
                )}
              >
                <span className={cn(
                  'w-4 shrink-0 select-none text-right',
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
        </TableCard>
      )}
    </div>
  )
}
