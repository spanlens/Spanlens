import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * Closing call to action.
 *
 * This sits above the shared `Footer` rather than inside it: the footer is
 * rendered on /terms, /privacy, /docs and the rest of the marketing site,
 * where a signup pitch would be out of place.
 */
export function ClosingCta() {
  return (
    <section className="px-4 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8 border-t border-border py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:py-14">
        <div className="lg:max-w-[486px]">
          <h2 className="font-display track-h2 text-[24px] leading-[1.08] text-text lg:text-[40px]">
            Point one client at it today
          </h2>
          <p className="mt-3 text-[14.5px] leading-[1.58] text-text-muted lg:text-[16px]">
            The first request you send shows up with cost, tokens and latency attached.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center lg:shrink-0">
          <Button asChild size="hero" variant="signal">
            <Link href="/signup">Start free</Link>
          </Button>
          <Button asChild size="hero" variant="outline">
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
