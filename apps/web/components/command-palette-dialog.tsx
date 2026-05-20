'use client'

import React from 'react'
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

interface NavEntry {
  label: string
  href: string
}

interface NavGroup {
  heading: string
  items: NavEntry[]
}

/**
 * The cmdk-heavy UI lives in this separate file so the rest of
 * CommandPaletteProvider can stay in the initial dashboard chunk while the
 * cmdk + Command UI code only downloads after the first ⌘K press.
 *
 * Imported via next/dynamic from command-palette.tsx — see that file for the
 * dynamic() call. Render this component only when palette is open so the
 * chunk fetch is deferred until the user actually triggers it.
 */

interface Props {
  navGroups: NavGroup[]
  onClose: () => void
}

export function CommandPaletteDialog({ navGroups, onClose }: Props) {
  const router = useRouter()

  function handleSelect(href: string) {
    router.push(href)
    onClose()
  }

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
            {navGroups.map((group, gi) => (
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
