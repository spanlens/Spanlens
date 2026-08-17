import { openGraphFor } from '@/lib/page-metadata'
import Link from 'next/link'
import { Rss } from 'lucide-react'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-jsonld'
import { Footer } from '@/components/layout/footer'
import { CHANGELOG_ENTRIES, type ChangelogEntry, type ChangelogTag } from '@/lib/changelog/entries'

export const metadata = {
  title: 'Changelog · Spanlens LLM Observability',
  description:
    'What is new in Spanlens. New features, improvements, infrastructure, and reliability work, in chronological order.',
  alternates: { canonical: '/changelog' },
  openGraph: openGraphFor('/changelog'),
}

const TAG_LABEL: Record<ChangelogTag, string> = {
  feature: 'Feature',
  improvement: 'Improvement',
  fix: 'Fix',
  docs: 'Docs',
  infrastructure: 'Infrastructure',
  reliability: 'Reliability',
}

// Only `feature` earns the accent tint. Reliability work reads as a status
// (green), and the remaining kinds stay on the neutral chip so a month of
// housekeeping entries does not look like a month of launches.
const TAG_STYLE: Record<ChangelogTag, string> = {
  feature: 'bg-accent-bg text-accent',
  improvement: 'bg-bg-chip text-text-muted',
  fix: 'bg-bg-chip text-text-muted',
  docs: 'bg-bg-chip text-text-muted',
  infrastructure: 'bg-bg-chip text-text-muted',
  reliability: 'bg-good-bg text-good',
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
      <BreadcrumbJsonLd trail={[{ name: 'Changelog', path: '/changelog' }]} />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-14 text-center">
          <h1 className="font-display track-h2 mb-4 text-[46px] leading-[1.12] text-text">
            Changelog
          </h1>
          <p className="mb-5 text-[16.5px] leading-[1.6] text-text-muted">
            What is new in Spanlens. Updated when something ships, not on a calendar.
          </p>
          <Link
            href="/changelog/feed.xml"
            className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-faint transition-colors hover:text-accent"
          >
            <Rss className="h-3.5 w-3.5" />
            RSS feed
          </Link>
        </header>

        <ol>
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
    // Entries are separated by a hairline rather than strung on a timeline
    // rail: the dates already order the list, and the rule keeps a long
    // changelog scannable without a decorative spine down the page.
    <li id={entry.slug} className="group scroll-mt-20 border-b border-border py-9 last:border-b-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <time dateTime={entry.date} className="font-mono text-[12px] text-text-faint">
          {formatDate(entry.date)}
        </time>
        {entry.tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${TAG_STYLE[tag]}`}
          >
            {TAG_LABEL[tag]}
          </span>
        ))}
        <a
          href={`#${entry.slug}`}
          className="ml-auto font-mono text-[11px] text-text-faint opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100"
          aria-label={`Permalink to ${entry.title}`}
        >
          #
        </a>
      </div>
      <h2 className="font-display track-quote mb-3 text-[20px] text-text">
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
    <div className="space-y-3 text-[14px] leading-[1.7] text-text-muted">
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
