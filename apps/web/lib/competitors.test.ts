import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPETITORS, VERIFIED_ON, openSourceCompetitors } from '@/lib/competitors'

/**
 * Guards for the competitor table behind /best-llm-observability-tools.
 *
 * These are claims about other companies' products, so the failure mode that
 * matters is publishing something stale or half-filled. The checks here are
 * about shape and freshness; the numbers themselves have to be re-read from the
 * GitHub API by hand, which is what VERIFIED_ON records.
 */

const APP_DIR = join(__dirname, '..', 'app')

describe('competitor data', () => {
  it('has a plausible, non-future verification date', () => {
    expect(VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const verified = new Date(`${VERIFIED_ON}T00:00:00Z`).getTime()
    expect(verified).toBeLessThanOrEqual(Date.now())
  })

  it('is not more than a year stale', () => {
    // A roundup that claims a verification date and then rots is worse than
    // one with no date at all, because the date is the reason to trust it.
    const ageMs = Date.now() - new Date(`${VERIFIED_ON}T00:00:00Z`).getTime()
    expect(ageMs).toBeLessThan(365 * 24 * 60 * 60 * 1000)
  })

  it('lists Spanlens with the rest rather than above them', () => {
    // The page discloses that we build one of the tools. It should be in the
    // same table on the same terms, including a stated tradeoff.
    const us = COMPETITORS.find((c) => c.name === 'Spanlens')
    expect(us).toBeDefined()
    expect(us?.tradeoff.length).toBeGreaterThan(60)
  })

  it.each(COMPETITORS.map((c) => [c.name, c] as const))('%s is fully filled in', (_name, c) => {
    for (const field of ['license', 'install', 'selfHost', 'bestFor', 'tradeoff', 'homepage'] as const) {
      expect(c[field], `${c.name}.${field}`).toBeTruthy()
    }
    expect(c.homepage).toMatch(/^https:\/\//)
    // Every entry carries a real catch, ours included. A one-word tradeoff is
    // a sign the entry was filled in to pad the table.
    expect(c.tradeoff.split(/\s+/).length, `${c.name}.tradeoff is too short`).toBeGreaterThan(8)
  })

  it.each(COMPETITORS.filter((c) => c.repo).map((c) => [c.name, c] as const))(
    '%s has stars to go with its repo',
    (_name, c) => {
      expect(c.stars, `${c.name} has a repo but no star count`).toBeGreaterThan(0)
      expect(c.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
    },
  )

  it('orders the open-source table by stars, descending', () => {
    const stars = openSourceCompetitors().map((c) => c.stars ?? 0)
    expect(stars).toEqual([...stars].sort((a, b) => b - a))
  })

  it('every compareSlug points at a page that exists', () => {
    for (const c of COMPETITORS.filter((x) => x.compareSlug)) {
      const page = join(APP_DIR, 'compare', c.compareSlug as string, 'page.tsx')
      expect(() => readFileSync(page, 'utf-8'), `${c.name} -> /compare/${c.compareSlug}`).not.toThrow()
    }
  })
})

describe('the roundup page', () => {
  const source = readFileSync(join(APP_DIR, 'best-llm-observability-tools', 'page.tsx'), 'utf-8')

  it('renders from the shared data rather than its own copy', () => {
    expect(source).toContain("from '@/lib/competitors'")
  })

  it('states the verification date on the page', () => {
    expect(source).toContain('{VERIFIED_ON}')
  })

  it('discloses that we build one of the tools', () => {
    expect(source).toMatch(/Disclosure/)
  })

  it('is reachable: the footer and both hubs link to it', () => {
    // The six docs section hubs shipped with no inbound links and Ahrefs filed
    // all six as orphans. Not repeating that.
    const inbound = [
      join(__dirname, '..', 'components', 'layout', 'footer.tsx'),
      join(APP_DIR, 'compare', 'page.tsx'),
      join(APP_DIR, 'alternatives', 'page.tsx'),
    ]
    for (const file of inbound) {
      expect(readFileSync(file, 'utf-8'), file).toContain('/best-llm-observability-tools')
    }
  })

  it('is in the sitemap', () => {
    const sitemap = readFileSync(join(APP_DIR, 'sitemap.ts'), 'utf-8')
    expect(sitemap).toContain("'/best-llm-observability-tools',")
  })
})
