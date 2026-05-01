'use client'

interface MiniSparklineProps {
  /** Values 0–100 (quality score). null means no data for that bucket. */
  data: (number | null)[]
  width?: number
  height?: number
  /** Color when all values are healthy (≥70). Default: current text color via stroke. */
  color?: string
}

/**
 * A tiny inline SVG sparkline for quality scores (0–100).
 * Gaps are rendered as breaks in the line (no interpolation over nulls).
 */
export function MiniSparkline({ data, width = 60, height = 20, color }: MiniSparklineProps) {
  if (!data || data.length === 0) return null

  const filled = data.filter((v) => v !== null) as number[]
  if (filled.length === 0) {
    return (
      <svg width={width} height={height} className="opacity-20">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth={1} strokeDasharray="2,2" />
      </svg>
    )
  }

  const minVal = 0
  const maxVal = 100
  const range = maxVal - minVal

  // Build connected path segments, breaking on nulls
  const segments: string[] = []
  let currentPath: string[] = []

  const xStep = width / (data.length - 1 || 1)
  const yFor = (v: number) => height - ((v - minVal) / range) * height

  data.forEach((v, i) => {
    const x = i * xStep
    if (v === null) {
      if (currentPath.length > 0) {
        segments.push(currentPath.join(' '))
        currentPath = []
      }
      return
    }
    const y = yFor(v)
    currentPath.push(currentPath.length === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)
  })
  if (currentPath.length > 0) segments.push(currentPath.join(' '))

  // Determine color based on avg quality
  const avg = filled.reduce((a, b) => a + b, 0) / filled.length
  const strokeColor = color ?? (avg >= 90 ? '#22c55e' : avg >= 70 ? '#f59e0b' : '#ef4444')

  return (
    <svg width={width} height={height} className="shrink-0">
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
