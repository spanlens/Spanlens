import { describe, expect, test } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Source-level guard for keeping this API origin out of search indexes.
 *
 * The host answers `/` with a document, and until 2026-07-29 that document
 * was a one-line `<h1>Spanlens API Server</h1>` served straight from
 * `public/`. A 200 with nothing in it is what Google calls a Soft 404, and
 * Search Console filed api.spanlens.io as exactly that.
 *
 * Two things keep it fixed, and both are easy to undo by accident:
 *
 *  1. `X-Robots-Tag: noindex, nofollow` on every response. An explicit
 *     noindex beats a robots.txt disallow here: a disallow blocks the crawl,
 *     which leaves the URL indexable by reference and unable to see the
 *     directive. Setting it in vercel.json did not work — that `headers`
 *     block never reached responses from this function.
 *  2. No `public/index.html`. Vercel serves `public/` ahead of the catch-all
 *     rewrite, so re-adding that file would route `/` around this app and
 *     drop the header again, which is precisely how the Soft 404 happened.
 *
 * Behaviour can't be asserted cheaply here: importing app.ts pulls in the
 * Supabase and ClickHouse clients, so this pins the source instead — the same
 * pattern as api-v1-mount-order.test.ts.
 */

async function readAppSource(): Promise<string> {
  return readFile(fileURLToPath(new URL('../app.ts', import.meta.url)), 'utf8')
}

describe('API host is not indexable', () => {
  test('sets X-Robots-Tag on every response', async () => {
    const source = await readAppSource()
    expect(source).toMatch(/c\.header\(\s*'X-Robots-Tag',\s*'noindex, nofollow'\s*\)/)
    // Registered as a global middleware, not on one route.
    expect(source).toContain("app.use('*', async (c, next) => {")
  })

  test('serves the root document from the app, not from public/', async () => {
    const source = await readAppSource()
    expect(source).toMatch(/app\.get\('\/',\s*\(c\)\s*=>/)

    const publicIndex = fileURLToPath(new URL('../../public/index.html', import.meta.url))
    await expect(
      access(publicIndex),
      'public/index.html is back: Vercel serves it ahead of the rewrite, so `/` would bypass the app and lose X-Robots-Tag',
    ).rejects.toThrow()
  })
})
