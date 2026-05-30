'use client'

/**
 * Shared helpers for the `sidebar-collapsed` cookie.
 *
 * The desktop sidebar collapse preference is stored in a cookie (not just
 * localStorage) so the server can read it during SSR and render the dashboard
 * in the correct collapsed/expanded state on the first paint. Without that,
 * SSR always assumes "expanded" and a collapsed user sees the sidebar flash in
 * before the client hydrates and hides it.
 */

export const SIDEBAR_COLLAPSED_COOKIE = 'sidebar-collapsed'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function writeSidebarCollapsedCookie(collapsed: boolean): void {
  if (typeof document === 'undefined') return
  // Site-scoped, not Secure — works on http://localhost; the browser still
  // restricts it to the current hostname in production.
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? '1' : '0'}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}
