'use client'

/**
 * Granular error boundary for client subtrees.
 *
 * Why: Next.js's app/error.tsx only catches errors that escape a route's
 * default error boundary. A single chart that throws on bad data
 * (NaN, undefined row, recharts SSR drift) takes down the whole route,
 * even when the surrounding dashboard would have rendered fine.
 *
 * Wrap any risky panel (chart, table, recharts subtree, third-party widget)
 * with <ErrorBoundary> so the rest of the page survives.
 *
 * Usage:
 *   <ErrorBoundary
 *     label="cost-breakdown-chart"   // identifies the source in the sink
 *     fallback={<ChartErrorFallback />}
 *   >
 *     <CostBreakdownChart />
 *   </ErrorBoundary>
 *
 * Default fallback is a small "Couldn't load this section" box that fits
 * any panel. Pass `fallback` for a more tailored skeleton.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Stable identifier used in the error sink — pick something searchable. */
  label: string
  /** Custom fallback. If omitted, renders the small default panel below. */
  fallback?: ReactNode | ((opts: { error: Error; reset: () => void }) => ReactNode)
  /** Optional hook for the host page (e.g. to fire analytics). */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Always log to console so devs see it locally.
    console.error(`[error-boundary:${this.props.label}]`, error, info)

    // Pipe to the server-side sink. Fire-and-forget — if the sink itself
    // is broken we don't want to mask the real error with a network error.
    try {
      fetch('/api/v1/frontend-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          scope: 'boundary',
          label: this.props.label,
          message: error.message,
          stack: error.stack?.slice(0, 4000),
          componentStack: info.componentStack?.slice(0, 4000),
          url: typeof window !== 'undefined' ? window.location.href : null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => { /* silent */ })
    } catch { /* silent */ }

    this.props.onError?.(error, info)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (typeof this.props.fallback === 'function') {
      return this.props.fallback({ error, reset: this.reset })
    }
    if (this.props.fallback !== undefined) return this.props.fallback

    return (
      <div
        role="alert"
        className="rounded-md border border-border bg-bg-elev p-4 my-2 text-[12px]"
      >
        <p className="font-medium text-text mb-1">
          Couldn&apos;t load this section
        </p>
        <p className="text-text-muted mb-3 font-mono text-[11px] break-all">
          {error.message || 'Unexpected client-side error'}
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
        >
          Retry
        </button>
      </div>
    )
  }
}
