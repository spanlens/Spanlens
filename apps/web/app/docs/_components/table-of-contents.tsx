'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Heading {
  id: string
  text: string
  level: number
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

// Empty snapshot reused across renders so React's identity check in
// useSyncExternalStore stays stable on the server. Returning a fresh
// `[]` each call would force the hook to schedule a re-render every
// pass, which React warns about during SSR.
const EMPTY_HEADINGS: Heading[] = []

/**
 * Scan the article DOM for h2/h3 headings, slug-ifying any that lack an id.
 *
 * Memoised at the module level so React's identity comparison in
 * useSyncExternalStore reuses the prior snapshot until the article actually
 * mutates. Without a stable identity, React would call the snapshot on
 * every render and re-run the IntersectionObserver effect downstream.
 */
let cachedSnapshot: { article: Element | null; headings: Heading[] } = {
  article: null,
  headings: EMPTY_HEADINGS,
}
function getClientHeadings(): Heading[] {
  const article = typeof document === 'undefined' ? null : document.querySelector('article')
  if (!article) {
    cachedSnapshot = { article: null, headings: EMPTY_HEADINGS }
    return EMPTY_HEADINGS
  }
  if (cachedSnapshot.article === article) {
    return cachedSnapshot.headings
  }
  const els = Array.from(article.querySelectorAll('h2, h3')) as HTMLElement[]
  const headings = els.map((el) => {
    if (!el.id) el.id = slugify(el.textContent ?? '')
    return {
      id: el.id,
      text: el.textContent ?? '',
      level: parseInt(el.tagName[1] ?? '2'),
    }
  })
  cachedSnapshot = { article, headings }
  return headings
}

// No-op subscriber — heading list does not change after mount (a new
// pathname remounts the parent via key={pathname}). React requires a
// function reference here, so we hand it a stable no-op rather than
// allocating a fresh one each render.
function noopSubscribe() {
  return () => {}
}

export function TableOfContents() {
  // Remount the inner component when pathname changes so the heading
  // snapshot cache is invalidated and the IntersectionObserver rebinds
  // against the new article's headings.
  const pathname = usePathname()
  return <TableOfContentsInner key={pathname} />
}

function TableOfContentsInner() {
  // useSyncExternalStore is the React-blessed escape hatch for values
  // that legitimately differ between SSR and client. The server snapshot
  // returns [] (no DOM) and the client snapshot walks the article. React
  // hydrates against the server value, then on commit switches to the
  // client value in a single, mismatch-free pass — distinct from a
  // useState/useEffect dance, which would either fire a render-phase
  // side effect or trigger the set-state-in-effect lint rule.
  const headings = useSyncExternalStore(noopSubscribe, getClientHeadings, () => EMPTY_HEADINGS)
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (headings.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '0px 0px -80% 0px' },
    )
    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav>
      <p className="font-semibold text-[11px] uppercase tracking-[0.06em] text-text-faint mb-3">
        On this page
      </p>
      <ul className="space-y-1">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault()
                const el = document.getElementById(h.id)
                if (el) {
                  const top = el.getBoundingClientRect().top + window.scrollY - 80
                  window.scrollTo({ top, behavior: 'smooth' })
                }
              }}
              className={cn(
                'block text-[12.5px] leading-snug py-[3px] transition-colors',
                h.level === 3 ? 'pl-3' : '',
                activeId === h.id
                  ? 'text-accent font-medium'
                  : 'text-text-faint hover:text-text-muted',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
