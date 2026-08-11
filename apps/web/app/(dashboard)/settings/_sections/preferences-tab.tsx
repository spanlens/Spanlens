'use client'
import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import { useTheme } from '@/components/providers/theme-provider'
import { cn } from '@/lib/utils'
import { Section, FormRow } from '@/components/ui/primitives'
import { TabHeader } from '../_shared/ui'

// ─── PREFERENCES tab ──────────────────────────────────────────────────────────

type ThemeOption = 'system' | 'light' | 'dark'

interface ThemeOptionDef {
  value: ThemeOption
  label: string
  Icon: LucideIcon
}

const THEME_OPTIONS: ThemeOptionDef[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const current = (theme ?? 'system') as ThemeOption

  return (
    <div className="flex items-center gap-1 rounded-[6px] border border-border bg-bg-muted p-1">
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-[5px] rounded-[4px] text-[12.5px] transition-colors',
            current === value
              ? 'bg-bg text-text font-medium shadow-sm'
              : 'text-text-muted hover:text-text',
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </button>
      ))}
    </div>
  )
}

export function PreferencesTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="Preferences"
        description="Personal UI preferences stored in your browser."
      />

      <Section title="Theme" className="mb-5">
        <FormRow label="Color theme" hint="Override your system preference. Stored locally in your browser.">
          <ThemeToggle />
        </FormRow>
      </Section>
    </div>
  )
}
