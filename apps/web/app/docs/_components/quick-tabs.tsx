'use client'
import { useState } from 'react'
import { CodeBlock } from './code-block'

type TabKey = 'ts' | 'py' | 'curl'

interface QuickTab {
  key: TabKey
  label: string
  language: string
  code: string
}

interface QuickTabsProps {
  tabs: QuickTab[]
}

export function QuickTabs({ tabs }: QuickTabsProps) {
  const [active, setActive] = useState<TabKey>(tabs[0]?.key ?? 'ts')
  const current = tabs.find((t) => t.key === active) ?? tabs[0]
  if (!current) return null

  return (
    <div className="my-6 not-prose">
      <div className="flex border-b border-border/60">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={
              'px-4 py-2 text-sm font-medium transition-colors ' +
              (t.key === active
                ? 'border-b-2 border-accent text-accent -mb-px'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="-mt-1 [&>div]:!my-0">
        <CodeBlock language={current.language}>{current.code}</CodeBlock>
      </div>
    </div>
  )
}
