import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Locale is pinned to en-US to keep server SSR and client renders identical.
// `toLocaleDateString()` without an explicit locale follows the runtime default
// — Node defaults to en-US, but a Korean browser defaults to ko-KR, which
// produces a different string ("5/18/2026" vs "2026. 5. 18.") and trips
// React #418 hydration mismatch. The dashboard UI is English, so en-US is
// consistent with the surrounding copy ("Renews on May 18, 2026").
export function formatDate(iso: string | null): string {
  if (!iso) return ','
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Date + time, en-US pinned. Use anywhere the ungated `.toLocaleString()` would
 * sit in SSR-rendered output and trip React #418.
 * Example: "May 18, 2026, 11:24 PM"
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return ','
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * 24h time only ("HH:mm"), en-US pinned. For activity logs / per-row timestamps
 * where date is implied by context. Same #418 protection as formatDateTime.
 */
export function formatTime(iso: string | null): string {
  if (!iso) return ','
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
