import type { Metadata } from 'next'
import Link from 'next/link'
import { DashboardCTALink } from '@/components/layout/dashboard-cta-link'
import { stateActionPrimary, stateActionSecondary, stateCard } from '@/components/ui/empty-state'

// Without this, 404 pages inherited the homepage title and were indexable —
// any externally-linked broken URL could enter the index as a duplicate of
// the homepage (2026-07-06 SEO audit). `follow: true` keeps link equity
// flowing through any links rendered on the 404 page.
export const metadata: Metadata = {
  title: 'Page not found · Spanlens',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-16">
      <div className={`w-full max-w-[560px] ${stateCard}`}>
        <div className="flex flex-col items-center gap-3 px-10 pb-[30px] pt-[52px] text-center">
          <p className="font-display track-h2 text-[46px] leading-none text-text">404</p>
          <h1 className="font-display track-quote text-[16px] leading-[1.5] text-text">
            That page moved or never existed
          </h1>
          <p className="max-w-[380px] text-[12.5px] leading-[1.6] text-text-faint">
            If you followed a link from a trace or a share, the resource may have aged out of retention.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <DashboardCTALink className={stateActionPrimary}>Back to dashboard</DashboardCTALink>
            <Link href="/docs" className={stateActionSecondary}>
              Search the docs
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
