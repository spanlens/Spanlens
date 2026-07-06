import type { Metadata } from 'next'
import { Button } from '@/components/ui/button'
import { DashboardCTALink } from '@/components/layout/dashboard-cta-link'

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
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
      <p className="text-6xl font-bold text-gray-200 mb-4">404</p>
      <h1 className="text-2xl font-bold mb-2">Page not found</h1>
      <p className="text-muted-foreground mb-8">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <DashboardCTALink>
        <Button>Go to dashboard</Button>
      </DashboardCTALink>
    </div>
  )
}
