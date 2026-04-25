'use client'

/**
 * Shared helpers for the `sb-ws` workspace cookie.
 * The server's authJwt middleware + Next.js middleware both read this
 * cookie to resolve the active workspace, so client-side writes MUST use
 * this module (no rogue `document.cookie =` scattered elsewhere).
 */

export const WORKSPACE_COOKIE = 'sb-ws'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function readWorkspaceCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${WORKSPACE_COOKIE}=([^;]+)`))
  return match ? decodeURIComponent(match[1]!) : null
}

export function writeWorkspaceCookie(id: string): void {
  if (typeof document === 'undefined') return
  // Site-scoped, not Secure — we want it to work on http://localhost. In
  // production the browser still restricts it to the current hostname.
  document.cookie = `${WORKSPACE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}

export function clearWorkspaceCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${WORKSPACE_COOKIE}=; path=/; max-age=0; samesite=lax`
}
