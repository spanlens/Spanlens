import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { DocsSection } from '@/app/docs/_lib/sections'

/**
 * Hub page for a /docs/<section> path. Lists every child page with its own
 * description so the page carries real content rather than a bare link list,
 * and so each child gains a second internal link besides the sidebar.
 */
export function DocsSectionIndex({ section }: { section: DocsSection }) {
  return (
    <div className="not-prose">
      <h1 className="text-4xl font-bold tracking-tight mb-3">{section.title}</h1>
      <p className="text-lg text-muted-foreground mb-10">{section.description}</p>

      {section.groups.map((group, i) => (
        <section key={group.title || i} className="mb-10">
          {group.title ? (
            <h2 className="text-xl font-semibold mb-4">{group.title}</h2>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.pages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="group rounded-xl border border-border bg-bg-elev p-5 hover:border-border-strong hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold group-hover:text-accent">{page.title}</h3>
                  <ArrowRight className="h-4 w-4 text-border group-hover:text-accent group-hover:translate-x-0.5 transition-all ml-auto shrink-0" />
                </div>
                <p className="text-sm text-muted-foreground">{page.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <p className="text-sm text-muted-foreground">
        Back to the{' '}
        <Link href="/docs" className="text-accent hover:underline">
          docs overview
        </Link>
        .
      </p>
    </div>
  )
}
