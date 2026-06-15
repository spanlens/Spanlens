'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'

/**
 * PT-3: marketing-page CTA that warms the dashboard route on hover/focus.
 *
 * Next.js Link in the App Router prefetches the destination on viewport entry,
 * which warms the loading.tsx + RSC tree but doesn't always force the full
 * async data load (depends on the `prefetch` setting + production vs. dev).
 * We add an onMouseEnter / onFocus → router.prefetch('/dashboard') so the
 * cold-start sidebarSpecs prefetchAll batch fires the moment the user shows
 * intent to click. Combined with PT-1's non-blocking layout, this makes the
 * transition feel instant.
 *
 * Idempotent: we only fire the prefetch once per mount; router.prefetch is
 * also internally deduped by Next.js, but skipping the second call avoids
 * a no-op render cycle.
 */
export function DashboardCTALink({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter()
  const firedRef = useRef(false)

  const warm = useCallback(() => {
    if (firedRef.current) return
    firedRef.current = true
    router.prefetch('/dashboard')
  }, [router])

  return (
    <Link
      href="/dashboard"
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      {...(className ? { className } : {})}
    >
      {children}
    </Link>
  )
}
