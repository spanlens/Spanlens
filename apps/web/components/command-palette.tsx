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

const NAV_ITEMS: NavEntry[] = [
  { label: 'Dashboard',      href: '/dashboard' },
  { label: 'Requests',       href: '/requests' },
  { label: 'Traces',         href: '/traces' },
  { label: 'Anomalies',      href: '/anomalies' },
  { label: 'Security',       href: '/security' },
  { label: 'Savings',        href: '/recommendations' },
  { label: 'Prompts',        href: '/prompts' },
  { label: 'Alerts',         href: '/alerts' },
  { label: 'Projects & Keys', href: '/projects' },
  { label: 'Settings',       href: '/settings' },
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
            <CommandGroup heading="Navigation">
              {NAV_ITEMS.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => handleSelect(item.href)}
                >
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
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
