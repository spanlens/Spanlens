'use client'
import { useEffect, useState } from 'react'

import { CodeBlock } from './code-block'

/**
 * Side-by-side TypeScript / Python code switcher for the SDK docs.
 *
 * The selected language persists in localStorage and broadcasts via a
 * window event so that *every* `<LangTabs>` on the page flips together —
 * pick once, see your language everywhere on this page (and the next visit).
 *
 * Usage:
 *   <LangTabs ts={`...`} py={`...`} />
 *
 * Either tab may be omitted (e.g. proxy-only feature with no SDK API). The
 * tab label still renders; clicking shows a "not yet available" notice.
 */

const STORAGE_KEY = 'spanlens:docs-lang'
const EVENT_NAME = 'spanlens:docs-lang-change'

type Lang = 'ts' | 'py'

function readStoredLang(): Lang {
  if (typeof window === 'undefined') return 'ts'
  const value = window.localStorage.getItem(STORAGE_KEY)
  return value === 'py' ? 'py' : 'ts'
}

interface LangTabsProps {
  ts?: string
  py?: string
}

export function LangTabs({ ts, py }: LangTabsProps) {
  // Default during SSR + first paint is `ts` to avoid layout shift for the
  // most common reader. The effect below upgrades to the persisted choice.
  const [lang, setLang] = useState<Lang>('ts')

  useEffect(() => {
    setLang(readStoredLang())

    function onChange(e: Event) {
      const detail = (e as CustomEvent<Lang>).detail
      if (detail === 'ts' || detail === 'py') setLang(detail)
    }
    window.addEventListener(EVENT_NAME, onChange)
    return () => window.removeEventListener(EVENT_NAME, onChange)
  }, [])

  function pick(next: Lang) {
    setLang(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent<Lang>(EVENT_NAME, { detail: next }))
  }

  const code = lang === 'ts' ? ts : py
  const language = lang === 'ts' ? 'ts' : 'python'

  return (
    <div className="my-6 not-prose">
      <div className="flex border-b border-border/60">
        <TabButton active={lang === 'ts'} onClick={() => pick('ts')}>
          TypeScript
        </TabButton>
        <TabButton active={lang === 'py'} onClick={() => pick('py')}>
          Python
        </TabButton>
      </div>

      {code ? (
        // CodeBlock applies its own my-6 — neutralise it via a wrapper so
        // the tab strip and the code stay visually attached.
        <div className="-mt-1 [&>div]:!my-0">
          <CodeBlock language={language}>{code}</CodeBlock>
        </div>
      ) : (
        <div className="rounded-b-lg border border-t-0 border-border/40 bg-[#1a1816] px-4 py-6 text-sm text-[#7c7770]">
          {lang === 'py'
            ? 'Python sample coming soon. The TypeScript sample on the other tab works the same way.'
            : 'TypeScript sample coming soon — see the Python tab.'}
        </div>
      )}
    </div>
  )
}

interface TabButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-4 py-2 text-sm font-medium transition-colors ' +
        (active
          ? 'border-b-2 border-accent text-accent -mb-px'
          : 'text-muted-foreground hover:text-foreground')
      }
    >
      {children}
    </button>
  )
}
