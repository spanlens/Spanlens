'use client'

/**
 * Minimal theme provider — replaces `next-themes`.
 *
 * Why not next-themes: it injects its FOUC-prevention script via
 * `React.createElement("script", …)` from a *client* component, which React 19
 * (Next 16 / Turbopack) flags with "Encountered a script tag while rendering
 * React component". The library has been unmaintained since early 2025, so the
 * warning won't be fixed upstream. See pacocoursey/next-themes#387.
 *
 * This implementation keeps the same `useTheme()` surface (`theme`,
 * `setTheme`, `resolvedTheme`, `systemTheme`) but moves the pre-paint theme
 * application into a raw `<script>` in the server-rendered `<head>` (see
 * app/layout.tsx ThemeScript) — server-emitted script tags are real HTML and
 * don't trigger the React warning.
 *
 * Theme is stored in localStorage under `theme` and applied by toggling the
 * `.dark` class on <html> (matches app/globals.css's `.dark` / `:root` tokens).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type Theme = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** Keep in sync with the inline script in app/layout.tsx (ThemeScript). */
export const THEME_STORAGE_KEY = 'theme'

interface ThemeContextValue {
  /** The user's selection, including 'system'. */
  theme: Theme
  setTheme: (theme: Theme) => void
  /** 'system' resolved against the OS preference — always 'light' | 'dark'. */
  resolvedTheme: ResolvedTheme
  /** The current OS preference. */
  systemTheme: ResolvedTheme
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage can throw in private mode / sandboxed iframes — ignore.
  }
  return 'system'
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR + first client paint both start at 'system' so the rendered output
  // matches (no hydration mismatch on theme-dependent text). The inline head
  // script has already applied the correct class to <html> before paint, so
  // there's no visual flash even though React state lags by one effect tick.
  // Single state object so the post-mount sync is one setState call (the
  // react-hooks/set-state-in-effect rule flags each synchronous setState in an
  // effect; collapsing to one keeps the hydration-safe sync to a single,
  // clearly-annotated exception).
  const [state, setState] = useState<{ theme: Theme; systemTheme: ResolvedTheme }>({
    theme: 'system',
    systemTheme: 'light',
  })
  const { theme, systemTheme } = state

  // Sync React state to the actual browser values after mount. The first
  // render must match the server ('system') to avoid a hydration mismatch, so
  // the real value can only land post-hydration. The inline <head> script has
  // already applied the correct class to <html>, so there's no visual flash.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration sync to localStorage/OS, no derived-state path
    setState({ theme: readStoredTheme(), systemTheme: getSystemTheme() })
  }, [])

  // Track OS preference changes so 'system' stays live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? 'dark' : 'light'
      setState((prev) => {
        if (prev.theme === 'system') applyResolvedTheme(next)
        return { ...prev, systemTheme: next }
      })
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setState((prev) => ({ ...prev, theme: next }))
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // ignore — see readStoredTheme
    }
    applyResolvedTheme(next === 'system' ? getSystemTheme() : next)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, systemTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Defensive default so a stray consumer outside the provider never crashes.
    return { theme: 'system', setTheme: () => {}, resolvedTheme: 'light', systemTheme: 'light' }
  }
  return ctx
}
