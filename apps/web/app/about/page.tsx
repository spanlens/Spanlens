import Link from 'next/link'
import { Footer } from '@/components/layout/footer'
import { MarketingNav } from '@/components/layout/marketing-nav'
import { BreadcrumbJsonLd } from '@/components/marketing/breadcrumb-jsonld'

const ABOUT_DESCRIPTION =
  'Spanlens is an open-source LLM observability platform built by developers who shipped LLM apps to production and got tired of debugging cost spikes from a spreadsheet. MIT licensed, self-hostable.'

export const metadata = {
  alternates: { canonical: '/about' },
  title: 'About · Spanlens',
  description: ABOUT_DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'About Spanlens — Open Source LLM Observability',
    description: ABOUT_DESCRIPTION,
    url: '/about',  },
  twitter: {
    card: 'summary_large_image',
    title: 'About Spanlens — Open Source LLM Observability',
    description: ABOUT_DESCRIPTION,  },
}

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  '@id': 'https://www.spanlens.io/about',
  url: 'https://www.spanlens.io/about',
  name: 'About Spanlens',
  description: ABOUT_DESCRIPTION,
  // Reference the canonical Organization node (declared once in the root
  // layout with @id) instead of re-declaring a second Organization here —
  // duplicate nodes with divergent sameAs/foundingDate broke entity
  // reconciliation (2026-07-06 schema audit). foundingDate/founder/sameAs
  // now live on the canonical node in app/layout.tsx.
  mainEntity: {
    '@id': 'https://www.spanlens.io/#organization',
  },
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />
      <MarketingNav />
      <BreadcrumbJsonLd trail={[{ name: 'About', path: '/about' }]} />

      <section className="max-w-3xl mx-auto px-6 py-20">
        <h1 className="text-[40px] sm:text-[48px] font-semibold tracking-[-0.8px] text-text mb-3 leading-[1.05]">
          About Spanlens
        </h1>
        <p className="text-[18px] text-text-muted mb-12 leading-relaxed">
          The lens you point at every LLM call. Open source, drop-in, self-hostable.
        </p>

        <div className="prose prose-sm max-w-none text-text-muted space-y-6">
          <section>
            <h2 className="text-[22px] font-semibold text-text mb-3">Why we built this</h2>
            <p className="text-[15px] leading-relaxed">
              We were shipping LLM apps and burning cash on calls we didn&apos;t fully understand.
              The existing observability tools were either heavy (long onboarding, opinionated SDK
              you wrap every chain in) or sat on a pivot (acquired into a bigger product, public
              roadmap quiet). Neither felt right for a solo dev or a small team that just wants
              to see what their AI is doing.
            </p>
            <p className="text-[15px] leading-relaxed">
              Spanlens started as a proxy you point at OpenAI to log everything, then grew into
              tracing, evals, anomaly detection, and a model-savings recommender, all in one
              MIT-licensed repo with no ee/ folder. The same code we run for hosted customers
              is the code you self-host. There is no second build.
            </p>
          </section>

          <section>
            <h2 className="text-[22px] font-semibold text-text mb-3">Our principles</h2>
            <ul className="text-[15px] leading-relaxed space-y-2 list-disc pl-5">
              <li>
                <strong className="text-text">One line to integrate.</strong> If you cannot turn
                Spanlens on by changing one line, we have failed.
              </li>
              <li>
                <strong className="text-text">Never on the critical path.</strong> Logging runs
                asynchronously after your response returns, so the proxy itself adds only
                microseconds of synchronous overhead (
                <Link href="/benchmarks" className="text-accent hover:opacity-80">see the benchmark</Link>
                ). If Spanlens fails, your request still completes.
              </li>
              <li>
                <strong className="text-text">All features, all plans, all builds.</strong> No
                ee/ folder, no enterprise-only paywall on security features, no telemetry-on-
                by-default in self-hosted.
              </li>
              <li>
                <strong className="text-text">Numbers, not vibes.</strong> Cost savings come
                with dollar figures. Prompt A/B comes with a Welch t-test. Eval drift comes
                with a judge-to-human correlation metric.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-[22px] font-semibold text-text mb-3">Who is building this</h2>
            <p className="text-[15px] leading-relaxed">
              Spanlens is built by a small team led by{' '}
              <strong className="text-text">Haeseong Jeon</strong> (founder, engineering).
              Background in production LLM application development and full-stack engineering.
              The team has shipped agent systems, RAG pipelines, and proxy infrastructure at
              scale before starting Spanlens in early 2026.
            </p>
            <p className="text-[15px] leading-relaxed">
              We are open to contributions. The roadmap, issues, and source live on{' '}
              <a
                href="https://github.com/spanlens/Spanlens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:opacity-80"
              >
                GitHub
              </a>
              . Bug reports, feature requests, and pull requests are all read and answered.
            </p>
          </section>

          <section>
            <h2 className="text-[22px] font-semibold text-text mb-3">License and stack</h2>
            <p className="text-[15px] leading-relaxed">
              Every line of Spanlens ships under the{' '}
              <a
                href="https://opensource.org/licenses/MIT"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:opacity-80"
              >
                MIT license
              </a>
              . The stack is Next.js 16 + Hono + Supabase Postgres + ClickHouse, with
              TypeScript and Python SDKs. The full stack runs from one Docker compose file
              on your own infrastructure if you prefer not to use the hosted plan.
            </p>
          </section>

          <section>
            <h2 className="text-[22px] font-semibold text-text mb-3">Contact</h2>
            <ul className="text-[15px] leading-relaxed space-y-1.5">
              <li>
                Email:{' '}
                <a href="mailto:hi@spanlens.io" className="text-accent hover:opacity-80">
                  hi@spanlens.io
                </a>
              </li>
              <li>
                GitHub:{' '}
                <a
                  href="https://github.com/spanlens/Spanlens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:opacity-80"
                >
                  github.com/spanlens/Spanlens
                </a>
              </li>
              <li>
                Docs:{' '}
                <Link href="/docs" className="text-accent hover:opacity-80">
                  spanlens.io/docs
                </Link>
              </li>
            </ul>
          </section>
        </div>

        <div className="mt-16 rounded-xl border border-border bg-bg-elev p-6 text-center">
          <p className="text-[14px] text-text-muted mb-4">
            Ready to point the lens at your LLM calls?
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link
              href="/signup"
              className="h-10 px-5 rounded-[6px] bg-accent text-bg text-[14px] font-medium leading-10 hover:opacity-90 transition-opacity"
            >
              Start free →
            </Link>
            <Link
              href="/docs/quick-start"
              className="h-10 px-5 rounded-[6px] border border-border text-text text-[14px] font-medium leading-10 hover:bg-bg-elev transition-colors"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
