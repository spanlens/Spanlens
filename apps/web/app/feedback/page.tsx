import { MarketingNav } from '@/components/layout/marketing-nav'
import { Footer } from '@/components/layout/footer'
import { FeedbackRoadmapClient } from './feedback-roadmap-client'

/**
 * R-32 Phase C — public roadmap.
 *
 * Anyone (logged-in or not) can read the roadmap. Voting and submitting
 * require a Spanlens account; the client component shows a "Sign in to vote"
 * pill in place of the vote button for unauthenticated visitors.
 *
 * Previously /feedback rendered a logged-in-only submission form
 * (apps/web/app/(dashboard)/feedback/...). That form is now embedded inside
 * this page as a "Suggest a feature" panel so /feedback is the single feedback
 * surface — the sidebar link still resolves to the same URL.
 */
export const metadata = {
  title: 'Roadmap · Spanlens',
  description:
    'See what is being built next in Spanlens. Upvote features you want, submit new ideas, and follow each item from new through shipped.',
  alternates: { canonical: '/feedback' },
}

export default function FeedbackPage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav subtitle="Roadmap" />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-3">Roadmap</h1>
          <p className="text-lg text-text-muted">
            See what is being built next. Upvote features you want and submit new ideas;
            we ship in the order that has the most demand.
          </p>
        </header>
        <FeedbackRoadmapClient />
      </main>
      <Footer />
    </div>
  )
}
