'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

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
      { label: 'Savings',         href: '/recommendations' },
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

// ── Palette UI ────────────────────────────────────────────────────────────────

function CommandPaletteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()

  function handleSelect(href: string) {
    router.push(href)
    onClose()
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette panel */}
      <div className="fixed top-[15vh] left-1/2 z-50 w-full max-w-[560px] -translate-x-1/2 px-4">
        <Command className="border border-border shadow-2xl">
          <CommandInput placeholder="Go to…" autoFocus />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {NAV_GROUPS.map((group, gi) => (
              <React.Fragment key={group.heading}>
                {gi > 0 && <CommandSeparator />}
                <CommandGroup heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.href}
                      value={item.label}
                      onSelect={() => handleSelect(item.href)}
                    >
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </React.Fragment>
            ))}
          </CommandList>
        </Command>
      </div>
    </>
  )
}

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
      <CommandPaletteDialog open={open} onClose={() => setOpen(false)} />
    </CommandPaletteContext.Provider>
  )
}
