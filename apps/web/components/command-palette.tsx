'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// cmdk + Command UI weighs ~30-50KB and shows up in the initial dashboard
// chunk. Defer it: the dialog only renders when `open === true`, so wrapping
// it in next/dynamic keeps the cmdk chunk out of the critical path. First
// ⌘K press pays a one-time ~50ms fetch, every subsequent open is instant.
const CommandPaletteDialog = dynamic(
  () => import('./command-palette-dialog').then((m) => m.CommandPaletteDialog),
  { ssr: false, loading: () => null },
)

// ── Context ───────────────────────────────────────────────────────────────────

interface CommandPaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) throw new Error('useCommandPalette must be used inside CommandPaletteProvider')
  return ctx
}

// ── Nav items ─────────────────────────────────────────────────────────────────

interface NavEntry {
  label: string
  href: string
}

interface NavGroup {
  heading: string
  items: NavEntry[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Navigation',
    items: [
      { label: 'Dashboard',       href: '/dashboard' },
      { label: 'Requests',        href: '/requests' },
      { label: 'Traces',          href: '/traces' },
      { label: 'Anomalies',       href: '/anomalies' },
      { label: 'Security',        href: '/security' },
      { label: 'Savings',         href: '/savings' },
      { label: 'Prompts',         href: '/prompts' },
      { label: 'Alerts',          href: '/alerts' },
      { label: 'Projects & Keys', href: '/projects' },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { label: 'Settings – General',       href: '/settings?tab=general' },
      { label: 'Settings – Members',       href: '/settings?tab=members' },
      { label: 'Settings – Provider keys', href: '/settings?tab=api-keys' },
      { label: 'Settings – Audit log',     href: '/settings?tab=audit-log' },
      { label: 'Settings – Billing',       href: '/settings?tab=billing' },
      { label: 'Settings – Plan & limits', href: '/settings?tab=plan' },
      { label: 'Settings – Invoices',      href: '/settings?tab=invoices' },
      { label: 'Settings – Profile',       href: '/settings?tab=profile' },
      { label: 'Settings – Notifications', href: '/settings?tab=notifications' },
      { label: 'Settings – Preferences',   href: '/settings?tab=preferences' },
      { label: 'Settings – Integrations',  href: '/settings?tab=integrations' },
      // DESTINATIONS_HIDDEN: uncomment when BigQuery/S3/Snowflake connectors are implemented
      // { label: 'Settings – Destinations',  href: '/settings?tab=destinations' },
      { label: 'Settings – Webhooks',      href: '/settings?tab=webhooks' },
      { label: 'Settings – OpenTelemetry', href: '/settings?tab=opentelemetry' },
    ],
  },
]

// ── Provider ──────────────────────────────────────────────────────────────────

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen((v) => !v), [])

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggle()
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, toggle }}>
      {children}
      {open && <CommandPaletteDialog navGroups={NAV_GROUPS} onClose={() => setOpen(false)} />}
    </CommandPaletteContext.Provider>
  )
}
