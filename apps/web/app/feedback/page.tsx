import { MarketingNav } from '@/components/layout/marketing-nav'
import { Footer } from '@/components/layout/footer'
import { FeedbackRoadmapClient } from './feedback-roadmap-client'

/**
 * R-32 Phase C — public feedback page.
 *
 * Anyone (logged-in or not) can read the list. Voting and submitting require
 * a Spanlens account; the client component shows a "Sign in to vote" pill in
 * place of the vote button for unauthenticated visitors.
 *
 * Naming note: the page was briefly titled "Roadmap" right after launch, but
 * the URL is /feedback and the sidebar label is "Feedback" — keeping a
 * "Roadmap" header produced an instant inconsistency for anyone clicking the
 * sidebar link. Renamed to "Feedback" so URL, sidebar, and page agree.
 * The status enum (new -> planned -> in_progress -> shipped -> declined) and
 * the vote pill are unchanged; only the framing is softer.
 *
 * Previously /feedback rendered a logged-in-only submission form
 * (apps/web/app/(dashboard)/feedback/...). That form is now embedded inside
 * this page as a "Suggest a feature" panel so /feedback is the single feedback
 * surface — the sidebar link still resolves to the same URL.
 */
export const metadata = {
  title: 'Feedback · Spanlens',
  description:
    'Tell us what to build next. Vote on what others suggested. Track each item from new to shipped.',
  alternates: { canonical: '/feedback' },
}

export default function FeedbackPage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingNav subtitle="Feedback" />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-3">Feedback</h1>
          <p className="text-lg text-text-muted">
            Tell us what to build next. Vote on what others suggested. Track each
            item from new to shipped.
          </p>
        </header>
        <FeedbackRoadmapClient />
      </main>
      <Footer />
    </div>
  )
}
