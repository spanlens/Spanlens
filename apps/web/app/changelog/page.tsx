import Link from 'next/link'
import { Rss } from 'lucide-react'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { Footer } from '@/components/layout/footer'
import { CHANGELOG_ENTRIES, type ChangelogEntry, type ChangelogTag } from '@/lib/changelog/entries'

export const metadata = {
  title: 'Changelog · Spanlens LLM Observability',
  description:
    'What is new in Spanlens. New features, improvements, infrastructure, and reliability work, in chronological order.',
  alternates: { canonical: '/changelog' },
}

const TAG_LABEL: Record<ChangelogTag, string> = {
  feature: 'Feature',
  improvement: 'Improvement',
  fix: 'Fix',
  docs: 'Docs',
  infrastructure: 'Infrastructure',
  reliability: 'Reliability',
}

const TAG_STYLE: Record<ChangelogTag, string> = {
  feature: 'bg-accent-bg text-accent border-accent/30',
  improvement: 'bg-bg-elev text-text border-border',
  fix: 'bg-bg-elev text-text border-border',
  docs: 'bg-bg-elev text-text-muted border-border',
  infrastructure: 'bg-bg-elev text-text-muted border-border',
  reliability: 'bg-bg-elev text-text-muted border-border',
}

const SITE_URL = 'https://www.spanlens.io'

/**
 * ItemList of BlogPosting nodes projected from CHANGELOG_ENTRIES so search
 * and LLM crawlers get machine-readable dates for every release note (the
 * page previously carried no date signals in structured data at all).
 * Dates are YYYY-MM-DD in entries.ts; the feed renders them as 00:00 UTC,
 * so the same instant is used here for consistency.
 */
function buildChangelogJsonLd(entries: ChangelogEntry[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${SITE_URL}/changelog#list`,
    name: 'Spanlens Changelog',
    url: `${SITE_URL}/changelog`,
    itemListElement: entries.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'BlogPosting',
        '@id': `${SITE_URL}/changelog#${entry.slug}`,
        headline: entry.title,
        datePublished: `${entry.date}T00:00:00Z`,
        url: `${SITE_URL}/changelog#${entry.slug}`,
        author: { '@id': `${SITE_URL}/#organization` },
      },
    })),
  }
}

export default function ChangelogPage() {
  // Defensive sort, newest first, in case entries.ts gets reordered manually.
  const entries = [...CHANGELOG_ENTRIES].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildChangelogJsonLd(entries)) }}
      />
      <MarketingNav subtitle="Changelog" />

      <main className="max-w-3xl mx-auto px-6 py-12">
        <header className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-3">Changelog</h1>
          <p className="text-lg text-muted-foreground mb-4">
            What is new in Spanlens. Updated when something ships, not on a calendar.
          </p>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/changelog/feed.xml"
              className="inline-flex items-center gap-1.5 text-accent hover:opacity-80"
            >
              <Rss className="h-4 w-4" />
              RSS feed
            </Link>
          </div>
        </header>

        <ol className="space-y-12">
          {entries.map((entry) => (
            <ChangelogItem key={entry.slug} entry={entry} />
          ))}
        </ol>
      </main>

      <Footer />
    </div>
  )
}

interface ChangelogItemProps {
  entry: ChangelogEntry
}

function ChangelogItem({ entry }: ChangelogItemProps) {
  return (
    <li id={entry.slug} className="scroll-mt-20 border-l-2 border-border pl-6 relative">
      <span
        aria-hidden
        className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-accent"
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <time
          dateTime={entry.date}
          className="font-mono text-xs text-text-faint tracking-wide"
        >
          {formatDate(entry.date)}
        </time>
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase ${TAG_STYLE[tag]}`}
            >
              {TAG_LABEL[tag]}
            </span>
          ))}
        </div>
        <a
          href={`#${entry.slug}`}
          className="ml-auto font-mono text-[10px] text-text-faint hover:text-accent opacity-0 group-hover:opacity-100"
          aria-label={`Permalink to ${entry.title}`}
        >
          #
        </a>
      </div>
      <h2 className="text-xl font-semibold tracking-tight mb-3">
        <a href={`#${entry.slug}`} className="hover:text-accent">
          {entry.title}
        </a>
      </h2>
      <ChangelogBody body={entry.body} />
    </li>
  )
}

interface ChangelogBodyProps {
  body: string
}

/**
 * Parse a tiny subset of markdown: paragraphs (separated by blank lines) and
 * inline `[label](href)` links. Anything else renders as plain text. We avoid
 * a full markdown library to keep this page server-rendered and dependency-free.
 */
function ChangelogBody({ body }: ChangelogBodyProps) {
  const paragraphs = body.split(/\n{2,}/)
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-text-muted">
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInline(p)}</p>
      ))}
    </div>
  )
}

/**
 * Replace `[label](href)` with anchor elements. Splits the input on the link
 * pattern and walks each segment so partial matches render as plain text.
 */
function renderInline(text: string): React.ReactNode[] {
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const label = match[1]
    const href = match[2]
    if (label === undefined || href === undefined) {
      // Defensive: every match has both capture groups by construction,
      // but TS noUncheckedIndexedAccess would not know that.
      lastIndex = match.index + match[0].length
      continue
    }
    const isExternal = /^https?:\/\//.test(href)
    nodes.push(
      isExternal ? (
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:opacity-80 underline underline-offset-2"
        >
          {label}
        </a>
      ) : (
        <Link
          key={key++}
          href={href}
          className="text-accent hover:opacity-80 underline underline-offset-2"
        >
          {label}
        </Link>
      ),
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

/** Render YYYY-MM-DD as "Jun 1, 2026" with explicit en-US locale (per CLAUDE.md gotcha #22). */
function formatDate(iso: string): string {
  // Build the date at noon UTC to avoid any client-side off-by-one when
  // a reader is east of UTC and views the page near local midnight.
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
