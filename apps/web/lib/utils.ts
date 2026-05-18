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
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
