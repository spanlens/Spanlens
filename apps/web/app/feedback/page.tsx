import Link from 'next/link'
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
  title: 'Feedback & Feature Requests · Spanlens',
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

        {/* Server-rendered copy: the board above is client-only, so without
            this section the page ships almost no indexable text (flagged as
            a low-content page in the 2026-06-11 crawl audit). */}
        <section className="mt-16 border-t border-border pt-10 text-sm text-text-muted space-y-4">
          <h2 className="text-base font-semibold text-text">How feedback works at Spanlens</h2>
          <p>
            Every suggestion on this board is public. Anyone can propose a feature, vote on
            existing ideas, and follow an item as it moves from new to planned, in progress,
            and shipped. Votes directly shape the roadmap: the team reviews the board weekly
            and the most-requested items are prioritized for upcoming releases.
          </p>
          <p>
            Spanlens is an open source LLM observability platform, so you can also open an
            issue or a pull request on{' '}
            <a href="https://github.com/spanlens" className="text-accent hover:opacity-80">
              GitHub
            </a>{' '}
            if you prefer to discuss implementation details with the maintainers. Shipped
            items are announced on the <Link href="/changelog" className="text-accent hover:opacity-80">changelog</Link>,
            including the features that started as suggestions here.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
