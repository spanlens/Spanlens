'use client'

import { useSyncExternalStore, type ReactNode } from 'react'

/**
 * Mount-only render guard for the demo subsystem.
 *
 * Why this exists: PR #255/#256/#257 fixed the obvious hydration
 * mismatches in /demo/dashboard and the wider demo pages
 * (useState(() => Date.now()), Math.random module init, locale-less
 * toLocale* calls). React #418 still surfaced on
 * /demo/dashboard + /demo/traces because of a shared chunk we couldn't
 * fully audit in a reasonable amount of time — the minified production
 * stack trace identifies the React internals (rX → rY → …) but not
 * the calling component.
 *
 * Rather than chase the last source, we wrap every demo page in this
 * guard. SSR + first client paint render `null`. After mount the
 * client snapshot returns `true` and the real children render. The
 * tree is therefore hydrated from `<>` on both passes — there is no
 * HTML to diff, so no possible mismatch.
 *
 * Trade-offs
 *   - First-paint shows nothing under <DemoLayout> for ~1 frame
 *     (16-50ms). The full-page layout chrome (sidebar, banner) renders
 *     immediately because <DemoLayout> stays a server component; only
 *     `children` waits for mount. Users do not perceive the gap on
 *     real devices.
 *   - SEO impact: zero. /demo/* is `noindex` and not part of the
 *     marketing funnel.
 *   - The guard is cheap (one useSyncExternalStore call per page) and
 *     does not opt into Next.js's static rendering, so we keep all
 *     other Next features (Link prefetch, code splitting, error
 *     boundaries) intact.
 *
 * This is intentionally scoped to /demo/* via the layout file. Live
 * dashboard pages must NOT use this — they need SSR for first-paint
 * speed and SEO of authenticated landing pages.
 *
 * CLAUDE.md gotcha #22 family.
 */

const subscribe = (): (() => void) => () => {}
const getClientSnapshot = (): boolean => true
const getServerSnapshot = (): boolean => false

export function DemoClientGuard({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
  if (!mounted) return null
  return <>{children}</>
}
