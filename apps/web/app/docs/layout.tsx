import { DocsSidebar } from './_components/sidebar'
import { TableOfContents } from './_components/table-of-contents'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { Footer } from '@/components/layout/footer'

export const metadata = {
  title: 'Docs · Spanlens',
  description:
    'Spanlens documentation: quick start, SDK reference, proxy API, OpenTelemetry, and self-hosting for drop-in LLM observability.',
  // NOTE: no `alternates.canonical` here — it would be inherited by every
  // docs page without its own `alternates`, canonicalising them all to
  // /docs and de-indexing them. Each docs page declares its own canonical.
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      {/* Nav */}
      <MarketingNav subtitle="Docs" />

      {/* Three-column shell from Figma M2: 272px nav rail on a band fill, the
          article, then a 240px "on this page" rail. The rail carries the band
          background full-height rather than floating, so the article reads as
          the lit surface. */}
      <div className="mx-auto flex max-w-[1440px]">
        <aside className="hidden w-[272px] shrink-0 border-r border-border bg-bg-muted md:block">
          <div className="sticky top-[73px] max-h-[calc(100vh-73px)] overflow-y-auto px-8 py-7">
            <DocsSidebar />
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-6 py-11 lg:px-14">
          {/* Prose-authored <pre> blocks (api/errors, self-host/backup,
              troubleshooting) use the `code-*` tokens, which have no dark
              override, so the slab matches CodeBlock in both themes. */}
          <article
            className="prose prose-stone max-w-[832px]
              prose-headings:scroll-mt-20 prose-headings:font-display
              prose-h1:text-[38px] prose-h1:track-h2 prose-h1:leading-[1.1] prose-h1:text-text
              prose-h2:text-[20px] prose-h2:track-quote prose-h2:text-text
              prose-h3:text-[16px] prose-h3:track-quote prose-h3:text-text
              prose-p:text-[14.5px] prose-p:leading-[1.75] prose-p:text-text-muted
              prose-li:text-[14.5px] prose-li:text-text-muted
              prose-strong:text-text
              prose-pre:rounded-lg prose-pre:bg-code-bg prose-pre:text-code-fg prose-pre:text-[12.5px] prose-pre:leading-6
              prose-a:text-accent prose-a:no-underline hover:prose-a:opacity-80
              prose-table:text-sm
              [&_table_th]:align-middle [&_table_td]:align-middle
              [&_table_th:first-child]:text-left [&_table_td:first-child]:text-left
              [&_table_td:first-child]:whitespace-nowrap
              [&_:not(pre)>code]:bg-bg-elev [&_:not(pre)>code]:text-text [&_:not(pre)>code]:font-normal [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:border [&_:not(pre)>code]:border-border
              [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none
              [&_pre_code]:bg-transparent [&_pre_code]:text-inherit [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-sm [&_pre_code]:font-normal [&_pre_code]:before:content-none [&_pre_code]:after:content-none"
          >
            {children}
          </article>
        </main>

        <aside className="hidden w-[240px] shrink-0 xl:block">
          <div className="sticky top-[73px] max-h-[calc(100vh-73px)] overflow-y-auto px-5 py-12">
            <TableOfContents />
          </div>
        </aside>
      </div>

      <Footer />
    </div>
  )
}
