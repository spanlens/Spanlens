import { CHANGELOG_ENTRIES, type ChangelogEntry } from '@/lib/changelog/entries'

/**
 * Atom feed for the changelog. Atom (not RSS 2.0) because feed readers
 * generally render Atom dates more correctly, and the schema is stricter
 * which makes it easier to validate by hand if something looks off.
 *
 * Cached at the edge: changes only when entries.ts changes, which only
 * happens on deploy.
 */
export const dynamic = 'force-static'

const SITE_URL = 'https://www.spanlens.io'
const FEED_URL = `${SITE_URL}/changelog/feed.xml`
const CHANGELOG_URL = `${SITE_URL}/changelog`

export function GET(): Response {
  const entries = [...CHANGELOG_ENTRIES].sort((a, b) => b.date.localeCompare(a.date))
  const latestUpdate = entries[0]?.date ?? '2026-06-01'

  const xml = renderAtom({
    title: 'Spanlens Changelog',
    subtitle: 'What is new in Spanlens. New features, improvements, infrastructure, and reliability work.',
    updated: toAtomDate(latestUpdate),
    entries: entries.map((entry) => ({
      ...entry,
      url: `${CHANGELOG_URL}#${entry.slug}`,
      updated: toAtomDate(entry.date),
    })),
  })

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  })
}

interface RenderInput {
  title: string
  subtitle: string
  updated: string
  entries: Array<ChangelogEntry & { url: string; updated: string }>
}

function renderAtom(input: RenderInput): string {
  const items = input.entries
    .map(
      (e) => `  <entry>
    <id>${esc(e.url)}</id>
    <title>${esc(e.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(e.url)}" />
    <updated>${e.updated}</updated>
    <published>${e.updated}</published>
${e.tags.map((t) => `    <category term="${esc(t)}" />`).join('\n')}
    <content type="text">${esc(e.body)}</content>
    <author><name>Spanlens</name></author>
  </entry>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(input.title)}</title>
  <subtitle>${esc(input.subtitle)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${FEED_URL}" />
  <link rel="alternate" type="text/html" href="${CHANGELOG_URL}" />
  <id>${FEED_URL}</id>
  <updated>${input.updated}</updated>
${items}
</feed>`
}

/** XML-escape minimal set: &, <, >, ", '. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** YYYY-MM-DD → RFC 3339 timestamp at noon UTC. */
function toAtomDate(iso: string): string {
  return `${iso}T12:00:00Z`
}
