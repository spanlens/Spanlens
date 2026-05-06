'use client'
import { useEffect, useState } from 'react'
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

export function TableOfContents() {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    const article = document.querySelector('article')
    if (!article) return

    const els = Array.from(article.querySelectorAll('h2, h3')) as HTMLElement[]

    const items: Heading[] = els.map((el) => {
      if (!el.id) {
        el.id = slugify(el.textContent ?? '')
      }
      return { id: el.id, text: el.textContent ?? '', level: parseInt(el.tagName[1] ?? '2') }
    })

    setHeadings(items)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '0px 0px -80% 0px' },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

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
